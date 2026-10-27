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
