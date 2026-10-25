import type { ReactNode } from 'react'
import { Status } from '@/lib/abi'
import { BOND, GRACE_WINDOW_S, PRICE } from '@/lib/terms'
import type { TrackedKind } from '@/lib/tracked'
import type { FlowCtx } from './types'
import { Counterfoil, STATUS_FOR_EVENT, TxLink } from './ui'

export interface CardFallback {
  deadline?: number
  respondedAt?: number
  graceWindow?: number
  output?: string
  status?: number
  txHashes?: Record<string, string | null>
}

/**
 * One visitor-started job as a counterfoil, driven by chain state. It owns the "Settle now" / "Claim" fallback button
 * for any past-deadline or past-grace unsettled job; the automatic call at countdown end lives in App.
 */
export function TrackedCard({ ctx, id, kind, fallback, extra }: { ctx: FlowCtx; id: string; kind: TrackedKind; fallback?: CardFallback; extra?: ReactNode }) {
  const job = ctx.jobs.find((j) => String(j.id) === id)
  const stored0 = ctx.seen.find((t) => t.id === id)
  fallback ??= stored0 ? { deadline: stored0.deadline, respondedAt: stored0.respondedAt, graceWindow: stored0.graceWindow, output: stored0.output, status: stored0.respondedAt ? Status.Responded : Status.Accepted } : undefined
  const stored = ctx.settlements.byJob[id]
  // A receipt the browser could not fetch is not a verdict: keep reading instead of showing "transfer not confirmed".
  const settlement = stored && !stored.unavailable ? stored : undefined
  const settling = ctx.settlements.settling[id]
  const reading = ctx.settlements.reading[id] || !!stored?.unavailable
  const error = ctx.settlements.errors[id]
  const note = ctx.settlements.notes[id]
  const ev = settlement?.classification.event
  const status = ev ? STATUS_FOR_EVENT[ev] : (job?.status ?? fallback?.status ?? Status.Accepted)
  const deadline = job?.deadline || fallback?.deadline || 0
  const respondedAt = job?.respondedAt || fallback?.respondedAt || 0
  const graceWindow = job?.graceWindow ?? fallback?.graceWindow ?? GRACE_WINDOW_S
  const pastDeadline = status === Status.Accepted && deadline > 0 && ctx.now > deadline
  const pastGrace = status === Status.Responded && respondedAt > 0 && ctx.now > respondedAt + graceWindow
  const open = !settlement
  const due = open && (pastDeadline || pastGrace)
  // A wallet-owned job past its deadline is timed out by that wallet; the server only pays for demo-buyer timeouts.
  const serverSettles = due && !(kind === 'own' && pastDeadline)
  const label = pastGrace ? 'Claim' : 'Settle now'

  let line: ReactNode = null
  if (open && status === Status.Accepted && !pastDeadline) line = kind === 'silent' ? 'Waiting on the provider, which stays silent. When the clock ends this page asks for the timeout.' : 'Waiting for the provider to answer onchain.'
  else if (open && status === Status.Responded && !pastGrace) line = kind === 'buyer-silent' ? 'The buyer stays silent. When grace ends this page asks the provider to claim.' : 'Answered. The buyer can acknowledge; otherwise the provider claims after grace.'
  else if (due && (settling || reading)) line = settling ? (pastGrace ? 'Claiming…' : 'Calling timeout…') : 'Reading the receipt from the chain…'
  else if (due) line = pastGrace ? 'Grace is over.' : 'The deadline passed.'
  if (!due && reading) line = 'Reading the receipt from the chain…'

  return (
    <Counterfoil
      id={id}
      price={job?.price ?? PRICE}
      bond={job?.bond ?? BOND}
      status={status}
      deadline={deadline || undefined}
      respondedAt={respondedAt || undefined}
      graceWindow={graceWindow}
      responseWindow={job?.responseWindow}
      now={ctx.now}
      output={job?.output ?? fallback?.output}
      settlement={settlement}
    >
      {line && <p className="data text-[14px]" role="status" style={{ whiteSpace: 'normal' }}>{line}</p>}
      {serverSettles && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" onClick={() => void ctx.settlements.settleJob(id)} disabled={settling}>
            {settling ? <span className="dots-wait">Working</span> : label}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-[14px]" style={{ color: 'var(--after)', whiteSpace: 'normal' }}>{error}</p>}
      {note && <p className="text-[14px]" style={{ color: 'var(--muted)' }}>{note}</p>}
      {extra}
      {fallback?.txHashes && (
        <p className="text-[14px]" style={{ color: 'var(--muted)' }}>
          {Object.entries(fallback.txHashes).map(([k, h]) => (h ? <span key={k} className="mr-3">{k} <TxLink hash={h} /></span> : null))}
        </p>
      )}
    </Counterfoil>
  )
}
