import type { Hex, TransactionReceipt } from 'viem'
import { replyBondAbi } from '../../src/lib/abi.js'
import { MIN_MAX_FEE, ctx } from './config.js'

export type WriteFn = 'postOffer' | 'withdrawOffer' | 'acceptOffer' | 'respond' | 'acknowledge' | 'claim' | 'timeout'
export type Who = 'provider' | 'buyer'

/** Thrown when a precheck (run inside the wallet lock) says the transaction is no longer needed. */
export class Skipped extends Error {}

// One promise chain per signing wallet. Kept on globalThis so a dev-server reload keeps the queue.
const g = globalThis as { __replyBondLocks?: Map<string, Promise<unknown>> }
const locks = (g.__replyBondLocks ??= new Map<string, Promise<unknown>>())

/** Serializes submission per wallet: the next send starts only after the previous one has a receipt. */
export function withLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const key = address.toLowerCase()
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  locks.set(key, run.catch(() => undefined))
  return run
}

/** maxFeePerGas is never below 20 gwei. */
export async function feeParams() {
  const est = await ctx().pub.estimateFeesPerGas()
  const maxFeePerGas = est.maxFeePerGas > MIN_MAX_FEE ? est.maxFeePerGas : MIN_MAX_FEE
  const maxPriorityFeePerGas =
    est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas
  return { maxFeePerGas, maxPriorityFeePerGas }
}

export interface SentTx {
  hash: Hex
  receipt: TransactionReceipt
}

export async function sendTx(
  who: Who,
  functionName: WriteFn,
  args: readonly unknown[],
  opts: { value?: bigint; precheck?: () => Promise<string | null> } = {},
): Promise<SentTx> {
  const c = ctx()
  const address = c.accounts[who].address
  return withLock(address, async () => {
    if (opts.precheck) {
      const why = await opts.precheck()
      if (why) throw new Skipped(why)
    }
    const fees = await feeParams()
    const nonce = await c.pub.getTransactionCount({ address, blockTag: 'pending' })
    const hash = await c.wallets[who].writeContract({
      address: c.replyBond,
      abi: replyBondAbi,
      functionName,
      args,
      value: opts.value,
      nonce,
      ...fees,
    } as never)
    const receipt = await c.pub.waitForTransactionReceipt({ hash, timeout: 45_000 })
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted onchain: ${hash}`)
    return { hash, receipt }
  })
}
