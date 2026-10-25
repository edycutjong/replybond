import { keccak256, toBytes } from 'viem'
import type { Hex } from 'viem'
import offersJson from '../../src/offers.json' with { type: 'json' }

export type Mode = 'normal' | 'silent'

export interface OfferRecord {
  id: string
  mode: Mode
  input: string
  requestHash: Hex
}

export const offers = offersJson as OfferRecord[]

/** The one place a request hash is computed: keccak256 of the input's UTF-8 bytes. */
export function hashInput(input: string): Hex {
  return keccak256(toBytes(input))
}

export function recordByHash(requestHash: string): OfferRecord | undefined {
  const h = requestHash.toLowerCase()
  return offers.find((o) => o.requestHash.toLowerCase() === h)
}

export function recordByMode(mode: Mode): OfferRecord {
  const rec = offers.find((o) => o.mode === mode)
  if (!rec) throw new Error(`no fixture record for mode ${mode}`)
  return rec
}

export function isMode(v: unknown): v is Mode {
  return v === 'normal' || v === 'silent'
}
