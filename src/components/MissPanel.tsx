import { useState } from 'react'
import { Status } from '@/lib/abi'
import { api } from '@/lib/api'
import { walletsLowMessage } from '@/lib/api'
import type { DemoRunBody } from '@/lib/api'
import { NETWORK_NAME, fmtUsdc } from '@/lib/appConfig'
import { BOND, GRACE_WINDOW_S, PRICE, RESPONSE_WINDOW_S } from '@/lib/terms'
import { BusyNotice } from './BusyNotice'
import { TrackedCard } from './TrackedCard'
import type { CardFallback } from './TrackedCard'
import type { FlowCtx } from './types'

/** "Make the API miss its deadline": a silent demo job, settled by this page when the countdown ends (App owns that call). */
export function MissPanel({ ctx }: { ctx: FlowCtx }) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'busy' | 'error'>('idle')
  const [busy, setBusy] = useState<DemoRunBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<{ id: string; fallback: CardFallback } | null>(null)

  // The job on show: the one just started, else a silent job restored from storage.
  const shownId = started?.id ?? ctx.seen.find((t) => t.kind === 'silent')?.id ?? null

  const run = async () => {
    setPhase('starting')
    setBusy(null)
    setError(null)
    try {
      const r = await api.demoRun('silent')
      if (r.status === 409 || walletsLowMessage(r.body)) {
        setBusy(r.body)
        setPhase('busy')
        return
      }
      if (r.status !== 200 || !r.body.jobId || !r.body.deadline) throw new Error(r.body.error ?? r.body.message ?? `demo run failed (HTTP ${r.status})`)
      ctx.track(r.body.jobId, 'silent', { deadline: r.body.deadline })
      setStarted({ id: r.body.jobId, fallback: { deadline: r.body.deadline, status: Status.Accepted, txHashes: r.body.txHashes } })
      setPhase('idle')
      await ctx.refresh()
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  return (
    <section aria-labelledby="miss-title" className="bg-card p-5" style={{ border: '1px solid var(--rule)' }}>
      <h2 id="miss-title" className="panel-title">Make the API miss its deadline</h2>
      <p className="mt-1 data wrap text-[14px]">price {fmtUsdc(PRICE)} · bond {fmtUsdc(BOND)} · window {RESPONSE_WINDOW_S} s · grace {GRACE_WINDOW_S} s</p>
      <p className="mt-2 text-[15px]">Our demo provider is an echo service. In this panel it stays silent on purpose.</p>
      <div className="mt-3">
        <button className="btn btn-primary" onClick={() => void run()} disabled={phase === 'starting'}>
          {phase === 'starting' ? <span className="dots-wait">Posting the job</span> : `Watch it on ${NETWORK_NAME}`}
        </button>
      </div>
      {phase === 'busy' && busy && <BusyNotice body={busy} now={ctx.now} settle={ctx.settle} />}
      {phase === 'error' && <p role="alert" className="mt-3" style={{ color: 'var(--after)' }}>{error}</p>}
      {shownId && (
        <div className="mt-4">
          <TrackedCard ctx={ctx} id={shownId} kind="silent" fallback={started?.id === shownId ? started.fallback : undefined} />
          <p className="mt-2 text-[15px]">Anyone can call timeout; this page calls it for you.</p>
        </div>
      )}
    </section>
  )
}
