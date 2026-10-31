import { parseEther } from 'viem'

/** Job terms shared by the page and the api/ functions (18-decimal native USDC). */
export const PRICE = parseEther('0.01')
export const BOND = parseEther('0.005')
export const RESPONSE_WINDOW_S = 45
export const GRACE_WINDOW_S = 120
/** Demo offer limits, global across all visitors and counted from onchain history; the API enforces them, the landing page states them. */
export const DEMO_OFFER_LIMITS = { hour: 20, day: 80 } as const
/** New demo runs and pool refills pause when either demo wallet holds less than this (18-decimal native USDC). */
export const MIN_WALLET_BALANCE_NATIVE = parseEther('0.1')
/** Mirrors ReplyBond.MAX_OUTPUT: the most bytes a provider's answer may hold. */
export const MAX_OUTPUT_BYTES = 1024

/**
 * Pool stock (silent jobs made ahead by /api/demo-refill) is marked on-chain by this grace window.
 * A silent job is never answered, so its grace window is never used; a watch-run job keeps GRACE_WINDOW_S.
 */
export const POOL_GRACE_WINDOW_S = 1

/**
 * What a visitor may choose per call: small fixed sets, not free input. The defaults are RESPONSE_WINDOW_S and BOND above;
 * the price stays PRICE and the grace window stays GRACE_WINDOW_S.
 */
export const WINDOW_CHOICES_S = [30, 45, 90] as const
export const BOND_CHOICES = ['0.005', '0.010', '0.020'] as const
export type WindowChoice = (typeof WINDOW_CHOICES_S)[number]
export type BondChoice = (typeof BOND_CHOICES)[number]
export const DEFAULT_WINDOW_CHOICE: WindowChoice = 45
export const DEFAULT_BOND_CHOICE: BondChoice = '0.005'

/** The terms of one call as chosen: the response window in seconds and the bond in 18-decimal native USDC. */
export interface OfferTerms {
  windowS: number
  bond: bigint
}

export const bondOf = (choice: BondChoice): bigint => parseEther(choice)

/** What the buyer gets back if the deadline is missed: the price plus the bond. */
export const payoutTotal = (bond: bigint): bigint => PRICE + bond

/** "If the deadline is missed you get 0.010 + 0.020 = 0.030 USDC back" (`fmt` formats a native-USDC amount). */
export const payoutLine = (fmt: (raw: bigint) => string, bond: bigint): string =>
  `If the deadline is missed you get ${fmt(PRICE)} + ${fmt(bond)} = ${fmt(payoutTotal(bond))} USDC back`

export type ParsedTerms =
  | { ok: true; terms: OfferTerms; /** true when the caller sent at least one of the two fields */ chosen: boolean }
  | { ok: false; error: string }

const isWindowChoice = (v: unknown): v is WindowChoice => typeof v === 'number' && (WINDOW_CHOICES_S as readonly number[]).includes(v)
const isBondChoice = (v: unknown): v is BondChoice => typeof v === 'string' && (BOND_CHOICES as readonly string[]).includes(v)

/**
 * Strict check of the optional `windowS` and `bond` fields of a request body. Absent fields mean the defaults;
 * anything present must be exactly one of the allowed values (a number of seconds, a decimal string for the bond).
 */
export function parseTermsChoice(body: { windowS?: unknown; bond?: unknown }): ParsedTerms {
  if (body.windowS !== undefined && !isWindowChoice(body.windowS)) return { ok: false, error: `windowS must be one of ${WINDOW_CHOICES_S.join(', ')} (seconds, as a number)` }
  if (body.bond !== undefined && !isBondChoice(body.bond)) return { ok: false, error: `bond must be one of ${BOND_CHOICES.map((b) => `"${b}"`).join(', ')} (USDC, as a string)` }
  const windowS = body.windowS ?? DEFAULT_WINDOW_CHOICE
  const bond = bondOf(body.bond ?? DEFAULT_BOND_CHOICE)
  return { ok: true, terms: { windowS, bond }, chosen: body.windowS !== undefined || body.bond !== undefined }
}
