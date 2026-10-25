import type { Settlements } from '@/hooks/useSettlements'
import type { SettleNow } from '@/hooks/useSettleNow'
import type { SweepBody } from '@/lib/api'
import type { JobView } from '@/lib/chainReads'

export interface FlowCtx {
  jobs: JobView[]
  /** Chain time in seconds, ticking. */
  now: number
  refresh: () => Promise<void>
  settlements: Settlements
  settle: SettleNow
  sweep: SweepBody | null
}
