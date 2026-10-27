import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import type { Hex } from 'viem'
import { NOW, job, normalHash, silentHash, snap, watchJob } from './api-helpers'
import { demoBuyerAddress, otherAddress, providerAddress } from './api-env'
import { Status, replyBondAbi } from '../src/lib/abi'
import { runSweep } from '../api/_lib/actions'
import { ctx } from '../api/_lib/config'
import type { Deps } from '../api/_lib/deps'
import { refill } from '../api/_lib/flows'
import type { Snapshot } from '../api/_lib/state'
import { Skipped } from '../api/_lib/tx'

const HASH = `0x${'ab'.repeat(32)}` as Hex

interface Call { who: string; fn: string; args: readonly unknown[]; at: number }

/** Fake clock, fake sends, a queue of snapshots (the last one repeats). Nothing touches the network. */
function fakes(snapshots: Snapshot[], opts: { sendMs?: number; failOn?: (c: Call) => Error | undefined } = {}) {
  const clock = { t: 1_000_000 }
  const calls: Call[] = []
  let i = 0
  const deps = {
    now: () => clock.t,
    snapshot: async () => snapshots[Math.min(i++, snapshots.length - 1)],
    pub: { getBalance: async () => 10n ** 18n },
    readJob: async () => ({ deadline: NOW + 45, status: Status.Accepted, respondedAt: 0, graceWindow: 0 }),
    respond: async () => ({ status: 200, body: { txHash: HASH } }),
    send: async (who: string, fn: string, args: readonly unknown[]) => {
      const call = { who, fn, args, at: clock.t }
      calls.push(call)
      clock.t += opts.sendMs ?? 0
      const err = opts.failOn?.(call)
      if (err) throw err
      if (fn === 'postOffer') {
        const id = BigInt(calls.length)
        const topics = encodeEventTopics({ abi: replyBondAbi, eventName: 'OfferPosted', args: { id, provider: providerAddress, buyer: demoBuyerAddress } })
        const data = encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' }, { type: 'uint64' }],
          [silentHash, 1n, 1n, 45n, 1n],
        )
        return { hash: HASH, receipt: { logs: [{ address: ctx().replyBond, topics, data }] } }
      }
      return { hash: HASH, receipt: { logs: [] } }
    },
  }
  return { clock, calls, deps: deps as unknown as Partial<Deps> }
}

const stock = (n: number, over: Partial<ReturnType<typeof job>> = {}) => Array.from({ length: n }, () => job(over))

test('refill without rotate never calls timeout, even with ready stock around', async () => {
  const ready = stock(2, { deadline: NOW - 30 })
  const f = fakes([snap(ready)]) // two ready stock jobs, below the target of three
  const r = await refill({ rotate: false }, f.deps)
  assert.equal(f.calls.some((c) => c.fn === 'timeout'), false)
  assert.equal(f.calls[0]?.fn, 'postOffer', 'it only tops up')
  assert.deepEqual(r.body.rotated, [])
})

test('refill without rotate at the target does nothing at all', async () => {
  const f = fakes([snap(stock(3, { deadline: NOW - 30 }))])
  const r = await refill({ rotate: false }, f.deps)
  assert.equal(f.calls.length, 0)
  assert.equal(r.body.note, 'pool already at target')
})

test('refill with rotate times out every ready stock job, oldest first, then reloads', async () => {
  const a = job({ deadline: NOW - 90 })
  const b = job({ deadline: NOW - 40 })
  const c = job({ deadline: NOW - 5 })
  const waiting = [job({ deadline: NOW + 40 }), job({ deadline: NOW + 41 }), job({ deadline: NOW + 42 })]
  const f = fakes([snap([a, b, c]), snap(waiting)], {
    failOn: (call) => (call.args[0] === b.id ? new Skipped('already settled') : undefined),
  })
  const r = await refill({ rotate: true }, f.deps)
  assert.deepEqual(f.calls.map((x) => [x.who, x.fn, x.args[0]]), [['buyer', 'timeout', a.id], ['buyer', 'timeout', b.id], ['buyer', 'timeout', c.id]])
  assert.deepEqual((r.body.rotated as { jobId: bigint }[]).map((x) => x.jobId), [a.id, c.id], 'a skipped job is not reported as rotated')
  assert.equal(f.calls.some((x) => x.fn === 'postOffer'), false, 'the reloaded pool is already at target')
})

test('refill re-reads the pool before every pair and stops at the target', async () => {
  // empty at the start; by the time of the second pair a concurrent refill filled the pool
  const f = fakes([snap([]), snap(stock(3, { deadline: NOW + 40 }))])
  const r = await refill({ rotate: false }, f.deps)
  assert.deepEqual(f.calls.map((x) => x.fn), ['postOffer', 'acceptOffer'])
  assert.equal(r.body.attempted, 1)
  assert.equal((r.body.created as unknown[]).length, 1)
})

test('refill: with 4 s left it starts no timeout and no pair; with 20 s left it rotates but posts nothing', async () => {
  const ready = stock(2, { deadline: NOW - 30 })
  const tight = fakes([snap(ready), snap([])])
  const r1 = await refill({ rotate: true, deadlineMs: 1_000_000 + 4_000 }, tight.deps)
  assert.equal(tight.calls.length, 0)
  assert.equal(r1.body.stoppedForTime, true)
  assert.equal(r1.body.attempted, 0)

  const f = fakes([snap(ready), snap([])], { sendMs: 6_000 })
  const r2 = await refill({ rotate: true, deadlineMs: 1_000_000 + 20_000 }, f.deps)
  // two timeouts start at 0 s and 6 s (14 s left is enough for a timeout), then 8 s left is too little for a pair
  assert.deepEqual(f.calls.map((x) => x.fn), ['timeout', 'timeout'])
  assert.equal(r2.body.stoppedForTime, true)
  for (const c of f.calls) assert.ok(1_000_000 + 20_000 - c.at >= 5_000, 'no timeout starts with less than 5 s left')
})

test('runSweep: no action starts after the budget, the rest are reported', async () => {
  const claimable = (i: number) => watchJob({ requestHash: normalHash, status: Status.Responded, respondedAt: NOW - 500 - i, deadline: NOW - 600 })
  const jobs = [claimable(0), claimable(1), claimable(2)]
  const f = fakes([snap(jobs)], { sendMs: 6_000 })
  const budget = 1_000_000 + 10_000
  const out = await runSweep(budget, f.deps)
  assert.equal(f.calls.length, 2, 'the third claim would start at 12 s, after the 10 s budget')
  for (const c of f.calls) assert.ok(c.at < budget)
  assert.equal(out.claimed.length, 2)
  assert.deepEqual(out.skipped.map((s) => [s.jobId, s.why]), [[jobs[2].id, 'budget']])
})

test('runSweep without a budget runs the whole plan, and errors never carry a URL or token', async () => {
  const jobs = [watchJob({ requestHash: normalHash, status: Status.Responded, respondedAt: NOW - 500, deadline: NOW - 600 })]
  const f = fakes([snap(jobs)], { failOn: () => new Error('HTTP request failed. URL: https://rpc.example/x?_rpc_token=sekrit') })
  const out = await runSweep(undefined, f.deps)
  assert.equal(out.errors.length, 1)
  assert.equal(out.errors[0].error.includes('sekrit'), false)
  assert.equal(out.errors[0].error.includes('https://'), false)
})

test('runSweep: a silent job is never answered, a normal one inside its deadline is', async () => {
  const silentRunning = watchJob({ deadline: NOW + 30 })
  const normalRunning = watchJob({ requestHash: normalHash, deadline: NOW + 30, buyer: otherAddress, designated: otherAddress })
  const answered: bigint[] = []
  const f = fakes([snap([silentRunning, normalRunning])])
  ;(f.deps as { respond: unknown }).respond = async (id: bigint) => {
    answered.push(id)
    return { status: 200, body: { txHash: HASH } }
  }
  const out = await runSweep(undefined, f.deps)
  assert.deepEqual(answered, [normalRunning.id])
  assert.equal(out.responded.length, 1)
})

test('the on-demand refill carries a 45 s deadline and never rotates; the cron call keeps 50 s', async () => {
  const { refillOptions } = await import('../api/_lib/flows')
  assert.deepEqual(refillOptions(false, 1_000_000), { rotate: false, deadlineMs: 1_045_000 })
  assert.deepEqual(refillOptions(true, 1_000_000), { rotate: true, deadlineMs: 1_050_000 })
})

test('on-demand refill with a slow chain: no pair starts with less than 15 s left, and the stop is reported', async () => {
  const { refillOptions } = await import('../api/_lib/flows')
  // each send takes 10 s, so a post+accept pair takes 20 s: pair 1 starts at 0 s, pair 2 at 20 s, and at 40 s only 5 s are left
  const f = fakes([snap([])], { sendMs: 10_000 })
  const r = await refill(refillOptions(false, f.clock.t), f.deps)
  assert.deepEqual(f.calls.map((c) => c.fn), ['postOffer', 'acceptOffer', 'postOffer', 'acceptOffer'])
  assert.equal(r.body.attempted, 2)
  assert.equal(r.body.planned, 3)
  assert.equal(r.body.stoppedForTime, true)
  assert.equal(f.calls.some((c) => c.fn === 'timeout'), false, 'the on-demand call never rotates')
  const deadline = 1_000_000 + 45_000
  for (const c of f.calls.filter((x) => x.fn === 'postOffer')) assert.ok(deadline - c.at >= 15_000, 'a pair starts with at least 15 s left')
  assert.ok(f.clock.t <= deadline, 'the call ends inside its budget')
})

test('on-demand refill on a fast chain still fills the pool', async () => {
  const { refillOptions } = await import('../api/_lib/flows')
  // each re-read of the pool shows what the previous pairs added
  const waiting = (n: number) => snap(Array.from({ length: n }, () => job({ deadline: NOW + 40 })))
  const f = fakes([snap([]), waiting(1), waiting(2), waiting(3)], { sendMs: 100 })
  const r = await refill(refillOptions(false, f.clock.t), f.deps)
  assert.equal(r.body.attempted, 3)
  assert.equal(r.body.stoppedForTime, false)
})
