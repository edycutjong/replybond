import type { SettleBody, RefillBody } from './api'
import { buildSettledCard } from './settledCard'
import type { SettledCard } from './settledCard'

export type SettleNowState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'settled'; card: SettledCard }
  | { phase: 'notready'; card: SettledCard | null; nextReadyInSeconds: number | null; at: number; message?: string }
  | { phase: 'error'; message: string }

export interface SettleNowDeps {
  api: { settle: () => Promise<{ status: number; body: SettleBody }>; refill: () => Promise<{ status: number; body: RefillBody }> }
  card: typeof buildSettledCard
  getNow: () => number
  refreshJobs: () => Promise<void>
}

/**
 * "Settle a missed deadline now": POST /api/settle (no jobId). A settled job triggers a background refill. When nothing
 * could be settled and the pool is empty, the page asks for a refill itself and then takes the next-ready time from it.
 */
export async function settleNowFlow(deps: SettleNowDeps, setState: (s: SettleNowState) => void, onSettled?: (c: SettledCard) => void): Promise<void> {
  setState({ phase: 'running' })
  try {
    const r = await deps.api.settle()
    const b = r.body
    if (b.settled && b.txHash && b.jobId) {
      const c = await deps.card(b.jobId, b.txHash, b.receipt)
      setState({ phase: 'settled', card: c })
      onSettled?.(c)
      void deps.api.refill().then(() => deps.refreshJobs())
      void deps.refreshJobs()
      return
    }
    if (b.settled === false) {
      const latest = b.latestSettledTimeout ? await deps.card(b.latestSettledTimeout.jobId, b.latestSettledTimeout.receipt.txHash, b.latestSettledTimeout.receipt) : null
      const notready = { phase: 'notready', card: latest, nextReadyInSeconds: b.nextReadyInSeconds ?? null, at: deps.getNow() } as const
      setState(notready)
      if (b.refillSuggested || b.pool?.size === 0) {
        const refill = await deps.api.refill().catch(() => null)
        if (refill) {
          if (refill.body.error === 'wallets_low') setState({ ...notready, message: refill.body.message })
          else if (refill.body.pool) setState({ ...notready, nextReadyInSeconds: refill.body.pool.nextReadyInSeconds, at: deps.getNow() })
          await deps.refreshJobs()
        }
      }
      return
    }
    setState({ phase: 'error', message: b.reason ?? b.error ?? `settle failed (HTTP ${r.status})` })
  } catch (e) {
    setState({ phase: 'error', message: (e as Error).message })
  }
}
