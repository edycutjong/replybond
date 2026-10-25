import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { hashInput, offers, recordByMode } from '../api/_lib/fixtures.js'

// Turn 1 test vectors (contracts/test/ReplyBond.t.sol: H_INVOICE and H_SUMMARISE).
const H_INVOICE = '0x7d43cb7cf12f8ae72119ab31a72c43c76a0a0a20a7539b566ab40d38e4e36299'
const H_SUMMARISE = '0x2349bb5ca916e84effd0922e6989818c3307763aba9615435f5a0fa8e5d8d662'

test('fixture file has exactly one normal and one silent record', () => {
  assert.equal(offers.length, 2)
  assert.deepEqual(offers.map((o) => o.mode).sort(), ['normal', 'silent'])
})

test('requestHash is keccak256 of the input bytes, computed the way the routes do', () => {
  for (const o of offers) assert.equal(hashInput(o.input), o.requestHash, o.id)
})

test('fixtures equal the Turn 1 test-vector constants', () => {
  const normal = recordByMode('normal')
  const silent = recordByMode('silent')
  assert.equal(normal.input, 'invoice #4471 is ready for review')
  assert.equal(silent.input, 'summarise: q3 vendor contract')
  assert.equal(hashInput(normal.input), H_INVOICE)
  assert.equal(hashInput(silent.input), H_SUMMARISE)
  assert.equal(normal.requestHash, H_INVOICE)
  assert.equal(silent.requestHash, H_SUMMARISE)
})

test('src/offers.json mirrors the TypeScript fixture module the routes import', () => {
  const json = JSON.parse(readFileSync(new URL('../src/offers.json', import.meta.url), 'utf8')) as unknown
  assert.deepEqual(json, offers)
})
