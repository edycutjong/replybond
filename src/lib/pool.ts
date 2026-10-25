import { offers } from './offers.js'
import { POOL_GRACE_WINDOW_S } from './terms.js'

const silentHash = offers.find((o) => o.mode === 'silent')?.requestHash.toLowerCase()

export interface PoolCandidate {
  requestHash: string
  designated: string
  buyer: string
  graceWindow: number
}

/**
 * Pool stock = a silent-fixture job that was offered to, and accepted by, the demo buyer and carries the pool
 * marker (grace window POOL_GRACE_WINDOW_S). A watch-run job (the one a visitor is watching) has the normal grace
 * window, so it is not pool stock. Status and deadline are the caller's business.
 * Shared by the page (to collapse the table) and by api/ (busy rule, refill target, settle-now).
 */
export function isPoolStock(j: PoolCandidate, demoBuyer: string): boolean {
  const d = demoBuyer.toLowerCase()
  return (
    j.requestHash.toLowerCase() === silentHash &&
    j.designated.toLowerCase() === d &&
    j.buyer.toLowerCase() === d &&
    j.graceWindow === POOL_GRACE_WINDOW_S
  )
}
