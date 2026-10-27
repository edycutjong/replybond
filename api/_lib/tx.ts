import { encodeFunctionData, keccak256 } from 'viem'
import type { Hex, TransactionReceipt } from 'viem'
import { replyBondAbi } from '../../src/lib/abi.js'
import { MIN_MAX_FEE, ctx } from './config.js'
import type { Deps } from './deps.js'

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
export async function feeParams(pub: Deps['pub'] = ctx().pub) {
  const est = await pub.estimateFeesPerGas()
  const maxFeePerGas = est.maxFeePerGas > MIN_MAX_FEE ? est.maxFeePerGas : MIN_MAX_FEE
  const maxPriorityFeePerGas =
    est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas
  return { maxFeePerGas, maxPriorityFeePerGas }
}

export interface SentTx {
  hash: Hex
  receipt: TransactionReceipt
}

type ErrorLike = { message?: string; shortMessage?: string; details?: string; cause?: unknown }

/** All the text an error carries, including its causes (viem wraps the node's message). */
function errorText(err: unknown): string {
  const parts: string[] = []
  let cur: unknown = err
  for (let depth = 0; cur && depth < 5; depth++) {
    const e = cur as ErrorLike
    parts.push(e.message ?? '', e.shortMessage ?? '', e.details ?? '')
    cur = e.cause
  }
  return parts.join(' ')
}

/** True when the node says the nonce was already used: our own transaction was probably mined already. */
export function isNonceConflict(err: unknown): boolean {
  return /nonce too low|nonce has already been used/i.test(errorText(err))
}

/**
 * Signs and broadcasts one contract call from `who`, serialized per wallet.
 * The transaction hash is known before broadcast, so if a broadcast errors we look the hash up first: a lost
 * response (the same raw tx coming back as "already known", or as "nonce too low" once mined) must never resend.
 * Only an unknown hash plus a nonce conflict earns one more broadcast, after re-running the precheck and
 * re-reading the pending nonce. At most two broadcasts per call.
 */
export async function sendTx(
  who: Who,
  functionName: WriteFn,
  args: readonly unknown[],
  opts: { value?: bigint; precheck?: () => Promise<string | null> } = {},
  deps: Partial<Pick<Deps, 'pub' | 'wallets' | 'accounts'>> = {},
): Promise<SentTx> {
  const c = ctx()
  const pub = deps.pub ?? c.pub
  const wallet = (deps.wallets ?? c.wallets)[who]
  const account = (deps.accounts ?? c.accounts)[who]
  const address = account.address
  const data = encodeFunctionData({ abi: replyBondAbi, functionName, args } as never)

  const prepare = async () => {
    const fees = await feeParams(pub)
    const nonce = await pub.getTransactionCount({ address, blockTag: 'pending' })
    const request = await wallet.prepareTransactionRequest({ account, chain: c.chain, to: c.replyBond, data, value: opts.value, nonce, ...fees } as never)
    const serialized = (await wallet.signTransaction(request as never)) as Hex
    return { serialized, hash: keccak256(serialized) }
  }
  const isKnown = async (hash: Hex): Promise<boolean> => {
    try {
      return Boolean(await pub.getTransaction({ hash }))
    } catch {
      return false // not found, or the lookup itself failed: treated as unknown
    }
  }

  return withLock(address, async () => {
    if (opts.precheck) {
      const why = await opts.precheck()
      if (why) throw new Skipped(why)
    }
    let { serialized, hash } = await prepare()
    try {
      await pub.sendRawTransaction({ serializedTransaction: serialized })
    } catch (err) {
      if (!(await isKnown(hash))) {
        if (!isNonceConflict(err)) throw err
        if (opts.precheck) {
          const why = await opts.precheck()
          if (why) throw new Skipped(why)
        }
        ;({ serialized, hash } = await prepare())
        try {
          await pub.sendRawTransaction({ serializedTransaction: serialized })
        } catch (err2) {
          if (!(await isKnown(hash))) throw err2
        }
      }
    }
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 45_000 })
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted onchain: ${hash}`)
    return { hash, receipt }
  })
}
