import { parseEther } from 'viem'

/** Job terms shared by the page and the api/ functions (18-decimal native USDC). */
export const PRICE = parseEther('0.01')
export const BOND = parseEther('0.005')
export const RESPONSE_WINDOW_S = 45
export const GRACE_WINDOW_S = 120
/** Mirrors ReplyBond.MAX_OUTPUT: the most bytes a provider's answer may hold. */
export const MAX_OUTPUT_BYTES = 1024

/**
 * Pool stock (silent jobs made ahead by /api/demo-refill) is marked on-chain by this grace window.
 * A silent job is never answered, so its grace window is never used; a watch-run job keeps GRACE_WINDOW_S.
 */
export const POOL_GRACE_WINDOW_S = 1
