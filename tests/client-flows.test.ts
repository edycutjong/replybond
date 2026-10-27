import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Address, Hex } from 'viem'
import { classifyReceipt } from '../src/lib/classifyReceipt'
import { acknowledge41, timeout23 } from './fixtures/receipts'
import type { ReceiptSummary } from '../src/lib/api'
import type { Settlement } from '../src/lib/chainReads'
import { buildSettledCard } from '../src/lib/settledCard'
import { settleNowFlow } from '../src/lib/settleNowFlow'
import type { SettleNowState } from '../src/lib/settleNowFlow'

const CONTRACT: Address = '0x1234fb0fb613d284d98bbe2ff89045aae5d22458'
const TX = `0x${'cd'.repeat(32)}` as Hex

const summaryOf = (r: typeof timeout23): ReceiptSummary => ({ txHash: TX, status: 'success', blockNumber: '1', logs: r.logs.map((l, i) => ({ logIndex: i, address: l.address, topics: [...l.topics], data: l.data })) })
// The same classification the app does, without the block-time read (no network in tests).
const classifyOnly = async (s: ReceiptSummary, id?: bigint): Promise<Settlement> => {
  const classification = classifyReceipt({ status: s.status, logs: s.logs }, CONTRACT, id)
  return { jobId: classification.jobId, txHash: s.txHash, classification, blockTime: null }
}

test('settle-now card: a valid server receipt is PAID even when the chain read throws', async () => {
  let resolved = 0
  const c = await buildSettledCard('23', TX, summaryOf(timeout23), {
    resolve: async () => {
      resolved++
      throw new Error('rpc down')
    },
    fromSummary: classifyOnly,
    terms: async () => ({ price: 10n ** 16n, bond: 5n * 10n ** 15n }),
  })
  assert.equal(c.settlement.classification.kind, 'PAID')
  assert.equal(c.settlement.classification.event, 'JobTimedOut')
  assert.equal(resolved, 0, 'the chain is not consulted when the summary is usable')
})

test('settle-now card: no summary falls back to the chain read; a failing terms read keeps the settlement', async () => {
  const fromChain = await classifyOnly(summaryOf(acknowledge41))
  const c = await buildSettledCard('41', TX, undefined, {
    resolve: async () => fromChain,
    terms: async () => {
      throw new Error('getJob failed')
    },
  })
  assert.equal(c.settlement.classification.kind, 'PAID')
  assert.deepEqual([c.price, c.bond], [null, null])
  // an unusable summary (it throws) also falls back
  const d = await buildSettledCard('41', TX, summaryOf(acknowledge41), {
    fromSummary: async () => {
      throw new Error('bad summary')
    },
    resolve: async () => fromChain,
    terms: async () => null,
  })
  assert.equal(d.settlement.classification.kind, 'PAID')
})

function flowRig(settleBody: object, refillReply: { status: number; body: object }) {
  const states: SettleNowState[] = []
  let refills = 0
  let refreshes = 0
  const deps = {
    api: {
      settle: async () => ({ status: 200, body: settleBody }),
      refill: async () => {
        refills++
        return refillReply
      },
    },
    card: async () => {
      throw new Error('no latest card expected')
    },
    getNow: () => 1_000,
    refreshJobs: async () => {
      refreshes++
    },
  } as unknown as Parameters<typeof settleNowFlow>[0]
  return { deps, states, refillCount: () => refills, refreshCount: () => refreshes, set: (s: SettleNowState) => states.push(s) }
}

test('an empty pool asks for a refill once and takes the next-ready time from its pool', async () => {
  const r = flowRig({ settled: false, refillSuggested: true, nextReadyInSeconds: null }, { status: 200, body: { pool: { size: 3, nextReadyInSeconds: 41 } } })
  await settleNowFlow(r.deps, r.set)
  assert.equal(r.refillCount(), 1)
  const last = r.states[r.states.length - 1]
  assert.equal(last.phase, 'notready')
  assert.equal(last.phase === 'notready' ? last.nextReadyInSeconds : -1, 41)
  assert.equal(r.refreshCount(), 1)
})

test('pool.size 0 also triggers the refill; waiting stock does not', async () => {
  const empty = flowRig({ settled: false, pool: { size: 0, nextReadyInSeconds: null } }, { status: 200, body: { pool: { size: 3, nextReadyInSeconds: 44 } } })
  await settleNowFlow(empty.deps, empty.set)
  assert.equal(empty.refillCount(), 1)
  const waiting = flowRig({ settled: false, nextReadyInSeconds: 12, pool: { size: 2, nextReadyInSeconds: 12 } }, { status: 200, body: {} })
  await settleNowFlow(waiting.deps, waiting.set)
  assert.equal(waiting.refillCount(), 0)
  const last = waiting.states[waiting.states.length - 1]
  assert.equal(last.phase === 'notready' ? last.nextReadyInSeconds : -1, 12)
})

test('a wallets_low refill shows its message', async () => {
  const r = flowRig({ settled: false, refillSuggested: true }, { status: 503, body: { error: 'wallets_low', message: 'The demo wallets are low on USDC.' } })
  await settleNowFlow(r.deps, r.set)
  const last = r.states[r.states.length - 1]
  assert.equal(last.phase === 'notready' ? last.message : null, 'The demo wallets are low on USDC.')
})

test('a 503 warming_up is retried after the advised wait, not treated as an error', async () => {
  const { call } = await import('../src/lib/api')
  const replies = [
    { status: 503, body: { error: 'warming_up', retryAfterSeconds: 5 } },
    { status: 503, body: { error: 'warming_up', retryAfterSeconds: 5 } },
    { status: 200, body: { ok: true } },
  ]
  const slept: number[] = []
  let calls = 0
  const fetchImpl = (async () => {
    const r = replies[calls++]
    return { status: r.status, text: async () => JSON.stringify(r.body) }
  }) as unknown as typeof fetch
  const out = await call<{ ok?: boolean }>('/api/sweep', 'GET', undefined, { fetchImpl, sleep: async (ms) => void slept.push(ms) })
  assert.equal(out.status, 200)
  assert.equal(out.body.ok, true)
  assert.equal(calls, 3)
  assert.deepEqual(slept, [5000, 5000])
})

test('a server that keeps warming up ends as a friendly retryable message, other errors are returned at once', async () => {
  const { call } = await import('../src/lib/api')
  let calls = 0
  const warming = (async () => {
    calls++
    return { status: 503, text: async () => JSON.stringify({ error: 'warming_up', retryAfterSeconds: 5 }) }
  }) as unknown as typeof fetch
  const out = await call<{ error?: string; warmingUp?: boolean }>('/api/settle', 'POST', {}, { fetchImpl: warming, sleep: async () => {} })
  assert.equal(calls, 8)
  assert.equal(out.status, 503)
  assert.equal(out.body.warmingUp, true)
  assert.match(out.body.error ?? '', /warming up/i)
  let other = 0
  const broken = (async () => {
    other++
    return { status: 500, text: async () => JSON.stringify({ error: 'boom' }) }
  }) as unknown as typeof fetch
  const err = await call<{ error?: string }>('/api/sweep', 'GET', undefined, { fetchImpl: broken, sleep: async () => {} })
  assert.deepEqual([other, err.status, err.body.error], [1, 500, 'boom'])
})
