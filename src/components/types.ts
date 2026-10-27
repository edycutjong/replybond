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
  /** Whose jobs the page shows and who the demo buyer is: from config, else from the sweep body, else null. */
  provider: string | null
  demoBuyer: string | null
  /** Jobs this visitor started and has not seen settled (persisted in localStorage when it is available). */
  tracked: Tracked[]
  /** Every job tracked this session or restored from storage, kept on screen after its id is cleared once settled. */
  seen: Tracked[]
  track: (id: string, kind: TrackedKind, extra?: TrackedExtra) => void
  /** Drops a job from both `tracked` and `seen` (a cancelled offer). Settled jobs use untrack and stay on screen. */
  forget: (id: string) => void
}
