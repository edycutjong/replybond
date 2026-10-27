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

/** Fetches every page (up to `concurrency` at a time) and returns the results in page order. */
export async function pageLogs<T>(
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  concurrency = 4,
): Promise<T[]> {
  const pages = pageRanges(from, to)
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
