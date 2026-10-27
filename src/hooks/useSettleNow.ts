import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { buildSettledCard } from '@/lib/settledCard'
import type { SettledCard } from '@/lib/settledCard'
import { settleNowFlow } from '@/lib/settleNowFlow'
import type { SettleNowState } from '@/lib/settleNowFlow'

export type { SettledCard, SettleNowState }

/** "Settle a missed deadline now": the button's state around settleNowFlow. */
export function useSettleNow(refreshJobs: () => Promise<void>, getNow: () => number, onSettled?: (c: SettledCard) => void) {
  const [state, setState] = useState<SettleNowState>({ phase: 'idle' })
  const run = useCallback(
    () => settleNowFlow({ api, card: buildSettledCard, getNow, refreshJobs }, setState, onSettled),
    [refreshJobs, getNow, onSettled],
  )
  return { state, run }
}
export type SettleNow = ReturnType<typeof useSettleNow>
