// Fixed-size log pages, shared by the page (src/) and the serverless functions (api/). Relative imports only.

/** Range errors an RPC raises when a log query is too wide; only these trigger a split inside a page. */
export const RANGE_ERR = /range|limit|too many|exceed|response size|more than|too large|timeout/i

/** Inclusive [from, to] pages of at most `size` blocks; empty when from > to. */
export function pageRanges(from: bigint, to: bigint, size = 5_000n): [bigint, bigint][] {
  const pages: [bigint, bigint][] = []
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n
    pages.push([start, end < to ? end : to])
  }
  return pages
}

/** One page, halved only if the RPC still reports a range error for it. */
async function fetchPage<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, depth = 0): Promise<T[]> {
  try {
    return await fetch(from, to)
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (from >= to || depth >= 6 || !RANGE_ERR.test(msg)) throw err
    const mid = from + (to - from) / 2n
    return [...(await fetchPage(fetch, from, mid, depth + 1)), ...(await fetchPage(fetch, mid + 1n, to, depth + 1))]
  }
}

/**
 * Fetches every page (up to `concurrency` at a time) and returns the results in page order.
 * Defaults are the browser's: 4 at a time over pages of 5,000 blocks. The serverless scan passes its own.
 */
export async function pageLogs<T>(
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  concurrency = 4,
  size = 5_000n,
): Promise<T[]> {
  const pages = pageRanges(from, to, size)
  const results: T[][] = new Array<T[]>(pages.length)
  let next = 0
  const worker = async () => {
    while (next < pages.length) {
      const i = next++
      results[i] = await fetchPage(fetch, pages[i][0], pages[i][1])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker))
  return results.flat()
}

/**
 * Pages of at most `size` blocks on a fixed grid anchored at `anchor`, covering [from, to]. A scan that resumes later
 * (from > anchor) gets the same page boundaries again, so pages fetched earlier can be reused as they are.
 */
export function gridRanges(anchor: bigint, from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  const pages: [bigint, bigint][] = []
  for (let start = from; start <= to; ) {
    const boundary = anchor + ((start - anchor) / size + 1n) * size - 1n
    const end = boundary < to ? boundary : to
    pages.push([start, end])
    start = end + 1n
  }
  return pages
}

export interface FetchedPage<T> {
  from: bigint
  to: bigint
  items: T[]
}

export interface FetchRangesOptions<T> {
  concurrency: number
  /** A Date.now()-style clock. */
  now?: () => number
  /** No new page starts at or after this time. */
  stopStartingAt?: number
  /** A page still running at this time is given up on (its result is dropped). */
  abandonAt?: number
  /** Called as each page completes, so completed work survives a later failure. */
  onPage?: (page: FetchedPage<T>) => void
}

/**
 * Fetches the given ranges through a shared queue: whichever worker is free takes the next page, so one slow page holds
 * back only itself. Stops starting pages at `stopStartingAt`. Resolves with `complete` (every range fetched); rejects
 * with the first error after the other workers have finished, with the pages that did complete already reported.
 */
export async function fetchRanges<T>(
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  ranges: readonly (readonly [bigint, bigint])[],
  o: FetchRangesOptions<T>,
): Promise<{ complete: boolean; fetched: number }> {
  const now = o.now ?? (() => Date.now())
  let next = 0
  let fetched = 0
  let failure: Error | undefined
  const worker = async () => {
    while (next < ranges.length && failure === undefined) {
      if (o.stopStartingAt !== undefined && now() >= o.stopStartingAt) return
      const [from, to] = ranges[next++]
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const work = fetchPage(fetch, from, to)
        work.catch(() => undefined) // an abandoned page may still fail later; nobody is waiting for it
        const racers: Promise<T[] | null>[] = [work]
        if (o.abandonAt !== undefined) racers.push(new Promise<null>((r) => (timer = setTimeout(() => r(null), Math.max(0, o.abandonAt! - now())))))
        const items = await Promise.race(racers)
        if (items === null) return // gave up on this page: later pages are not started either
        fetched++
        o.onPage?.({ from, to, items })
      } catch (err) {
        failure ??= err instanceof Error ? err : new Error(String(err))
        return
      } finally {
        clearTimeout(timer)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(o.concurrency, ranges.length) }, worker))
  if (failure !== undefined) throw failure
  return { complete: next >= ranges.length && fetched === ranges.length, fetched }
}

/** Parsed logs in chain order, `(blockNumber, logIndex)`, with duplicates (same `transactionHash:logIndex`) dropped. */
export function orderLogs<T extends { blockNumber: bigint; logIndex: number; transactionHash: string }>(parsed: readonly T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const l of parsed) {
    const key = `${l.transactionHash}:${l.logIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(l)
  }
  return unique.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))
}
