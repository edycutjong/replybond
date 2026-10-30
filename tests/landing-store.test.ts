import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getLive, registerSettle, requestSettle, sameCard, setLive, subscribeLive } from '../src/lib/landingStore'

const card = (over: Record<string, unknown> = {}) =>
  ({
    jobId: '6',
    price: 10n,
    bond: 5n,
    responseWindow: 45,
    settlement: { txHash: '0xaa', unavailable: false, blockTime: 1, classification: { kind: 'PAID', amount: 15n, payee: '0xbb', event: 'JobTimedOut' } },
    ...over,
  }) as never

describe('landing store', () => {
  it('starts loading with no card, and tells subscribers only about real changes', () => {
    assert.equal(getLive().loading, true)
    assert.equal(getLive().card, null)
    let calls = 0
    const off = subscribeLive(() => calls++)
    setLive({ loading: true }) // no change
    assert.equal(calls, 0)
    setLive({ loading: false, message: 'x' })
    assert.equal(calls, 1)
    setLive({ card: card() })
    assert.equal(calls, 2)
    setLive({ card: card() }) // a rebuilt but identical card is not a change
    assert.equal(calls, 2)
    setLive({ card: card({ jobId: '7' }) })
    assert.equal(calls, 3)
    off()
    setLive({ message: 'y' })
    assert.equal(calls, 3)
  })
  it('compares cards by what is drawn from them', () => {
    assert.equal(sameCard(null, null), true)
    assert.equal(sameCard(card(), null), false)
    assert.equal(sameCard(card(), card()), true)
    assert.equal(sameCard(card(), card({ price: 11n })), false)
    const other = card()
    ;(other as { settlement: { classification: { kind: string } } }).settlement.classification.kind = 'OWED'
    assert.equal(sameCard(card(), other), false)
  })
  it('runs a settle at once when the live module is there, and queues it (and asks for the module) when not', () => {
    let loads = 0
    let runs = 0
    requestSettle(() => loads++)
    assert.equal(loads, 1)
    assert.equal(runs, 0)
    const off = registerSettle(() => runs++) // the queued click runs as the module registers
    assert.equal(runs, 1)
    requestSettle(() => loads++)
    assert.equal(runs, 2)
    assert.equal(loads, 1)
    off()
    requestSettle(() => loads++)
    assert.equal(loads, 2)
  })
})
