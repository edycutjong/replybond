import type { Settlements } from '@/hooks/useSettlements'
import type { SettleNow } from '@/hooks/useSettleNow'
import type { SweepBody } from '@/lib/api'
import type { JobView } from '@/lib/chainReads'
import type { Tracked, TrackedExtra, TrackedKind } from '@/lib/tracked'

export interface FlowCtx {
  jobs: JobView[]
  /** Chain time in seconds, ticking. */
  now: number
  refresh: () => Promise<void>
  settlements: Settlements
  settle: SettleNow
  sweep: SweepBody | null
  /** Jobs this visitor started and has not seen settled (persisted in localStorage when it is available). */
  tracked: Tracked[]
  /** Every job tracked this session or restored from storage, kept on screen after its id is cleared once settled. */
  seen: Tracked[]
  track: (id: string, kind: TrackedKind, extra?: TrackedExtra) => void
}
