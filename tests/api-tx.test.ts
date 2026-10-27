import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { keccak256 } from 'viem'
import type { Hex } from 'viem'
import './api-env'
import { providerAddress } from './api-env'
import type { Deps } from '../api/_lib/deps'
import { Skipped, isNonceConflict, sendTx } from '../api/_lib/tx'

/** Fake clients. Signing is deterministic: the "serialized tx" is just the nonce, so each nonce has its own hash. */
function rig(opts: { pendingNonces?: number[]; broadcast: (n: number, serialized: Hex) => void; known?: (hash: Hex) => boolean }) {
  const nonces = [...(opts.pendingNonces ?? [7, 8, 9])]
  const log = { broadcasts: [] as Hex[], prepared: [] as number[], lookups: [] as Hex[], precheckRuns: 0 }
  const serializedFor = (nonce: number) => `0x02${nonce.toString(16).padStart(8, '0')}` as Hex
  const pub = {
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    getTransactionCount: async () => nonces.shift() ?? 99,
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      log.broadcasts.push(serializedTransaction)
      opts.broadcast(log.broadcasts.length, serializedTransaction)
      return keccak256(serializedTransaction)
    },
    getTransaction: async ({ hash }: { hash: Hex }) => {
      log.lookups.push(hash)
      if (opts.known?.(hash)) return { hash }
      throw Object.assign(new Error('Transaction not found'), { name: 'TransactionNotFoundError' })
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({ status: 'success', transactionHash: hash, logs: [] }),
  }
  const account = { address: providerAddress }
  const wallet = {
    prepareTransactionRequest: async (req: { nonce: number }) => {
      log.prepared.push(req.nonce)
      return req
    },
    signTransaction: async (req: { nonce: number }) => serializedFor(req.nonce),
  }
  const deps = { pub, wallets: { provider: wallet, buyer: wallet }, accounts: { provider: account, buyer: account } } as unknown as Partial<Deps>
  const precheck = async () => {
    log.precheckRuns++
    return null
  }
  return { deps, log, precheck, hashFor: (n: number) => keccak256(serializedFor(n)) }
}

test('a lost response: "nonce too low" but the hash is known, so nothing is sent again', async () => {
  const r = rig({
    broadcast: () => {
      throw new Error('nonce too low: next nonce 8, tx nonce 7')
    },
    known: (hash) => hash === keccak256('0x0200000007'),
  })
  const out = await sendTx('provider', 'withdrawOffer', [1n], { precheck: r.precheck }, r.deps)
  assert.equal(r.log.broadcasts.length, 1)
  assert.equal(out.hash, r.hashFor(7))
  assert.equal(out.receipt.status, 'success')
  assert.equal(r.log.precheckRuns, 1, 'no second precheck without a second broadcast')
})

test('an unknown hash plus a nonce conflict: exactly one resend, with the next nonce', async () => {
  const r = rig({
    pendingNonces: [7, 8],
    broadcast: (n) => {
      if (n === 1) throw new Error('nonce has already been used')
    },
  })
  const out = await sendTx('provider', 'withdrawOffer', [1n], { precheck: r.precheck }, r.deps)
  assert.equal(r.log.broadcasts.length, 2)
  assert.deepEqual(r.log.prepared, [7, 8])
  assert.equal(out.hash, r.hashFor(8))
  assert.equal(r.log.precheckRuns, 2, 'the precheck runs again before the resend')
})

test('never more than two broadcasts: a second nonce conflict with an unknown hash is rethrown', async () => {
  const r = rig({
    broadcast: () => {
      throw new Error('nonce too low')
    },
  })
  await assert.rejects(sendTx('provider', 'withdrawOffer', [1n], {}, r.deps), /nonce too low/)
  assert.equal(r.log.broadcasts.length, 2)
})

test('"already known" with an unknown hash is rethrown, not resent', async () => {
  const r = rig({
    broadcast: () => {
      throw new Error('already known')
    },
  })
  await assert.rejects(sendTx('provider', 'withdrawOffer', [1n], {}, r.deps), /already known/)
  assert.equal(r.log.broadcasts.length, 1)
})

test('"already known" with the hash found waits for that receipt', async () => {
  const r = rig({
    broadcast: () => {
      throw new Error('already known')
    },
    known: () => true,
  })
  const out = await sendTx('provider', 'withdrawOffer', [1n], {}, r.deps)
  assert.equal(r.log.broadcasts.length, 1)
  assert.equal(out.hash, r.hashFor(7))
})

test('"replacement transaction underpriced" is rethrown with no resend', async () => {
  const r = rig({
    broadcast: () => {
      throw new Error('replacement transaction underpriced')
    },
  })
  await assert.rejects(sendTx('provider', 'withdrawOffer', [1n], {}, r.deps), /underpriced/)
  assert.equal(r.log.broadcasts.length, 1)
})

test('when the precheck now says no, the resend becomes Skipped', async () => {
  let runs = 0
  const r = rig({
    broadcast: () => {
      throw new Error('nonce too low')
    },
  })
  const precheck = async () => (++runs === 1 ? null : 'job is no longer Open')
  await assert.rejects(sendTx('provider', 'withdrawOffer', [1n], { precheck }, r.deps), (e) => e instanceof Skipped && /no longer Open/.test(e.message))
  assert.equal(r.log.broadcasts.length, 1)
})

test('isNonceConflict reads the message and nested causes', () => {
  assert.equal(isNonceConflict(new Error('Nonce too low')), true)
  assert.equal(isNonceConflict(Object.assign(new Error('Execution reverted'), { cause: { details: 'nonce has already been used' } })), true)
  assert.equal(isNonceConflict(new Error('already known')), false)
  assert.equal(isNonceConflict(undefined), false)
})
