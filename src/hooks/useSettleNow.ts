import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { readJobTerms, resolveSettlement } from '@/lib/chainReads'
import type { Settlement } from '@/lib/chainReads'

export interface SettledCard {
  jobId: string
  settlement: Settlement
  price: bigint | null
  bond: bigint | null
}

export type SettleNowState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'settled'; card: SettledCard }
  | { phase: 'notready'; card: SettledCard | null; nextReadyInSeconds: number | null; at: number }
  | { phase: 'error'; message: string }

async function card(jobId: string, txHash: `0x${string}`): Promise<SettledCard> {
  const [settlement, terms] = await Promise.all([resolveSettlement(txHash), readJobTerms(BigInt(jobId))])
  return { jobId, settlement, price: terms?.price ?? null, bond: terms?.bond ?? null }
}

/** "Settle a missed deadline now": POST /api/settle (no jobId), then /api/demo-refill in the background. */
export function useSettleNow(refreshJobs: () => Promise<void>, getNow: () => number, onSettled?: (c: SettledCard) => void) {
  const [state, setState] = useState<SettleNowState>({ phase: 'idle' })

  const run = useCallback(async () => {
    setState({ phase: 'running' })
    try {
      const r = await api.settle()
      const b = r.body
      if (b.settled && b.txHash && b.jobId) {
        const c = await card(b.jobId, b.txHash)
        setState({ phase: 'settled', card: c })
        onSettled?.(c)
        void api.refill().then(() => refreshJobs())
        void refreshJobs()
        return
      }
      if (b.settled === false) {
        const latest = b.latestSettledTimeout ? await card(b.latestSettledTimeout.jobId, b.latestSettledTimeout.receipt.txHash) : null
        setState({ phase: 'notready', card: latest, nextReadyInSeconds: b.nextReadyInSeconds ?? null, at: getNow() })
        return
      }
      setState({ phase: 'error', message: b.reason ?? b.error ?? `settle failed (HTTP ${r.status})` })
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message })
    }
  }, [refreshJobs, getNow, onSettled])

  return { state, run }
}
export type SettleNow = ReturnType<typeof useSettleNow>
