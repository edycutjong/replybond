import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { NOW, job, normalHash, snap, watchJob } from './api-helpers'
import { demoBuyerAddress, otherAddress } from './api-env'
import { Status } from '../src/lib/abi'
import { planSweep, SWEEP_SETTLE_CAP } from '../api/_lib/actions'
import { LIMITS, MIN_WALLET_BALANCE } from '../api/_lib/config'
import { emptySettleBody, floorOk, orphanedExpired, poolStatus, rateStatus, reusableOffer, rotationCandidates } from '../api/_lib/state'

test('rotationCandidates: ready stock in, oldest first; waiting stock, non-stock and other buyers out', () => {
  const late = job({ deadline: NOW - 5 })
  const early = job({ deadline: NOW - 50 })
  const waiting = job({ deadline: NOW + 20 })
  const watched = watchJob({ deadline: NOW - 10 }) // silent but with the normal grace: a watch run, not stock
  const otherBuyer = job({ designated: otherAddress, buyer: otherAddress })
  const settled = job({ status: Status.TimedOut })
  const ids = rotationCandidates(snap([late, early, waiting, watched, otherBuyer, settled])).map((j) => j.id)
  assert.deepEqual(ids, [early.id, late.id])
})

test('orphanedExpired: an expired normal demo-buyer job is in; another buyer and pool stock are out', () => {
  const stuckNormal = job({ requestHash: normalHash, graceWindow: 120, deadline: NOW - 3 })
  const stuckSilent = watchJob({ deadline: NOW - 3 })
  const walletBuyer = job({ requestHash: normalHash, graceWindow: 120, designated: otherAddress, buyer: otherAddress })
  const stock = job()
  const stillRunning = watchJob({ requestHash: normalHash, deadline: NOW + 30 })
  const ids = orphanedExpired(snap([stuckNormal, stuckSilent, walletBuyer, stock, stillRunning])).map((j) => j.id)
  assert.deepEqual(ids, [stuckNormal.id, stuckSilent.id])
})

test('emptySettleBody: no stock at all suggests a refill; waiting stock keeps the countdown note', () => {
  const none = emptySettleBody(poolStatus(snap([])))
  assert.equal(none.refillSuggested, true)
  assert.equal(none.note, 'No pooled job is ready; the page will request a refill.')
  assert.equal(none.settled, false)

  const waitingOnly = emptySettleBody(poolStatus(snap([job({ deadline: NOW + 12 })])))
  assert.equal(waitingOnly.refillSuggested, false)
  assert.equal(waitingOnly.note, 'Next one ready in 13 s.')
  assert.equal(waitingOnly.nextReadyInSeconds, 13)
})

test('floorOk: both wallets must reach the floor, exactly at the floor passes', () => {
  const min = MIN_WALLET_BALANCE
  assert.equal(floorOk(min, min, min), true)
  assert.equal(floorOk(min + 1n, min * 5n, min), true)
  assert.equal(floorOk(min - 1n, min, min), false)
  assert.equal(floorOk(min, min - 1n, min), false)
  assert.equal(floorOk(0n, 0n, min), false)
})

const postedAt = (n: number, ageSeconds: number) => Array.from({ length: n }, (_, i) => job({ postedAt: NOW - ageSeconds - i }))

test('rateStatus: 20 per hour', () => {
  assert.equal(LIMITS.hour, 20)
  assert.equal(rateStatus(snap(postedAt(19, 60)), 1).allowed, true)
  const full = rateStatus(snap(postedAt(20, 60)), 1)
  assert.equal(full.allowed, false)
  assert.equal(full.hour.count, 20)
  assert.equal(full.hour.max, 20)
  assert.equal(rateStatus(snap(postedAt(19, 60)), 2).allowed, false)
  // the oldest post (60 + 19 s ago) leaves the hour window 3600 s after it was posted
  assert.equal(full.retryAt, NOW - 60 - 19 + 3600)
})

test('rateStatus: 80 per day, older posts outside the hour do not count against the hour', () => {
  assert.equal(LIMITS.day, 80)
  const fiveHoursAgo = 5 * 3600
  assert.equal(rateStatus(snap(postedAt(79, fiveHoursAgo)), 1).allowed, true)
  const full = rateStatus(snap(postedAt(80, fiveHoursAgo)), 1)
  assert.equal(full.allowed, false)
  assert.equal(full.hour.count, 0)
  assert.equal(full.day.count, 80)
  assert.equal(full.day.max, 80)
  assert.equal(rateStatus(snap(postedAt(80, 25 * 3600)), 1).allowed, true, 'posts older than a day are free')
})

test('reusableOffer: a fresh Open normal offer for the same buyer, nothing else', () => {
  const open = (over = {}) => job({ requestHash: normalHash, graceWindow: 120, status: Status.Open, designated: otherAddress, buyer: otherAddress, deadline: 0, postedAt: NOW - 100, ...over })
  const fresh = open()
  assert.equal(reusableOffer(snap([fresh]), otherAddress)?.id, fresh.id)
  assert.equal(reusableOffer(snap([open({ postedAt: NOW - 301 })]), otherAddress), undefined, 'older than 300 s')
  assert.equal(reusableOffer(snap([fresh]), demoBuyerAddress), undefined, 'another buyer')
  assert.equal(reusableOffer(snap([open({ requestHash: job().requestHash })]), otherAddress), undefined, 'silent fixture')
  assert.equal(reusableOffer(snap([open({ status: Status.Accepted })]), otherAddress), undefined, 'already accepted')
  const newer = open()
  assert.equal(reusableOffer(snap([fresh, newer]), otherAddress)?.id, newer.id, 'newest wins')
})

test('planSweep: responds first (soonest deadline), then claims, then withdrawals, capped at three', () => {
  const respondLate = watchJob({ requestHash: normalHash, deadline: NOW + 40 })
  const respondSoon = watchJob({ requestHash: normalHash, deadline: NOW + 5 })
  const silentRunning = watchJob({ deadline: NOW + 30 }) // never answered
  const claimable = (i: number) => watchJob({ requestHash: normalHash, status: Status.Responded, respondedAt: NOW - 500 - i, deadline: NOW - 600 })
  const claims = [claimable(0), claimable(1), claimable(2), claimable(3)]
  const stale = (i: number) => job({ requestHash: normalHash, graceWindow: 120, status: Status.Open, designated: otherAddress, buyer: otherAddress, deadline: 0, postedAt: NOW - 700 - i })
  const withdraws = [stale(0), stale(1)]

  const plan = planSweep(snap([...withdraws, ...claims, respondLate, silentRunning, respondSoon]))
  assert.deepEqual(plan.actions.map((a) => a.action), ['respond', 'respond', 'claim', 'claim', 'claim'])
  assert.deepEqual(plan.actions.slice(0, 2).map((a) => a.jobId), [respondSoon.id, respondLate.id])
  assert.equal(plan.actions.filter((a) => a.action !== 'respond').length, SWEEP_SETTLE_CAP)
  // what did not fit is reported, claims before withdrawals
  assert.deepEqual(plan.skipped.map((s) => [s.action, s.why]), [['claim', 'cap'], ['withdraw', 'cap'], ['withdraw', 'cap']])
  assert.deepEqual(plan.skipped.map((s) => s.jobId), [claims[3].id, withdraws[0].id, withdraws[1].id])
})

test('planSweep: nothing to do', () => {
  assert.deepEqual(planSweep(snap([job()])), { actions: [], skipped: [] })
})
