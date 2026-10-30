import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  HONEST_QUOTES, REPLAY_SPEED, TAPE_FIRST_MS, TAPE_STEP_MS, chipText, clockRunMs, clockText, endingsStrip, faqItems, finalReplayState,
  receiptStats, replayCaption, replayEndMs, replayState, shortTx, shouldStamp, stubPendingLabel, tapeFor,
} from '../src/lib/landingModel'
import { MAINNET_PROOF, TEST_COUNTS, proofSteps } from '../src/lib/proof'
import { BOND, DEMO_OFFER_LIMITS, GRACE_WINDOW_S, MIN_WALLET_BALANCE_NATIVE, PRICE } from '../src/lib/terms'

// A stand-in formatter with the same shape as fmtUsdc: 18 decimals, at least three fraction digits.
const fmt = (raw: bigint) => {
  const whole = raw / 10n ** 18n
  let frac = (raw % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  while (frac.length < 3) frac += '0'
  return `${whole}.${frac}`
}
const total = fmt(PRICE + BOND)
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('replay timeline', () => {
  it('waits at the full clock before it starts', () => {
    const s = replayState(-1, 45)
    assert.equal(s.started, false)
    assert.equal(s.clock, '00:45')
    assert.equal(s.barScale, 1)
    assert.equal(s.stamp, false)
    assert.equal(s.tapeLines, 0)
  })
  it('runs the window down at the replay speed', () => {
    assert.equal(REPLAY_SPEED, 15)
    assert.equal(clockRunMs(45), 3000)
    const start = replayState(0, 45)
    assert.equal(start.started, true)
    assert.equal(start.left, 45)
    const mid = replayState(1500, 45)
    assert.equal(mid.left, 22.5)
    assert.equal(mid.clock, '00:23')
    assert.equal(mid.barScale, 0.5)
    assert.equal(mid.done, false)
    assert.equal(mid.stamp, false)
  })
  it('stamps when the clock is out and types the tape 380 ms apart', () => {
    const run = clockRunMs(45)
    const at = (since: number) => replayState(run + since, 45)
    assert.equal(at(0).clock, '00:00')
    assert.equal(at(0).stamp, true)
    assert.equal(at(0).tapeLines, 0)
    assert.equal(at(TAPE_FIRST_MS - 1).tapeLines, 0)
    assert.equal(at(TAPE_FIRST_MS).tapeLines, 1)
    assert.equal(at(TAPE_FIRST_MS + TAPE_STEP_MS).tapeLines, 2)
    assert.equal(at(TAPE_FIRST_MS + 2 * TAPE_STEP_MS).tapeLines, 3)
    assert.equal(at(60_000).tapeLines, 3)
    assert.equal(replayEndMs(45), run + TAPE_FIRST_MS + 2 * TAPE_STEP_MS)
  })
  it('follows the job window, not a fixed 45', () => {
    assert.equal(replayState(0, 60).clock, '01:00')
    assert.equal(clockRunMs(60), 4000)
    assert.equal(replayState(4000, 60).done, true)
  })
  it('shows the final state at once for reduced motion', () => {
    const f = finalReplayState(45)
    assert.equal(f.done, true)
    assert.equal(f.stamp, true)
    assert.equal(f.tapeLines, 3)
    assert.equal(f.clock, '00:00')
  })
  it('formats the clock, rounding up so it reads 00:00 only when time is out', () => {
    assert.equal(clockText(0.2), '00:01')
    assert.equal(clockText(0), '00:00')
    assert.equal(clockText(-3), '00:00')
    assert.equal(clockText(75), '01:15')
  })
})

describe('stamp rule', () => {
  it('stamps only a PAID timeout', () => {
    assert.equal(shouldStamp({ kind: 'PAID', event: 'JobTimedOut' }), true)
    assert.equal(shouldStamp({ kind: 'PAID', event: 'JobClaimed' }), false)
    assert.equal(shouldStamp({ kind: 'PAID', event: 'JobPaid' }), false)
    assert.equal(shouldStamp({ kind: 'OWED', event: 'JobTimedOut' }), false)
    assert.equal(shouldStamp({ kind: 'UNREADABLE', event: 'JobTimedOut' }), false)
    assert.equal(shouldStamp({ kind: 'PAID', event: null }), false)
    assert.equal(shouldStamp(null), false)
  })
})

describe('buyer stub label', () => {
  it('says pending until the payout is confirmed, and why not if it never is', () => {
    assert.equal(stubPendingLabel({ hasCard: false, stamped: false, done: false, kind: undefined }), '')
    assert.equal(stubPendingLabel({ hasCard: true, stamped: false, done: false, kind: 'PAID' }), 'pending')
    assert.equal(stubPendingLabel({ hasCard: true, stamped: true, done: true, kind: 'PAID' }), '')
    assert.equal(stubPendingLabel({ hasCard: true, stamped: false, done: true, kind: 'OWED' }), 'owed')
    assert.equal(stubPendingLabel({ hasCard: true, stamped: false, done: true, kind: 'UNREADABLE' }), 'not confirmed')
  })
})

describe('captions, chip and tape', () => {
  it('labels a replay with its speed-up and the real window', () => {
    assert.equal(chipText('replay'), 'Replay · sped up ×15')
    assert.equal(
      replayCaption({ mode: 'replay', jobId: '0006', windowS: 45, network: 'Arc mainnet' }),
      'Replay of job 6, a real timeout settled on Arc mainnet, sped up ×15 (the real window is 45 s). Settle sends a new one.',
    )
  })
  it('makes no speed claim for the visitor\'s own settlement', () => {
    assert.equal(chipText('live'), 'Your settlement · live')
    const c = replayCaption({ mode: 'live', jobId: '12', windowS: 45, network: 'Arc mainnet' })
    assert.ok(!/sped up|×/.test(c))
    assert.ok(c.includes('Arc mainnet'))
  })
  it('builds the three receipt lines from the settled job', () => {
    const hash = MAINNET_PROOF.txs.timeout
    const lines = tapeFor({ jobId: '0006', amount: total, payeeShort: MAINNET_PROOF.timeoutPayeeShort, hash, hashShort: shortTx(hash) })
    assert.equal(lines.length, 3)
    assert.equal(lines[0]!.text, 'timeout(6)')
    assert.equal(lines[0]!.status, 'status 1')
    assert.equal(lines[1]!.text, `Transfer +${total} USDC → buyer ${MAINNET_PROOF.timeoutPayeeShort}`)
    assert.equal(lines[2]!.hash, hash)
    assert.equal(lines[2]!.hashShort, '0x7312e5db…3a77')
  })
})

describe('endings strip and ledger', () => {
  it('uses jobs 5, 6 and 7 from the proof config, with the red stamp only on the timeout', () => {
    assert.deepEqual(MAINNET_PROOF.jobs, { acknowledge: 5, timeout: 6, claim: 7 })
    const e = endingsStrip(fmt, 45)
    assert.deepEqual(e.map((x) => x.jobId), [5, 6, 7])
    assert.deepEqual(e.map((x) => x.mark), ['postmark', 'stamp', 'postmark'])
    assert.deepEqual(e[1]!.markLines, ['Indemnity paid', `+${total} USDC`])
    assert.deepEqual(e[0]!.markLines, ['PAID', 'ON TIME'])
    assert.deepEqual(e[2]!.markLines, ['PAID ·', 'BUYER SILENT'])
    assert.ok(e[1]!.text.includes('45 s'))
    for (const x of e) assert.ok(x.text.includes(total))
  })
  it('lists the six transactions with their results from the job terms', () => {
    const steps = proofSteps(fmt)
    assert.equal(steps.length, Object.keys(MAINNET_PROOF.txs).length)
    assert.equal(steps.length, 6)
    assert.deepEqual(steps.map((s) => s.name), ['postOffer', 'acceptOffer', 'respond', 'acknowledge', 'timeout', 'claim'])
    assert.equal(steps[0]!.result, `provider posts a ${fmt(BOND)} bond`)
    assert.equal(steps[4]!.result, `buyer +${total}`)
  })
})

describe('receipts, honest quotes and faq', () => {
  it('reads every receipt from code', () => {
    const [a, b, c, d] = receiptStats(fmt)
    assert.equal(a!.value, Number(total))
    assert.equal(a!.decimals, 3)
    assert.equal(b!.value, 6)
    assert.equal(c!.value, TEST_COUNTS.forge)
    assert.equal(d!.value, TEST_COUNTS.bun)
    assert.ok(c!.label.includes(String(TEST_COUNTS.invariants.runs)))
    assert.equal(c!.label, 'forge tests pass (pinned forge 1.7.1), including 3 invariants at 256 runs')
    assert.ok(d!.label.includes(String(TEST_COUNTS.bunFiles)))
  })
  it('takes the FAQ figures from the terms and limits', () => {
    const items = faqItems({ network: 'Arc mainnet', chainId: 5042, isMainnet: true, fmt, windowS: 45 })
    assert.equal(items.length, 6)
    const all = items.map((i) => `${i.q} ${i.a}`).join(' ')
    assert.ok(all.includes(`${DEMO_OFFER_LIMITS.hour} new offers per hour and ${DEMO_OFFER_LIMITS.day} per day`))
    assert.ok(all.includes(`${GRACE_WINDOW_S} s grace`))
    assert.ok(all.includes(fmt(MIN_WALLET_BALANCE_NATIVE)))
    assert.ok(items[0]!.a.startsWith('Yes.'))
    const test = faqItems({ network: 'Arc testnet', chainId: 5042002, isMainnet: false, fmt, windowS: 45 })
    assert.ok(!test[0]!.a.startsWith('Yes.'))
  })
  it('quotes the README\'s Honest limits word for word', () => {
    const limits = readme.slice(readme.indexOf('## Honest limits'), readme.indexOf('## How Arc Studio built it')).toLowerCase()
    assert.ok(limits.length > 100)
    for (const q of HONEST_QUOTES) assert.ok(limits.includes(q.toLowerCase().replace(/\.$/, '')), q)
  })
})

describe('test counts', () => {
  it('match the README Tests line', () => {
    const line = readme.split('\n').find((l) => l.startsWith('**Tests:**')) ?? ''
    assert.ok(line.includes(`${TEST_COUNTS.forge} passed`), line)
    assert.ok(line.includes(`${TEST_COUNTS.bun} passed`), line)
    assert.ok(line.includes(`(${TEST_COUNTS.bunFiles} files)`), line)
    assert.ok(line.includes('pinned forge 1.7.1 (`.foundry-version`)'), line)
    assert.ok(line.includes('forge 1.8 runs the 3 invariants as one campaign and prints 64 passed'), line)
    assert.equal(readFileSync(new URL('../.foundry-version', import.meta.url), 'utf8').trim(), 'v1.7.1')
  })
})
