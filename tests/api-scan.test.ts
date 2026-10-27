import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import type { Hex } from 'viem'
import './api-env'
import { demoBuyerAddress, providerAddress } from './api-env'
import { silentHash } from './api-helpers'
import { Status, replyBondAbi } from '../src/lib/abi'
import { ctx } from '../api/_lib/config'
import { HttpError, route } from '../api/_lib/http'
import type { ApiRequest, ApiResponse } from '../api/_lib/http'
import { SCAN_CONCURRENCY, SCAN_PAGE_SIZE, eventCacheState, loadSnapshot, resetEventCache } from '../api/_lib/state'
import { fetchRanges, gridRanges } from '../src/lib/pageLogs'

const START = ctx().startBlock // the deployment block: the scan window never starts earlier
const HEAD = START + 94_999n // a window of 95,000 blocks: nine full 10,000-block pages and one of 5,000
const HASH = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex

const offerPosted = (id: bigint, block: bigint, logIndex = 0) => ({
  address: ctx().replyBond,
  topics: encodeEventTopics({ abi: replyBondAbi, eventName: 'OfferPosted', args: { id, provider: providerAddress, buyer: demoBuyerAddress } }),
  data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' }, { type: 'uint64' }], [silentHash, 10n, 5n, 45n, 1n]),
  blockNumber: block,
  logIndex,
  transactionHash: HASH(Number(id) * 100 + logIndex),
  blockTimestamp: '1800000000',
})
const offerAccepted = (id: bigint, block: bigint, logIndex = 0) => ({
  address: ctx().replyBond,
  topics: encodeEventTopics({ abi: replyBondAbi, eventName: 'OfferAccepted', args: { id, buyer: demoBuyerAddress } }),
  data: encodeAbiParameters([{ type: 'uint64' }], [1_800_000_045n]),
  blockNumber: block,
  logIndex,
  transactionHash: HASH(Number(id) * 100 + 50 + logIndex),
  blockTimestamp: '1800000001',
})

interface Chain {
  clock: { t: number }
  calls: { from: bigint; to: bigint }[]
  peak: () => number
  deps: Parameters<typeof loadSnapshot>[0]
  slow: Set<bigint>
  failOnce: Set<bigint>
}

/** A fake chain: head fixed, 0.5 s per block, logs served from a list, per-call latency and scripted failures. */
function chain(logs: ReturnType<typeof offerPosted>[], opts: { callMs?: number; budgetMs?: number } = {}): Chain {
  const clock = { t: 5_000_000 }
  const calls: { from: bigint; to: bigint }[] = []
  let inFlight = 0
  let peak = 0
  const slow = new Set<bigint>()
  const failOnce = new Set<bigint>()
  const pub = {
    getBlock: async (a?: { blockNumber?: bigint }) => (a?.blockNumber === undefined ? { number: HEAD, timestamp: 1_800_000_000n } : { number: a.blockNumber, timestamp: 1_800_000_000n - (HEAD - a.blockNumber) / 2n }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push({ from: fromBlock, to: toBlock })
      inFlight++
      peak = Math.max(peak, inFlight)
      clock.t += opts.callMs ?? 0
      try {
        await new Promise((r) => setTimeout(r, slow.has(fromBlock) ? 25 : 3))
        if (failOnce.delete(fromBlock)) throw new Error('connection reset')
        return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
      } finally {
        inFlight--
      }
    },
  }
  return { clock, calls, peak: () => peak, slow, failOnce, deps: { pub, now: () => clock.t, budgetMs: opts.budgetMs } as unknown as Chain['deps'] }
}

test('the serverless scan reads 10,000-block pages, 8 at a time', async () => {
  assert.equal(SCAN_PAGE_SIZE, 10_000n)
  assert.equal(SCAN_CONCURRENCY, 8)
  resetEventCache()
  const c = chain([offerPosted(1n, START + 12_345n)])
  const snap = await loadSnapshot(c.deps)
  assert.equal(c.calls.length, 10)
  for (const call of c.calls) assert.ok(call.to - call.from + 1n <= 10_000n, 'no page wider than 10,000 blocks')
  assert.equal(c.peak(), 8, 'eight pages in flight at the peak, never more')
  assert.equal(snap.jobs.length, 1)
  assert.equal(eventCacheState()?.scanned, HEAD)
})

test('a slow page holds back only itself, and ordering and de-duplication survive', async () => {
  resetEventCache()
  const posted = offerPosted(1n, START + 3_000n)
  const accepted = offerAccepted(1n, START + 52_000n)
  const duplicate = { ...accepted } // the same log delivered by two pages
  const c = chain([posted, accepted])
  c.slow.add(START) // the first page, which holds the OfferPosted, answers last
  // a second copy of the accept sits in the neighbouring page's answer too
  const original = c.deps!.pub!.getLogs
  c.deps!.pub!.getLogs = (async (a: { fromBlock: bigint; toBlock: bigint }) => {
    const out = (await original(a)) as unknown as ReturnType<typeof offerPosted>[]
    return a.fromBlock === START + 50_000n ? [...out, duplicate] : out
  }) as never
  const snap = await loadSnapshot(c.deps)
  const job = snap.jobs[0]
  assert.equal(snap.jobs.length, 1)
  assert.equal(job.status, Status.Accepted, 'OfferPosted sorted before OfferAccepted although its page finished last')
  assert.equal(job.deadline, 1_800_000_045)
})

test('a slow chain stops at the budget, answers warming_up, and the next call resumes from the cached prefix', async () => {
  resetEventCache()
  // every page read costs 10 s of fake time; a 45 s budget lets five pages start
  const c = chain([offerPosted(1n, START + 1n)], { callMs: 10_000, budgetMs: 45_000 })
  await assert.rejects(loadSnapshot(c.deps), (e) => e instanceof HttpError && e.statusCode === 503 && e.message === 'warming_up' && e.extra.retryAfterSeconds === 5)
  assert.equal(c.calls.length, 5, 'no page starts once the budget is spent')
  const state = eventCacheState()!
  assert.equal(state.scanned, START + 50_000n - 1n, 'the five pages read are one contiguous prefix from the oldest block')

  // next call: a fresh budget, a fast chain
  c.calls.length = 0
  const fast = chain([offerPosted(1n, START + 1n)])
  const snap = await loadSnapshot(fast.deps)
  assert.equal(fast.calls[0].from, START + 50_000n, 'it continues after the prefix instead of starting over')
  assert.equal(fast.calls.length, 5)
  assert.equal(snap.jobs.length, 1)
  assert.equal(eventCacheState()?.scanned, HEAD)
})

test('scanned only advances over a contiguous range: a failed first page keeps the pages after it waiting, and they are used on the next call', async () => {
  resetEventCache()
  const c = chain([offerPosted(1n, START + 2n), offerAccepted(1n, START + 91_000n)])
  c.failOnce.add(START)
  await assert.rejects(loadSnapshot(c.deps), /connection reset/)
  const mid = eventCacheState()!
  assert.equal(mid.scanned, -1n, 'nothing is contiguous from the oldest block yet')
  assert.ok(mid.ahead >= 1 && mid.ahead <= 9, 'the pages that did arrive are kept')
  c.calls.length = 0
  const snap = await loadSnapshot(c.deps)
  assert.equal(c.calls.length, 10 - mid.ahead, 'only the pages not already held are read again')
  assert.ok(c.calls.some((x) => x.from === START), 'including the first page that failed')
  assert.equal(snap.jobs[0].status, Status.Accepted)
  assert.equal(eventCacheState()?.scanned, HEAD)
})

test('an incremental call after a full scan reads only the new blocks', async () => {
  resetEventCache()
  const c = chain([])
  await loadSnapshot(c.deps)
  c.calls.length = 0
  await loadSnapshot(c.deps)
  assert.equal(c.calls.length, 0, 'the head has not moved: nothing to read')
})

test('the route answers 503 {error: "warming_up", retryAfterSeconds: 5} with a retry-after header', async () => {
  resetEventCache()
  const c = chain([], { callMs: 10_000, budgetMs: 45_000 })
  let status = 0
  let body = ''
  const headers: Record<string, string> = {}
  const res = { setHeader: (k: string, v: string) => (headers[k] = v), end: (b: string) => (body = b), set statusCode(v: number) { status = v } } as unknown as ApiResponse
  await route(['GET'], async () => ({ body: await loadSnapshot(c.deps) }))({ method: 'GET' } as ApiRequest, res)
  assert.equal(status, 503)
  assert.deepEqual(JSON.parse(body), { error: 'warming_up', retryAfterSeconds: 5 })
  assert.equal(headers['retry-after'], '5')
})

test('fetchRanges: whichever worker is free takes the next page, so a slow page does not starve the rest', async () => {
  const order: bigint[] = []
  const ranges = gridRanges(0n, 0n, 99_999n, 10_000n)
  await fetchRanges(
    async (from) => {
      if (from === 0n) await new Promise((r) => setTimeout(r, 40)) // the first page is slow
      order.push(from)
      return [from]
    },
    ranges,
    { concurrency: 2 },
  )
  assert.equal(order.length, 10)
  assert.equal(order[order.length - 1], 0n, 'the slow first page finished last while the other worker took all the others')
})

test('gridRanges: a resumed scan gets the same boundaries as the original', () => {
  assert.deepEqual(gridRanges(1_000n, 1_000n, 24_999n, 10_000n), [[1_000n, 10_999n], [11_000n, 20_999n], [21_000n, 24_999n]])
  assert.deepEqual(gridRanges(1_000n, 11_000n, 24_999n, 10_000n), [[11_000n, 20_999n], [21_000n, 24_999n]])
  assert.deepEqual(gridRanges(1_000n, 15_000n, 24_999n, 10_000n), [[15_000n, 20_999n], [21_000n, 24_999n]])
  assert.deepEqual(gridRanges(0n, 5n, 4n, 10n), [])
})

test('a page that still reports a range error is split in half, as before', async () => {
  resetEventCache()
  const c = chain([offerPosted(1n, START + 7_000n)])
  const pub = c.deps!.pub as unknown as { getLogs: (a: { fromBlock: bigint; toBlock: bigint }) => Promise<unknown[]> }
  const inner = pub.getLogs
  pub.getLogs = async (a) => {
    if (a.toBlock - a.fromBlock + 1n > 4_000n) throw new Error('requested range too large')
    return inner(a)
  }
  const snap = await loadSnapshot(c.deps)
  assert.equal(snap.jobs.length, 1)
  assert.ok(c.calls.every((x) => x.to - x.from + 1n <= 4_000n), 'every call that reached the node was within the limit it enforces')
})
