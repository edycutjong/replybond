import { useCallback, useState } from 'react'
import type { Hex } from 'viem'
import { api } from '@/lib/api'
import { resolveSettlement } from '@/lib/chainReads'
import type { Settlement } from '@/lib/chainReads'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Settle receipts by job id (classified by the shared function), plus per-job settle progress and errors. */
export function useSettlements(refreshJobs: () => Promise<void>) {
  const [byJob, setByJob] = useState<Record<string, Settlement>>({})
  const [settling, setSettling] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})

  const remember = useCallback((id: string, s: Settlement) => setByJob((m) => ({ ...m, [id]: s })), [])

  const load = useCallback(
    async (id: string, txHash: Hex) => {
      const s = await resolveSettlement(txHash)
      remember(id, s)
      return s
    },
    [remember],
  )

  /** POST /api/settle {jobId}; retryable. Timeouts also trigger a background /api/demo-refill. */
  const settleJob = useCallback(
    async (id: string) => {
      setSettling((m) => ({ ...m, [id]: true }))
      setErrors((m) => {
        const { [id]: _drop, ...rest } = m
        return rest
      })
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const r = await api.settle(id)
          const hash = r.body.txHash
          if (hash && (r.body.settled || r.body.alreadySettled)) {
            await load(id, hash)
            if (r.body.actionLabel) setNotes((m) => ({ ...m, [id]: r.body.actionLabel! }))
            if (r.body.action === 'timeout') void api.refill().then(() => refreshJobs())
            await refreshJobs()
            return
          }
          if (r.status === 409 && typeof r.body.readyInSeconds === 'number') {
            await sleep(Math.min(60, r.body.readyInSeconds + 1) * 1000)
            continue
          }
          throw new Error(r.body.reason ?? r.body.error ?? `settle failed (HTTP ${r.status})`)
        }
        throw new Error('not settleable yet; try again in a moment')
      } catch (e) {
        setErrors((m) => ({ ...m, [id]: (e as Error).message }))
      } finally {
        setSettling((m) => ({ ...m, [id]: false }))
      }
    },
    [load, refreshJobs],
  )

  return { byJob, settling, errors, notes, settleJob, load, remember }
}
export type Settlements = ReturnType<typeof useSettlements>
