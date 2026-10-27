import { useCallback, useRef, useState } from 'react'
import type { Hex } from 'viem'
import { api } from '@/lib/api'
import type { ReceiptSummary } from '@/lib/api'
import { resolveSettlement, settlementFromSummary } from '@/lib/chainReads'
import type { Settlement } from '@/lib/chainReads'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const SETTLE_GIVE_UP_MS = 3 * 60 * 1000

class Refused extends Error {}

/** Settle receipts by job id (classified by the shared function), plus per-job settle progress, notes and errors. */
export function useSettlements(refreshJobs: () => Promise<void>, onSettled?: (id: string) => void) {
  const [byJob, setByJob] = useState<Record<string, Settlement>>({})
  const [settling, setSettling] = useState<Record<string, boolean>>({})
  const [reading, setReading] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const loading = useRef(new Set<string>())
  const settlingNow = useRef(new Set<string>())

  const remember = useCallback((id: string, s: Settlement) => setByJob((m) => ({ ...m, [id]: s })), [])

  /**
   * Reads and classifies a settle receipt. A receipt the browser cannot fetch yet is retried with backoff and never
   * stored as a verdict; the receipt a server route already returned is classified directly.
   */
  const load = useCallback(
    async (id: string, txHash: Hex, summary?: ReceiptSummary | null): Promise<Settlement | null> => {
      if (loading.current.has(id)) return null
      loading.current.add(id)
      setReading((m) => ({ ...m, [id]: true }))
      try {
        let s: Settlement | null = null
        if (summary && summary.status) s = await settlementFromSummary(summary, BigInt(id))
        for (let i = 0; !s && i < 7; i++) {
          const r = await resolveSettlement(txHash, BigInt(id))
          if (!r.unavailable) s = r
          else await sleep(1000 * (i + 1))
        }
        s ??= await resolveSettlement(txHash, BigInt(id)) // still unreadable after the retries: stored as is, retried later
        remember(id, s)
        return s
      } finally {
        loading.current.delete(id)
        setReading((m) => ({ ...m, [id]: false }))
      }
    },
    [remember],
  )

  /**
   * POST /api/settle {jobId} until it returns a settled receipt (idempotent on the server). Retries with backoff on
   * network errors, 5xx and "not yet"; stops on a refusal. Timeouts also trigger a background /api/demo-refill.
   */
  const settleJob = useCallback(
    async (id: string) => {
      if (settlingNow.current.has(id)) return
      settlingNow.current.add(id)
      setSettling((m) => ({ ...m, [id]: true }))
      setErrors((m) => {
        const { [id]: _drop, ...rest } = m
        return rest
      })
      const started = Date.now()
      let delay = 1000
      let last = ''
      try {
        for (;;) {
          try {
            const r = await api.settle(id)
            const b = r.body
            if (b.txHash && (b.settled || b.alreadySettled)) {
              await load(id, b.txHash, b.receipt ?? undefined)
              if (b.actionLabel) setNotes((m) => ({ ...m, [id]: b.actionLabel! }))
              if (b.action === 'timeout') void api.refill().then(() => refreshJobs())
              onSettled?.(id)
              await refreshJobs()
              return
            }
            if (b.refused || r.status === 403 || r.status === 404) throw new Refused(b.reason ?? b.error ?? `refused (HTTP ${r.status})`)
            if (r.status === 409 && typeof b.readyInSeconds === 'number') delay = Math.min(15_000, (b.readyInSeconds + 1) * 1000)
            last = b.reason ?? b.error ?? `HTTP ${r.status}`
          } catch (e) {
            if (e instanceof Refused) throw e
            last = (e as Error).message
          }
          if (Date.now() - started > SETTLE_GIVE_UP_MS) throw new Error(`${last || 'not settled yet'}. Press Settle now to try again.`)
          await sleep(delay)
          delay = Math.min(delay * 2, 15_000)
        }
      } catch (e) {
        setErrors((m) => ({ ...m, [id]: (e as Error).message }))
      } finally {
        settlingNow.current.delete(id)
        setSettling((m) => ({ ...m, [id]: false }))
      }
    },
    [load, refreshJobs, onSettled],
  )

  return { byJob, settling, reading, errors, notes, settleJob, load, remember }
}
export type Settlements = ReturnType<typeof useSettlements>
