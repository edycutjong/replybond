import { parseEther } from 'viem'

/** Job terms shared by the page and the api/ functions (18-decimal native USDC). */
export const PRICE = parseEther('0.01')
export const BOND = parseEther('0.005')
export const RESPONSE_WINDOW_S = 45
export const GRACE_WINDOW_S = 120
