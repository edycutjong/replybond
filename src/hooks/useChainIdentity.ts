import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { SweepBody } from '@/lib/api'
import { DEMO_BUYER_ADDRESS, PROVIDER_ADDRESS } from '@/lib/appConfig'

let sweepOnce: ReturnType<typeof api.sweep> | null = null

/**
 * Whose jobs a page shows and who the demo buyer is: from config, and only when a config address is unset, from the
 * sweep body (the one call that asks the server). A failed sweep leaves the missing address null.
 */
export function useChainIdentity(): { provider: string | null; demoBuyer: string | null; waiting: boolean } {
  const needSweep = !PROVIDER_ADDRESS || !DEMO_BUYER_ADDRESS
  const [sweep, setSweep] = useState<SweepBody | null>(null)
  const [settled, setSettled] = useState(!needSweep)
  useEffect(() => {
    if (!needSweep) return
    sweepOnce ??= api.sweep()
    let cancelled = false
    sweepOnce
      .then((r) => {
        if (r.status !== 200) sweepOnce = null
        if (!cancelled) {
          if (r.status === 200) setSweep(r.body)
          setSettled(true)
        }
      })
      .catch(() => {
        sweepOnce = null
        if (!cancelled) setSettled(true)
      })
    return () => {
      cancelled = true
    }
  }, [needSweep])
  return {
    provider: PROVIDER_ADDRESS ?? sweep?.providerAddress ?? null,
    demoBuyer: DEMO_BUYER_ADDRESS ?? sweep?.demoBuyerAddress ?? null,
    waiting: needSweep && !settled,
  }
}
