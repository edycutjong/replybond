import { useEffect, useState } from 'react'
import { Status } from '@/lib/abi'
import { api } from '@/lib/api'
import type { DemoRunBody } from '@/lib/api'
import { NETWORK_NAME, fmtUsdc } from '@/lib/appConfig'
import { addMine } from '@/lib/mine'
import { BOND, GRACE_WINDOW_S, PRICE, RESPONSE_WINDOW_S } from '@/lib/terms'
import { BusyNotice } from './BusyNotice'
import type { FlowCtx } from './types'
import { Counterfoil, STATUS_FOR_EVENT, TxLink } from './ui'

const KEY = 'replybond.miss'

/** "Make the API miss its deadline": a silent demo job, settled by this page at deadline + 2 s. */
export function MissPanel({ ctx }: { ctx: FlowCtx }) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'busy' | 'error'>('idle')
  const [busy, setBusy] = useState<DemoRunBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<{ jobId: string; deadline: number; txHashes: Record<string, string | null> } | null>(null)
  const [trackedId, setTrackedId] = useState<string | null>(() => localStorage.getItem(KEY))

  const job = trackedId ? ctx.jobs.find((j) => String(j.id) === trackedId) : undefined
  const settlement = trackedId ? ctx.settlements.byJob[trackedId] : undefined
  const settling = trackedId ? ctx.settlements.settling[trackedId] : false
  const settleError = trackedId ? ctx.settlements.errors[trackedId] : undefined

  // If this job settled earlier (reload), read its receipt so the card shows the real outcome.
  useEffect(() => {
    if (trackedId && job?.txs.settled && !settlement) void ctx.settlements.load(trackedId, job.txs.settled)
  }, [trackedId, job?.txs.settled, settlement, ctx.settlements])

  const run = async () => {
    setPhase('starting')
    setBusy(null)
    setError(null)
    try {
      const r = await api.demoRun('silent')
      if (r.status === 409) {
        setBusy(r.body)
        setPhase('busy')
        return
      }
      if (r.status !== 200 || !r.body.jobId || !r.body.deadline) throw new Error(r.body.error ?? `demo run failed (HTTP ${r.status})`)
      addMine(r.body.jobId)
      localStorage.setItem(KEY, r.body.jobId)
      setTrackedId(r.body.jobId)
      setStarted({ jobId: r.body.jobId, deadline: r.body.deadline, txHashes: r.body.txHashes ?? {} })
      setPhase('idle')
      await ctx.refresh()
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  const deadline = job?.deadline || (started && started.jobId === trackedId ? started.deadline : 0)
  const settledEvent = settlement?.classification.event
  const status = settledEvent ? STATUS_FOR_EVENT[settledEvent] : job ? job.status : started && started.jobId === trackedId ? Status.Accepted : null
  const pastDeadline = status === Status.Accepted && deadline > 0 && ctx.now > deadline

  return (
    <section aria-labelledby="miss-title" className="bg-card p-5" style={{ border: '1px solid var(--rule)' }}>
      <h2 id="miss-title" className="panel-title">Make the API miss its deadline</h2>
      <p className="mt-1 data text-[14px]">price {fmtUsdc(PRICE)} · bond {fmtUsdc(BOND)} · window {RESPONSE_WINDOW_S} s · grace {GRACE_WINDOW_S} s</p>
      <p className="mt-2 text-[15px]">Our demo provider is an echo service. In this panel it stays silent on purpose.</p>
      <div className="mt-3">
        <button className="btn btn-primary" onClick={() => void run()} disabled={phase === 'starting'}>
          {phase === 'starting' ? <span className="dots-wait">Posting the job</span> : `Watch it on ${NETWORK_NAME}`}
        </button>
      </div>
      {phase === 'busy' && busy && <BusyNotice body={busy} now={ctx.now} settle={ctx.settle} />}
      {phase === 'error' && <p role="alert" className="mt-3" style={{ color: 'var(--after)' }}>{error}</p>}

      {trackedId && status !== null && (
        <div className="mt-4">
          <Counterfoil id={trackedId} price={job?.price ?? PRICE} bond={job?.bond ?? BOND} status={status} deadline={deadline} now={ctx.now} settlement={settlement}>
            {pastDeadline && !settlement && (
              <div role="status" className="flex flex-wrap items-center gap-3">
                <span className="data text-[14px]">{settling ? 'Calling timeout…' : 'Deadline passed. Calling timeout at deadline + 2 s…'}</span>
                {settleError && (
                  <>
                    <span style={{ color: 'var(--after)' }}>{settleError}</span>
                    <button className="btn" onClick={() => void ctx.settlements.settleJob(trackedId)} disabled={settling}>Settle again</button>
                  </>
                )}
              </div>
            )}
            {started && started.jobId === trackedId && (
              <p className="text-[14px]" style={{ color: 'var(--muted)' }}>
                {Object.entries(started.txHashes).map(([k, h]) => (h ? <span key={k} className="mr-3">{k} <TxLink hash={h} /></span> : null))}
              </p>
            )}
          </Counterfoil>
          <p className="mt-2 text-[15px]">Anyone can call timeout; this page calls it for you.</p>
        </div>
      )}
    </section>
  )
}
