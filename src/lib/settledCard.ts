import type { Hex } from 'viem'
import type { ReceiptSummary } from './api'
import { readJobTerms, resolveSettlement, settlementFromSummary } from './chainReads'
import type { Settlement } from './chainReads'

export interface SettledCard {
  jobId: string
  settlement: Settlement
  price: bigint | null
  bond: bigint | null
}

export interface CardDeps {
  resolve: (txHash: Hex, expectedJobId?: bigint) => Promise<Settlement>
  fromSummary: (s: ReceiptSummary, expectedJobId?: bigint) => Promise<Settlement>
  terms: (id: bigint) => Promise<{ price: bigint; bond: bigint } | null>
}

const realDeps: CardDeps = { resolve: resolveSettlement, fromSummary: settlementFromSummary, terms: readJobTerms }

/**
 * A card for a settle receipt. The receipt the server returned is classified first, the same way useSettlements.load does,
 * so a slow browser RPC cannot stop the stamp. The chain read is the fallback when there is no usable summary.
 * A failing terms read never discards a valid settlement: price and bond are then null.
 */
export async function buildSettledCard(jobId: string, txHash: Hex, summary?: ReceiptSummary | null, deps: Partial<CardDeps> = {}): Promise<SettledCard> {
  const d = { ...realDeps, ...deps }
  let settlement: Settlement | null = null
  if (summary && summary.status) {
    try {
      settlement = await d.fromSummary(summary, BigInt(jobId))
    } catch {
      settlement = null // unusable summary: read the chain instead
    }
  }
  settlement ??= await d.resolve(txHash, BigInt(jobId))
  let terms: { price: bigint; bond: bigint } | null = null
  try {
    terms = await d.terms(BigInt(jobId))
  } catch {
    terms = null
  }
  return { jobId, settlement, price: terms?.price ?? null, bond: terms?.bond ?? null }
}
