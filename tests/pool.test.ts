import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { demoBuyerAddress as demoBuyer, providerAddress as provider } from './api-env'
import type { Address } from 'viem'

const { offers } = await import('../src/lib/offers')
const { isPoolStock } = await import('../src/lib/pool')
const { GRACE_WINDOW_S, POOL_GRACE_WINDOW_S } = await import('../src/lib/terms')
const { jobBusyReasons } = await import('../api/_lib/state')
type Snap = Parameters<typeof jobBusyReasons>[0]

const silent = offers.find((o) => o.mode === 'silent')!.requestHash
const normal = offers.find((o) => o.mode === 'normal')!.requestHash
const NOW = 1_000_000

const job = (over: Record<string, unknown> = {}) => ({
  id: 1n,
  provider: provider as Address,
  designated: demoBuyer as Address,
  buyer: demoBuyer as Address,
  requestHash: silent,
  price: 1n,
  bond: 1n,
  graceWindow: POOL_GRACE_WINDOW_S,
  status: 1, // Accepted
  postedAt: NOW - 60,
  deadline: NOW + 30,
  respondedAt: 0,
  responseHash: null,
  txs: {},
  ...over,
})
const snap = (...jobs: ReturnType<typeof job>[]) => ({ now: NOW, head: 1n, fromBlock: 0n, jobs }) as unknown as Snap

test('pool stock: silent fixture, designated to and accepted by the demo buyer, with the pool marker', () => {
  assert.equal(isPoolStock(job(), demoBuyer), true)
  assert.equal(isPoolStock(job({ graceWindow: GRACE_WINDOW_S }), demoBuyer), false, 'a watch-run job keeps the normal grace window')
  assert.equal(isPoolStock(job({ requestHash: normal }), demoBuyer), false)
  assert.equal(isPoolStock(job({ designated: provider }), demoBuyer), false)
  assert.equal(isPoolStock(job({ buyer: provider }), demoBuyer), false)
})

test('busy rule: pool stock is exempt before and after its deadline', () => {
  assert.deepEqual(jobBusyReasons(snap(job({ deadline: NOW + 30 }))), [])
  assert.deepEqual(jobBusyReasons(snap(job({ deadline: NOW - 30 }))), [])
})

test('busy rule: a watch-run job inside its deadline is busy; past its deadline it is not', () => {
  const watch = (deadline: number) => job({ graceWindow: GRACE_WINDOW_S, deadline })
  assert.equal(jobBusyReasons(snap(watch(NOW + 30))).map((r) => r.kind).join(), 'accepted_within_deadline')
  assert.deepEqual(jobBusyReasons(snap(watch(NOW - 1))), [])
})

test('busy rule: a Responded job inside grace is busy, after grace it is not', () => {
  const responded = (respondedAt: number) => job({ status: 2, requestHash: normal, graceWindow: GRACE_WINDOW_S, respondedAt, deadline: NOW - 10 })
  assert.equal(jobBusyReasons(snap(responded(NOW - 10))).map((r) => r.kind).join(), 'responded_within_grace')
  assert.deepEqual(jobBusyReasons(snap(responded(NOW - GRACE_WINDOW_S - 5))), [])
})
