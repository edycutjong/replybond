import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Status } from '@/lib/abi'
import { CallApiPanel } from './components/CallApiPanel'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import type { HeroCard } from './components/Hero'
import { JobsTable } from './components/JobsTable'
import { MissPanel } from './components/MissPanel'
import { MoneyTrail } from './components/MoneyTrail'
import type { FlowCtx } from './components/types'
import { useJobs, useTick } from './hooks/useJobs'
import { useSettleNow } from './hooks/useSettleNow'
import { useSettlements } from './hooks/useSettlements'
import { api } from './lib/api'
import type { SweepBody } from './lib/api'
import { CONTRACT } from './lib/appConfig'
import { addMine } from './lib/mine'
import { addTracked, readTracked, removeTracked } from './lib/tracked'
import type { TrackedExtra, TrackedKind } from './lib/tracked'
import { isPoolStock } from './lib/pool'
import { GRACE_WINDOW_S } from './lib/terms'

// One sweep per page load (React StrictMode would otherwise run the effect twice in development).
let sweepOnLoad: ReturnType<typeof api.sweep> | null = null

export default function App() {
  const { jobs, loading, error, refresh, chainNow } = useJobs()
  useTick()
  const now = chainNow()
  const [sweep, setSweep] = useState<SweepBody | null>(null)
  const [sweepNote, setSweepNote] = useState<string>('Sweeping…')
  const [focus, setFocus] = useState<bigint | null>(null)
  // Jobs this visitor started: persisted (when storage works) so a reload resumes or settles them.
  const [tracked, setTracked] = useState(() => readTracked())
  const [seen, setSeen] = useState(tracked)
  const track = useCallback((id: string, kind: TrackedKind, extra?: TrackedExtra) => {
    addMine(id)
    setTracked((l) => addTracked(l, id, kind, extra))
    setSeen((l) => [{ id, kind, at: Date.now(), ...extra }, ...l.filter((t) => t.id !== id)])
  }, [])
  const untrack = useCallback((id: string) => setTracked((l) => (l.some((t) => t.id === id) ? removeTracked(l, id) : l)), [])
  const settlements = useSettlements(refresh, untrack)
  const settle = useSettleNow(refresh, chainNow)

  useEffect(() => {
    sweepOnLoad ??= api.sweep()
    sweepOnLoad
      .then((r) => {
        setSweep(r.body)
        const b = r.body
        setSweepNote(
          r.status === 200
            ? `Sweep on load: ${b.responded?.length ?? 0} answered · ${b.claimed?.length ?? 0} claimed · ${b.withdrawn?.length ?? 0} withdrawn`
            : `Sweep failed: ${b.error ?? `HTTP ${r.status}`}`,
        )
        void refresh()
      })
      .catch((e: Error) => setSweepNote(`Sweep failed: ${e.message}`))
  }, [refresh])

  // Only the current provider's jobs (the address the server derives from PROVIDER_KEY, exposed by /api/sweep).
  const provider = sweep?.providerAddress?.toLowerCase()
  const demoBuyer = sweep?.demoBuyerAddress
  const ours = useMemo(() => (provider ? jobs.filter((j) => j.provider.toLowerCase() === provider) : []), [jobs, provider])

  // Pool stock (expired-but-unsettled or still counting down) collapses into one line instead of one row each.
  const stock = useMemo(() => (demoBuyer ? ours.filter((j) => j.status === Status.Accepted && isPoolStock(j, demoBuyer)) : []), [ours, demoBuyer])
  const rows = useMemo(() => ours.filter((j) => !stock.includes(j)), [ours, stock])
  const ready = stock.filter((j) => now > j.deadline).length

  // Settled jobs: read and classify each settle receipt (newest 25). A receipt the browser could not fetch is retried.
  const retried = useRef(new Map<string, number>())
  useEffect(() => {
    for (const j of ours.slice(0, 25)) {
      const id = String(j.id)
      const s = settlements.byJob[id]
      if (!j.txs.settled || settlements.reading[id] || (s && !s.unavailable)) continue
      if (s && Date.now() - (retried.current.get(id) ?? 0) < 15_000) continue
      retried.current.set(id, Date.now())
      void settlements.load(id, j.txs.settled)
    }
  }, [ours, settlements])

  // Countdown end: when a job this visitor started passes its deadline (or grace), call /api/settle {jobId}; the call is
  // idempotent and retried with backoff. It also runs after a reload: a job already past due is settled at once, one still
  // counting resumes. Timing comes from chain events when they load and from the stored copy when they do not.
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    for (const t of tracked) {
      const j = ours.find((x) => String(x.id) === t.id)
      if (j && j.status >= Status.Paid) {
        setTimeout(() => untrack(t.id), 0) // settled: clear the stored id
        continue
      }
      const status = j?.status ?? (t.respondedAt ? Status.Responded : Status.Accepted)
      const deadline = j?.deadline || t.deadline || 0
      const respondedAt = j?.respondedAt || t.respondedAt || 0
      const grace = j?.graceWindow ?? t.graceWindow ?? GRACE_WINDOW_S
      const timeoutDue = status === Status.Accepted && deadline > 0 && now > deadline + 1 && t.kind !== 'own' // a wallet times out its own job
      const claimDue = status === Status.Responded && respondedAt > 0 && now > respondedAt + grace + 1
      const key = `${t.id}:${timeoutDue ? 'timeout' : 'claim'}`
      if ((timeoutDue || claimDue) && !attempted.current.has(key)) {
        attempted.current.add(key)
        void settlements.settleJob(t.id)
      }
    }
  })

  const ctx: FlowCtx = useMemo(() => ({ jobs: ours, now, refresh, settlements, settle, sweep, tracked, seen, track }), [ours, now, refresh, settlements, settle, sweep, tracked, seen, track])

  // Hero: the latest real settled timeout of this provider, judged by classifyReceipt once its receipt is read.
  const latestTimeout = ours.find((j) => j.status === Status.TimedOut && j.txs.settled)
  const latestSettlement = latestTimeout ? settlements.byJob[String(latestTimeout.id)] : undefined
  const initial: HeroCard | null =
    latestTimeout && latestSettlement
      ? { jobId: String(latestTimeout.id), settlement: latestSettlement, price: latestTimeout.price, bond: latestTimeout.bond, responseWindow: latestTimeout.responseWindow }
      : null
  const heroLoading = !sweep || loading || (latestTimeout !== undefined && !latestSettlement)

  const focusJob = rows.find((j) => j.id === focus) ?? rows[0]
  const settlePool = () => {
    void settle.run()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!CONTRACT) {
    return <main className="mx-auto max-w-[1100px] px-4 pb-24"><Header /><p role="alert" className="mt-6" style={{ color: 'var(--after)' }}>Set VITE_REPLYBOND_ADDRESS to the deployed contract address.</p></main>
  }

  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-28">
      <Header />
      <Hero settle={settle} initial={initial} loading={heroLoading} demoBuyer={demoBuyer} now={now} />
      <p className="label -mt-3 mb-4" role="status">{sweepNote}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:order-2"><MissPanel ctx={ctx} /></div>
        <div className="lg:order-1"><CallApiPanel ctx={ctx} /></div>
      </div>
      <MoneyTrail job={focusJob} settlement={focusJob ? settlements.byJob[String(focusJob.id)] : undefined} />
      <JobsTable
        ctx={ctx}
        rows={rows}
        total={ours.length}
        pool={{ ready, waiting: stock.length - ready, onSettle: settlePool, settling: settle.state.phase === 'running' }}
        loading={loading || !sweep}
        error={error}
        focus={focusJob?.id ?? null}
        onFocus={setFocus}
      />
    </main>
  )
}
