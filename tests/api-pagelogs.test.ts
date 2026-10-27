import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { pageLogs, pageRanges } from '../src/lib/pageLogs'

test('pageRanges: exact multiple, remainder, single block, from > to', () => {
  assert.deepEqual(pageRanges(0n, 9_999n), [[0n, 4_999n], [5_000n, 9_999n]])
  assert.deepEqual(pageRanges(100n, 12_000n), [[100n, 5_099n], [5_100n, 10_099n], [10_100n, 12_000n]])
  assert.deepEqual(pageRanges(7n, 7n), [[7n, 7n]])
  assert.deepEqual(pageRanges(8n, 7n), [])
  assert.deepEqual(pageRanges(1n, 10n, 4n), [[1n, 4n], [5n, 8n], [9n, 10n]])
})

test('pageLogs: 5,000-block pages never trip a node that rejects wider queries; output is in page order', async () => {
  let thrown = 0
  const calls: [bigint, bigint][] = []
  const fetch = async (from: bigint, to: bigint) => {
    calls.push([from, to])
    if (to - from + 1n > 5_000n) {
      thrown++
      throw new Error('requested range too large')
    }
    // later pages answer first, so ordering must come from the page index
    await new Promise((r) => setTimeout(r, from > 10_000n ? 1 : 10))
    return [from]
  }
  const out = await pageLogs(fetch, 1n, 22_000n)
  assert.equal(thrown, 0)
  assert.deepEqual(out, [1n, 5_001n, 10_001n, 15_001n, 20_001n])
  assert.equal(calls.length, 5)
})

test('pageLogs: a page that still reports a range error is halved inside the page only', async () => {
  const fetch = async (from: bigint, to: bigint) => {
    if (to - from + 1n > 1_500n) throw new Error('query exceeds max block range')
    return [`${from}-${to}`]
  }
  const out = await pageLogs(fetch, 0n, 5_999n)
  const starts = out.map((x) => Number(x.split('-')[0]))
  assert.deepEqual(starts, [...starts].sort((x, y) => x - y), 'halves come back in block order')
  assert.equal(starts[0], 0)
  assert.equal(out[out.length - 1].endsWith('-5999'), true)
})

test('pageLogs: other errors are not retried by splitting', async () => {
  let calls = 0
  await assert.rejects(
    pageLogs(async () => {
      calls++
      throw new Error('connection refused')
    }, 0n, 100n),
    /connection refused/,
  )
  assert.equal(calls, 1)
})
