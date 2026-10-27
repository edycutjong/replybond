import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { MAINNET_PROOF_TIMEOUT_TX, networkLabel, proofTimeoutTx } from '../src/lib/proof'
import { orderLogs } from '../src/lib/pageLogs'

test('proofTimeoutTx: mainnet defaults to job 6, an override wins, every other chain has none', () => {
  assert.equal(proofTimeoutTx(5042, undefined), MAINNET_PROOF_TIMEOUT_TX)
  assert.equal(MAINNET_PROOF_TIMEOUT_TX, '0x7312e5db712a360e5b582e0f0afa0a9b96e4ce228d89036d6fcd5aae26783a77')
  const mine = `0x${'ab'.repeat(32)}`
  assert.equal(proofTimeoutTx(5042, mine), mine)
  assert.equal(proofTimeoutTx(5042002, mine), mine, 'an explicit override works on any chain')
  assert.equal(proofTimeoutTx(5042, 'not a hash'), MAINNET_PROOF_TIMEOUT_TX, 'an invalid override is ignored')
  assert.equal(proofTimeoutTx(5042002, undefined), null, 'testnet: nothing pinned, no read attempted')
  assert.equal(proofTimeoutTx(5042002, '0x1234'), null)
  assert.equal(proofTimeoutTx(1, undefined), null)
})

test('networkLabel: "Arc mainnet" and "Arc testnet", no doubled suffix', () => {
  assert.equal(networkLabel(5042, 'Arc', false), 'Arc mainnet')
  assert.equal(networkLabel(5042002, 'Arc Testnet', true), 'Arc testnet')
  assert.equal(networkLabel(84532, 'Base Sepolia', true), 'Base Sepolia testnet')
  assert.equal(networkLabel(11155111, 'Ethereum Sepolia', true), 'Ethereum Sepolia testnet')
  assert.equal(networkLabel(8453, 'Base', false), 'Base')
})

test('orderLogs: shuffled input with one duplicate comes back sorted and deduped', () => {
  const log = (blockNumber: bigint, logIndex: number, tx: string) => ({ blockNumber, logIndex, transactionHash: tx })
  const a = log(10n, 0, '0xa')
  const b = log(10n, 3, '0xa')
  const c = log(11n, 1, '0xb')
  const d = log(12n, 0, '0xc')
  const out = orderLogs([d, b, c, a, { ...b }])
  assert.deepEqual(out, [a, b, c, d])
  assert.equal(orderLogs([]).length, 0)
})
