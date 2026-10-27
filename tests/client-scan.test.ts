import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RETRY_DELAYS_MS, SCAN_CONCURRENCY, alignedPages, isRateLimited, scanPages, withRateLimitRetry } from '../src/lib/scanPages'
import type { PageCache } from '../src/lib/scanPages'

const noSleep = async () => {}
const rateLimit = () => Object.assign(new Error('rate limit exceeded'), { code: -32005 })

test('alignedPages: pages sit on the 5,000-block grid, the first and last are clipped', () => {
  assert.deepEqual(alignedPages(12_345n, 27_000n), [[12_345n, 14_999n], [15_000n, 19_999n], [20_000n, 24_999n], [25_000n, 27_000n]])
  assert.deepEqual(alignedPages(10_000n, 14_999n), [[10_000n, 14_999n]])
  assert.deepEqual(alignedPages(7n, 7n), [[7n, 7n]])
  assert.deepEqual(alignedPages(8n, 7n), [])
})

test('scanPages never has more than 2 pages in flight', async () => {
  assert.equal(SCAN_CONCURRENCY, 2)
  let inFlight = 0
  let peak = 0
  const fetchPage = async (from: bigint) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight--
    return [from]
  }
  const out = await scanPages({ from: 0n, to: 59_999n, fetchPage })
  assert.equal(out.length, 12)
  assert.equal(peak, 2)
})

test('pages are fetched newest first and reported as they arrive', async () => {
  const seen: bigint[] = []
  await scanPages({ from: 0n, to: 19_999n, fetchPage: async (from) => [from], onPage: (_items, [from]) => void seen.push(from), concurrency: 1 })
  assert.deepEqual(seen, [15_000n, 10_000n, 5_000n, 0n])
})

test('a rate-limited page is retried after 500 ms, 1 s and 2 s, then succeeds', async () => {
  const slept: number[] = []
  let calls = 0
  const out = await withRateLimitRetry(
    async () => {
      if (++calls < 4) throw rateLimit()
      return 'ok'
    },
    async (ms) => void slept.push(ms),
  )
  assert.equal(out, 'ok')
  assert.equal(calls, 4)
  assert.deepEqual(slept, [500, 1000, 2000])
  assert.deepEqual([...RETRY_DELAYS_MS], [500, 1000, 2000])
})

test('retry gives up after the third retry, and other errors are not retried', async () => {
  let calls = 0
  await assert.rejects(
    withRateLimitRetry(async () => {
      calls++
      throw rateLimit()
    }, noSleep),
    /rate limit/,
  )
  assert.equal(calls, 4)
  let other = 0
  await assert.rejects(
    withRateLimitRetry(async () => {
      other++
      throw new Error('execution reverted')
    }, noSleep),
    /reverted/,
  )
  assert.equal(other, 1)
  assert.equal(isRateLimited(Object.assign(new Error('Request exceeds defined limit.'))), true)
  assert.equal(isRateLimited(Object.assign(new Error('HTTP request failed'), { cause: { message: 'rate limit exceeded' } })), true)
  assert.equal(isRateLimited(new Error('execution reverted')), false)
})

test('scanPages retries a rate-limited page inside the scan', async () => {
  const tries = new Map<string, number>()
  const out = await scanPages({
    from: 0n,
    to: 9_999n,
    sleep: noSleep,
    fetchPage: async (from) => {
      const n = (tries.get(String(from)) ?? 0) + 1
      tries.set(String(from), n)
      if (from === 0n && n < 3) throw rateLimit()
      return [from]
    },
  })
  assert.deepEqual(out.sort(), [0n, 5_000n])
  assert.equal(tries.get('0'), 3)
})

test('completed pages older than the head are cached and reused; the page at the head is not', async () => {
  const store = new Map<string, bigint[]>()
  const cache: PageCache<bigint> = {
    get: (f, t) => store.get(`${f}-${t}`) ?? null,
    set: (f, t, items) => void store.set(`${f}-${t}`, items),
  }
  const fetched: bigint[] = []
  const fetchPage = async (from: bigint) => {
    fetched.push(from)
    return [from]
  }
  await scanPages({ from: 0n, to: 12_000n, fetchPage, cache })
  assert.deepEqual([...store.keys()].sort(), ['0-4999', '5000-9999'], 'the page that ends at the head (10000-12000) is not cached')
  fetched.length = 0
  await scanPages({ from: 0n, to: 12_000n, fetchPage, cache })
  assert.deepEqual(fetched, [10_000n], 'only the head page is fetched again')
})

test('a failing page rejects, but the pages that completed were reported and cached', async () => {
  const store = new Map<string, bigint[]>()
  const cache: PageCache<bigint> = { get: (f, t) => store.get(`${f}-${t}`) ?? null, set: (f, t, i) => void store.set(`${f}-${t}`, i) }
  const reported: bigint[] = []
  await assert.rejects(
    scanPages({
      from: 0n,
      to: 19_999n,
      cache,
      concurrency: 1,
      sleep: noSleep,
      onPage: (_i, [from]) => void reported.push(from),
      fetchPage: async (from) => {
        if (from === 5_000n) throw rateLimit()
        return [from]
      },
    }),
    /rate limit/,
  )
  assert.deepEqual(reported, [15_000n, 10_000n])
  assert.deepEqual([...store.keys()].sort(), ['10000-14999'], '15000-19999 touches the head so only 10000-14999 is cached')
})

test('the stored page cache round-trips logs, survives broken storage, and keys by chain and contract', async () => {
  const { fromStored, pageCacheKey, storedPageCache, toStored } = await import('../src/lib/pageStore')
  const contract = '0x1234fb0fb613d284d98bbe2ff89045aae5d22458'
  const log = {
    address: contract,
    topics: [`0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`],
    data: '0x01',
    blockNumber: 70_000n,
    logIndex: 3,
    transactionHash: `0x${'33'.repeat(32)}`,
    blockHash: `0x${'44'.repeat(32)}`,
    transactionIndex: 1,
    removed: false,
    blockTimestamp: '1793000000',
  } as unknown as Parameters<typeof toStored>[0]
  const back = fromStored(toStored(log), contract)
  assert.equal(back.blockNumber, 70_000n)
  assert.equal(back.logIndex, 3)
  assert.equal((back as unknown as { blockTimestamp: string }).blockTimestamp, '1793000000')

  const bag = new Map<string, string>()
  const storage = { getItem: (k: string) => bag.get(k) ?? null, setItem: (k: string, v: string) => void bag.set(k, v) }
  const prefix = pageCacheKey(5042002, contract)
  assert.equal(prefix, `replybond:logs:5042002:${contract}`)
  storedPageCache(prefix, () => storage).set(0n, 4_999n, [toStored(log)])
  assert.deepEqual([...bag.keys()], [`${prefix}:0-4999`])
  const fresh = storedPageCache(prefix, () => storage) // a new visit: memory is empty, sessionStorage serves
  assert.equal(fresh.get(0n, 4_999n)?.[0]?.blockNumber, '70000')
  assert.equal(fresh.get(5_000n, 9_999n), null)

  const broken = storedPageCache(prefix, () => ({ getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') } }))
  broken.set(0n, 4_999n, [])
  assert.deepEqual(broken.get(0n, 4_999n), [], 'the in-memory copy still serves')
  assert.equal(storedPageCache(prefix, () => null).get(0n, 4_999n), null, 'no storage at all: a miss, not an error')
})
