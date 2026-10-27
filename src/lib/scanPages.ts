// The page's log scan: small concurrency, rate-limit retries, rows as pages arrive, and a page cache.
// (The server keeps using pageLogs; this file is for the browser, where the public RPC is shared and rate-limited.)
import { RANGE_ERR } from './pageLogs'

export const SCAN_CONCURRENCY = 2
export const RETRY_DELAYS_MS = [500, 1000, 2000] as const
const RATE_LIMITED = /rate limit|exceeds defined limit|too many requests|-32005|\b429\b/i

type ErrorLike = { message?: string; shortMessage?: string; details?: string; code?: number; cause?: unknown }

/** True when the RPC refused a request for volume (not for its content). */
export function isRateLimited(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; cur && depth < 4; depth++) {
    const e = cur as ErrorLike
    if (RATE_LIMITED.test(`${e.message ?? ''} ${e.shortMessage ?? ''} ${e.details ?? ''} ${e.code ?? ''}`)) return true
    cur = e.cause
  }
  return false
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Retries a rate-limited call after 500 ms, 1 s and 2 s (so at most 4 attempts); any other error is thrown at once. */
export async function withRateLimitRetry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void> = realSleep, delays: readonly number[] = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= delays.length || !isRateLimited(err)) throw err
      await sleep(delays[attempt])
    }
  }
}

/** Pages aligned to multiples of `size`, so a page covers the same blocks on every visit and can be cached. Oldest first. */
export function alignedPages(from: bigint, to: bigint, size = 5_000n): [bigint, bigint][] {
  const pages: [bigint, bigint][] = []
  for (let start = from; start <= to; ) {
    const boundary = (start / size + 1n) * size - 1n
    const end = boundary < to ? boundary : to
    pages.push([start, end])
    start = end + 1n
  }
  return pages
}

export interface PageCache<T> {
  get: (from: bigint, to: bigint) => T[] | null
  set: (from: bigint, to: bigint, items: T[]) => void
}

export interface ScanOptions<T> {
  from: bigint
  to: bigint
  fetchPage: (from: bigint, to: bigint) => Promise<T[]>
  /** Called as each page completes, newest pages first. */
  onPage?: (items: T[], range: [bigint, bigint]) => void | Promise<void>
  cache?: PageCache<T>
  concurrency?: number
  size?: bigint
  sleep?: (ms: number) => Promise<void>
}

/** One page, halved only when the RPC says the range is still too wide. */
async function fetchWithSplit<T>(o: ScanOptions<T>, from: bigint, to: bigint, depth = 0): Promise<T[]> {
  try {
    return await withRateLimitRetry(() => o.fetchPage(from, to), o.sleep)
  } catch (err) {
    if (from >= to || depth >= 6 || isRateLimited(err) || !RANGE_ERR.test((err as ErrorLike).message ?? '')) throw err
    const mid = from + (to - from) / 2n
    return [...(await fetchWithSplit(o, from, mid, depth + 1)), ...(await fetchWithSplit(o, mid + 1n, to, depth + 1))]
  }
}

/**
 * Scans [from, to] page by page, newest page first, with at most `concurrency` pages in flight (2 by default).
 * A completed page older than the head (its end is below `to`) is cached and served from the cache next time; the page
 * that touches the head is never cached. Resolves with every item; rejects on the first page that still fails, after
 * the pages that did complete have been reported and cached.
 */
export async function scanPages<T>(o: ScanOptions<T>): Promise<T[]> {
  const pages = alignedPages(o.from, o.to, o.size).reverse()
  const results: T[][] = new Array<T[]>(pages.length)
  let next = 0
  let failure: Error | undefined
  const worker = async () => {
    while (next < pages.length && failure === undefined) {
      const i = next++
      const [from, to] = pages[i]
      const cacheable = to < o.to
      let items = cacheable ? (o.cache?.get(from, to) ?? null) : null
      if (!items) {
        try {
          items = await fetchWithSplit(o, from, to)
        } catch (err) {
          failure ??= err instanceof Error ? err : new Error(String(err))
          return
        }
        if (cacheable) o.cache?.set(from, to, items)
      }
      results[i] = items
      await o.onPage?.(items, [from, to])
    }
  }
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? SCAN_CONCURRENCY, pages.length) }, worker))
  if (failure !== undefined) throw failure
  return results.flat()
}
