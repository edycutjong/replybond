import { parseEventLogs } from 'viem'
import type { Address, Hex, Log } from 'viem'
import { replyBondAbi } from './abi'

/** Arc's system emitter: native USDC movements show up as ERC-20 style Transfer logs from this address. */
export const SYSTEM_EMITTER = '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export type ReceiptKind = 'PAID' | 'OWED' | 'UNREADABLE'
export type SettleEvent = 'JobPaid' | 'JobClaimed' | 'JobTimedOut' | 'OfferWithdrawn'

export interface ReceiptLike {
  status: string
  logs: readonly { address: string; topics: readonly string[]; data: string }[]
}

export interface Classification {
  kind: ReceiptKind
  /** Which contract settle event the receipt carries, if any. */
  event: SettleEvent | null
  jobId: bigint | null
  payee: Address | null
  /** PAID: the value read from the Transfer log. OWED: the amount credited to owed. Otherwise null. */
  amount: bigint | null
  reason: string
}

const none = (reason: string, over: Partial<Classification> = {}): Classification => ({
  kind: 'UNREADABLE',
  event: null,
  jobId: null,
  payee: null,
  amount: null,
  reason,
  ...over,
})

const topicAddress = (t: string) => `0x${t.slice(-40)}`.toLowerCase()

/**
 * The one place a settle receipt is judged (shared by the app and, later, the landing page).
 *  PAID       the successful receipt has the native USDC Transfer log (system emitter) from the contract to the payee,
 *             for the amount the contract's settle event reports, and no PayoutOwed.
 *  OWED       the successful receipt has PayoutOwed from the contract.
 *  UNREADABLE anything else: no receipt, failed, no settle event, or no matching Transfer.
 * Arc emits the Transfer log for contract payouts (checked on testnet receipts), so there is no event-only fallback.
 */
export function classifyReceipt(receipt: ReceiptLike | null | undefined, contract: Address): Classification {
  if (!receipt) return none('receipt unavailable')
  if (receipt.status !== 'success') return none('transaction did not succeed')

  const mine = receipt.logs.filter((l) => l.address.toLowerCase() === contract.toLowerCase())
  let events: ReturnType<typeof parseEventLogs<typeof replyBondAbi>>
  try {
    events = parseEventLogs({ abi: replyBondAbi, logs: mine as unknown as Log[] })
  } catch {
    return none('contract logs unreadable')
  }

  const owed = events.find((e) => e.eventName === 'PayoutOwed')
  if (owed) {
    return { kind: 'OWED', event: null, jobId: owed.args.id, payee: owed.args.payee, amount: owed.args.amount, reason: 'PayoutOwed in receipt' }
  }

  let settle: { event: SettleEvent; jobId: bigint; payee: Address; amount: bigint } | null = null
  for (const e of events) {
    if (e.eventName === 'JobPaid' || e.eventName === 'JobClaimed') settle = { event: e.eventName, jobId: e.args.id, payee: e.args.provider, amount: e.args.amount }
    else if (e.eventName === 'JobTimedOut') settle = { event: e.eventName, jobId: e.args.id, payee: e.args.buyer, amount: e.args.amount }
    else if (e.eventName === 'OfferWithdrawn') settle = { event: e.eventName, jobId: e.args.id, payee: e.args.provider, amount: e.args.bond }
  }
  if (!settle) return none('no settle event in receipt')

  const transfer = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === SYSTEM_EMITTER.toLowerCase() &&
      l.topics.length === 3 &&
      l.topics[0] === TRANSFER_TOPIC &&
      topicAddress(l.topics[1]) === contract.toLowerCase() &&
      topicAddress(l.topics[2]) === settle.payee.toLowerCase() &&
      BigInt(l.data as Hex) === settle.amount,
  )
  const base = { event: settle.event, jobId: settle.jobId, payee: settle.payee }
  if (!transfer) return none('no USDC Transfer log to the payee', base)
  return { kind: 'PAID', ...base, amount: BigInt(transfer.data), reason: 'Transfer log from the system emitter' }
}
