import type { Hex } from 'viem'

export type Mode = 'normal' | 'silent'

export interface OfferRecord {
  id: string
  mode: Mode
  input: string
  requestHash: Hex
}

/**
 * The fixture records, as a plain TypeScript module so Vercel's Node bundler needs no JSON import.
 * src/offers.json mirrors this array; tests/offers.test.ts fails if the two ever differ.
 */
export const offers: OfferRecord[] = [
  {
    id: 'invoice-4471',
    mode: 'normal',
    input: 'invoice #4471 is ready for review',
    requestHash: '0x7d43cb7cf12f8ae72119ab31a72c43c76a0a0a20a7539b566ab40d38e4e36299',
  },
  {
    id: 'q3-vendor-summary',
    mode: 'silent',
    input: 'summarise: q3 vendor contract',
    requestHash: '0x2349bb5ca916e84effd0922e6989818c3307763aba9615435f5a0fa8e5d8d662',
  },
]
