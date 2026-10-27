import { useEffect, useRef, useState } from 'react'
import type { HeroCard } from '@/components/Hero'
import { Status } from '@/lib/abi'
import { PROOF_TIMEOUT_TX } from '@/lib/appConfig'
import { readJobTerms, resolveSettlement } from '@/lib/chainReads'
import type { JobView } from '@/lib/chainReads'
import type { Settlements } from './useSettlements'

/**
 * The card the hero opens with, shared by the landing page and the app: the latest real settled timeout of this
 * provider, judged by classifyReceipt once its receipt is read. When the scanned window holds none, a pinned older proof
 * (if one is configured) is read instead and labelled "On record".
 */
export function useHeroCard({ ours, settlements, loading, scanning, waitingOnSweep }: { ours: JobView[]; settlements: Settlements; loading: boolean; scanning: boolean; waitingOnSweep: boolean }) {
  const latestTimeout = ours.find((j) => j.status === Status.TimedOut && j.txs.settled)
  const latestSettlement = latestTimeout ? settlements.byJob[String(latestTimeout.id)] : undefined
  const fromWindow: HeroCard | null =
    latestTimeout && latestSettlement
      ? { jobId: String(latestTimeout.id), settlement: latestSettlement, price: latestTimeout.price, bond: latestTimeout.bond, responseWindow: latestTimeout.responseWindow }
      : null

  // undefined = not read yet, null = nothing to show.
  const [pinned, setPinned] = useState<HeroCard | null | undefined>(undefined)
  // The pinned read starts at once instead of waiting for the whole scan, so the hero is not blank while the scan runs;
  // a timeout found in the window replaces it.
  const needsPinned = PROOF_TIMEOUT_TX !== null && !waitingOnSweep && latestTimeout === undefined
  const pinnedStarted = useRef(false)
  useEffect(() => {
    if (!needsPinned || !PROOF_TIMEOUT_TX || pinnedStarted.current) return
    pinnedStarted.current = true
    void (async () => {
      try {
        const s = await resolveSettlement(PROOF_TIMEOUT_TX)
        const terms = s.jobId !== null ? await readJobTerms(s.jobId) : null
        setPinned(s.jobId !== null && !s.unavailable ? { jobId: String(s.jobId), settlement: s, price: terms?.price ?? null, bond: terms?.bond ?? null, responseWindow: terms?.responseWindow, onRecordAt: s.blockTime } : null)
      } catch {
        setPinned(null)
      }
    })()
  }, [needsPinned])

  const initial = fromWindow ?? (latestTimeout === undefined ? (pinned ?? null) : null)
  const heroLoading = waitingOnSweep || (PROOF_TIMEOUT_TX === null && (loading || (scanning && latestTimeout === undefined))) || (latestTimeout !== undefined && !latestSettlement) || (needsPinned && pinned === undefined)
  return { initial, heroLoading, latestTimeout }
}
