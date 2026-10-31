import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cardTerms } from '../src/lib/cardTerms'
import { addTracked, readTracked } from '../src/lib/tracked'
import {
  BOND, BOND_CHOICES, DEFAULT_BOND_CHOICE, DEFAULT_WINDOW_CHOICE, PRICE, RESPONSE_WINDOW_S, WINDOW_CHOICES_S, bondOf, parseTermsChoice, payoutLine, payoutTotal,
} from '../src/lib/terms'

// Same shape as fmtUsdc: 18 decimals, at least three fraction digits.
const fmt = (raw: bigint) => {
  let frac = (raw % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  while (frac.length < 3) frac += '0'
  return `${raw / 10n ** 18n}.${frac}`
}

describe('terms choices', () => {
  it('offers small fixed sets whose defaults are the existing terms', () => {
    assert.deepEqual([...WINDOW_CHOICES_S], [30, 45, 90])
    assert.deepEqual([...BOND_CHOICES], ['0.005', '0.010', '0.020'])
    assert.equal(DEFAULT_WINDOW_CHOICE, RESPONSE_WINDOW_S)
    assert.equal(bondOf(DEFAULT_BOND_CHOICE), BOND)
  })
  it('uses the defaults when nothing is sent, and says nothing was chosen', () => {
    const r = parseTermsChoice({})
    assert.ok(r.ok)
    assert.deepEqual(r.terms, { windowS: 45, bond: BOND })
    assert.equal(r.chosen, false)
  })
  it('accepts every allowed window and bond, alone or together', () => {
    for (const windowS of WINDOW_CHOICES_S) {
      for (const bond of BOND_CHOICES) {
        const r = parseTermsChoice({ windowS, bond })
        assert.ok(r.ok)
        assert.deepEqual(r.terms, { windowS, bond: bondOf(bond) })
        assert.equal(r.chosen, true)
      }
    }
    const onlyWindow = parseTermsChoice({ windowS: 90 })
    assert.ok(onlyWindow.ok && onlyWindow.terms.windowS === 90 && onlyWindow.terms.bond === BOND && onlyWindow.chosen)
    const onlyBond = parseTermsChoice({ bond: '0.020' })
    assert.ok(onlyBond.ok && onlyBond.terms.windowS === 45 && onlyBond.terms.bond === bondOf('0.020'))
  })
  it('rejects anything else, with a message that names the allowed values', () => {
    for (const windowS of [0, 29, 31, 44, 60, 91, 120, -45, 45.5, NaN, '45', '30', null, true, [45], {}]) {
      const r = parseTermsChoice({ windowS })
      assert.ok(!r.ok, `windowS ${String(windowS)}`)
      assert.match(r.error, /windowS must be one of 30, 45, 90/)
    }
    for (const bond of [0.005, 0.01, 0.02, '0.0050', '.005', '0.05', '0.015', '1', '', ' 0.005', '0.005 ', null, false, 5, ['0.005']]) {
      const r = parseTermsChoice({ bond })
      assert.ok(!r.ok, `bond ${JSON.stringify(bond)}`)
      assert.match(r.error, /bond must be one of "0\.005", "0\.010", "0\.020"/)
    }
    assert.ok(!parseTermsChoice({ windowS: 45, bond: 'x' }).ok, 'one bad field fails the pair')
  })
})

describe('payout line', () => {
  it('is the price plus the chosen bond', () => {
    assert.equal(payoutTotal(bondOf('0.005')), PRICE + BOND)
    assert.equal(fmt(payoutTotal(bondOf('0.005'))), '0.015')
    assert.equal(fmt(payoutTotal(bondOf('0.010'))), '0.020')
    assert.equal(fmt(payoutTotal(bondOf('0.020'))), '0.030')
    assert.equal(payoutLine(fmt, bondOf('0.020')), 'If the deadline is missed you get 0.010 + 0.020 = 0.030 USDC back')
    assert.equal(payoutLine(fmt, bondOf('0.005')), 'If the deadline is missed you get 0.010 + 0.005 = 0.015 USDC back')
  })
})

describe('card terms', () => {
  it('draws a job with its on-chain terms, not the defaults', () => {
    const onChain = { price: PRICE, bond: bondOf('0.020'), responseWindow: 90 }
    const t = cardTerms(onChain, undefined)
    assert.equal(t.responseWindow, 90, 'the countdown runs the job\'s window')
    assert.equal(t.bond, bondOf('0.020'))
    assert.equal(fmt(t.price + t.bond), '0.030', 'the stamp amount is price + the job\'s bond')
  })
  it('lets the chain win over what the server reported, and the server win over the defaults', () => {
    const reported = { bond: bondOf('0.010'), responseWindow: 30 }
    assert.deepEqual(cardTerms(undefined, reported), { price: PRICE, bond: bondOf('0.010'), responseWindow: 30 })
    assert.deepEqual(cardTerms({ price: PRICE, bond: bondOf('0.020'), responseWindow: 90 }, reported), { price: PRICE, bond: bondOf('0.020'), responseWindow: 90 })
    assert.deepEqual(cardTerms(undefined, undefined), { price: PRICE, bond: BOND, responseWindow: RESPONSE_WINDOW_S })
  })
  it('keeps the chosen window and bond across a reload', () => {
    const store = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    try {
      addTracked([], '77', 'silent', { deadline: 1_800_000_090, responseWindow: 90, bond: String(bondOf('0.020')) }, 1_000_000)
      const back = readTracked(1_000_100)[0]
      assert.equal(back?.responseWindow, 90)
      assert.equal(back?.bond, String(bondOf('0.020')))
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })
})
