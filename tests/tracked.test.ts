import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { addTracked, readTracked, removeTracked } from '../src/lib/tracked'

const g = globalThis as { localStorage?: unknown }

test('without storage nothing throws and the list lives in memory', () => {
  g.localStorage = undefined
  assert.deepEqual(readTracked(), [])
  const list = addTracked([], '43', 'silent', {}, 1000)
  assert.equal(list[0]?.id, '43')
  assert.deepEqual(removeTracked(list, '43'), [])
})

test('storage that throws on every access is tolerated', () => {
  g.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(readTracked(), [])
  assert.equal(addTracked([], '7', 'buyer-silent').length, 1)
})

test('persists, restores, drops stale or malformed entries, and clears one id', () => {
  const store: Record<string, string> = {}
  g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
  let list = addTracked([], '43', 'silent', { deadline: 1_792_000_000 }, 1_000_000)
  list = addTracked(list, '44', 'buyer-silent', { respondedAt: 5, graceWindow: 120, output: 'X' }, 1_000_100)
  assert.deepEqual(readTracked(1_000_200).map((t) => `${t.id}:${t.kind}`), ['44:buyer-silent', '43:silent'])
  assert.equal(readTracked(1_000_200)[1]?.deadline, 1_792_000_000, 'stored timing survives a reload')
  assert.equal(readTracked(1_000_200)[0]?.output, 'X')
  assert.deepEqual(readTracked(1_000_000 + 7 * 60 * 60 * 1000), [], 'older than the max age')
  list = removeTracked(list, '43')
  assert.deepEqual(readTracked(1_000_200).map((t) => t.id), ['44'])
  store['replybond.active'] = '[{"id":"x1","kind":"silent","at":1},null,5]'
  assert.deepEqual(readTracked(10), [])
})
