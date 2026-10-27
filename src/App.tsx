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
import { CONTRACT, DEMO_BUYER_ADDRESS, PROOF_TIMEOUT_TX, PROVIDER_ADDRESS } from './lib/appConfig'
import { readJobTerms, resolveSettlement } from './lib/chainReads'
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
  // A cancelled offer: gone from storage and from the cards on screen.
  const forget = useCallback((id: string) => {
    setTracked((l) => (l.some((t) => t.id === id) ? removeTracked(l, id) : l))
    setSeen((l) => l.filter((t) => t.id !== id))
  }, [])
  const untrack = useCallback((id: string) => setTracked((l) => (l.some((t) => t.id === id) ? removeTracked(l, id) : l)), [])
  const settlements = useSettlements(refresh, untrack)
  const settle = useSettleNow(refresh, chainNow)

  // The sweep runs on every load. If it fails (rejects, or answers with a status other than 200) it is tried once more after 5 s.
  const [sweepAttempt, setSweepAttempt] = useState(0)
  useEffect(() => {
    sweepOnLoad ??= api.sweep()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const failed = (note: string) => {
      sweepOnLoad = null
      if (cancelled) return
      setSweepNote(note)
      if (sweepAttempt === 0) timer = setTimeout(() => setSweepAttempt(1), 5000)
    }
    sweepOnLoad
      .then((r) => {
        const b = r.body
        if (r.status !== 200) return failed(`Sweep failed: ${b.error ?? `HTTP ${r.status}`}`)
        if (cancelled) return
        setSweep(b)
        setSweepNote(`Sweep on load: ${b.responded?.length ?? 0} answered · ${b.claimed?.length ?? 0} claimed · ${b.withdrawn?.length ?? 0} withdrawn`)
        void refresh()
      })
      .catch((e: Error) => failed(`Sweep failed: ${e.message}`))
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [refresh, sweepAttempt])

  // Only the current provider's jobs (the address the server derives from PROVIDER_KEY, exposed by /api/sweep).
  // The page's identity comes from config; the sweep body is only the fallback when a config address is unset.
  const provider = (PROVIDER_ADDRESS ?? sweep?.providerAddress)?.toLowerCase() ?? null
  const demoBuyer = DEMO_BUYER_ADDRESS ?? sweep?.demoBuyerAddress ?? null
  const waitingOnSweep = (!PROVIDER_ADDRESS || !DEMO_BUYER_ADDRESS) && !sweep
  const identityMismatch = Boolean(PROVIDER_ADDRESS && sweep?.providerAddress && sweep.providerAddress.toLowerCase() !== PROVIDER_ADDRESS.toLowerCase())
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
  const clearing = useRef(new Set<string>())
  useEffect(() => {
    for (const t of tracked) {
      const j = ours.find((x) => String(x.id) === t.id)
      if (j && j.status >= Status.Paid) {
        if (!clearing.current.has(t.id)) {
          clearing.current.add(t.id)
          setTimeout(() => untrack(t.id), 0) // settled: clear the stored id, once
        }
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
  }, [tracked, ours, now, untrack, settlements])

  const ctx: FlowCtx = useMemo(
    () => ({ jobs: ours, now, refresh, settlements, settle, sweep, provider, demoBuyer, tracked, seen, track, forget }),
    [ours, now, refresh, settlements, settle, sweep, provider, demoBuyer, tracked, seen, track, forget],
  )

  // Hero: the latest real settled timeout of this provider, judged by classifyReceipt once its receipt is read.
  const latestTimeout = ours.find((j) => j.status === Status.TimedOut && j.txs.settled)
  const latestSettlement = latestTimeout ? settlements.byJob[String(latestTimeout.id)] : undefined
  const fromWindow: HeroCard | null =
    latestTimeout && latestSettlement
      ? { jobId: String(latestTimeout.id), settlement: latestSettlement, price: latestTimeout.price, bond: latestTimeout.bond, responseWindow: latestTimeout.responseWindow }
      : null

  // When the scanned window holds no timeout, show a pinned older proof (if one is configured) labelled "On record".
  // undefined = not read yet, null = nothing to show.
  const [pinned, setPinned] = useState<HeroCard | null | undefined>(undefined)
  const needsPinned = PROOF_TIMEOUT_TX !== null && !loading && !waitingOnSweep && latestTimeout === undefined
  const pinnedStarted = useRef(false)
  useEffect(() => {
    if (!needsPinned || !PROOF_TIMEOUT_TX || pinnedStarted.current) return
    pinnedStarted.current = true
    void (async () => {
      try {
        const s = await resolveSettlement(PROOF_TIMEOUT_TX)
        const terms = s.jobId !== null ? await readJobTerms(s.jobId) : null
        setPinned(s.jobId !== null && !s.unavailable ? { jobId: String(s.jobId), settlement: s, price: terms?.price ?? null, bond: terms?.bond ?? null, responseWindow: terms?.responseWindow, onRecordAt: s.blockTime } : null)
      } catch {
        setPinned(null)
      }
    })()
  }, [needsPinned])
  const initial = fromWindow ?? (latestTimeout === undefined ? (pinned ?? null) : null)
  const heroLoading = waitingOnSweep || loading || (latestTimeout !== undefined && !latestSettlement) || (needsPinned && pinned === undefined)

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
      <Hero settle={settle} initial={initial} loading={heroLoading} demoBuyer={demoBuyer ?? undefined} now={now} />
      <p className="label -mt-3 mb-4" role="status">{sweepNote}</p>
      {identityMismatch && (
        <p className="-mt-2 mb-4 text-[15px]" role="alert" style={{ color: 'var(--after)' }}>
          Config warning: the server's provider address differs from VITE_PROVIDER_ADDRESS, so some jobs may be missing here.
        </p>
      )}
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
        loading={loading || waitingOnSweep}
        error={error}
        focus={focusJob?.id ?? null}
        onFocus={setFocus}
      />
    </main>
  )
}
