import { useEffect, useMemo, useRef, useState } from 'react'
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
import { readMine } from './lib/mine'
import { isPoolStock } from './lib/pool'

// One sweep per page load (React StrictMode would otherwise run the effect twice in development).
let sweepOnLoad: ReturnType<typeof api.sweep> | null = null

export default function App() {
  const { jobs, loading, error, refresh, chainNow } = useJobs()
  useTick()
  const now = chainNow()
  const [sweep, setSweep] = useState<SweepBody | null>(null)
  const [sweepNote, setSweepNote] = useState<string>('Sweeping…')
  const [focus, setFocus] = useState<bigint | null>(null)
  const settlements = useSettlements(refresh)
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

  // Settled jobs: read each settle receipt from the chain and classify it (newest 25).
  useEffect(() => {
    for (const j of ours.slice(0, 25)) {
      const id = String(j.id)
      if (j.txs.settled && !settlements.byJob[id]) void settlements.load(id, j.txs.settled)
    }
  }, [ours, settlements])

  // Restored pending jobs: at deadline + 2 s call settle for the demo jobs this browser started.
  const tried = useRef(new Set<string>())
  useEffect(() => {
    const mine = new Set(readMine())
    const buyer = demoBuyer?.toLowerCase()
    for (const j of ours) {
      const id = String(j.id)
      if (!mine.has(id) || tried.current.has(id) || !buyer) continue
      if (j.status === Status.Accepted && j.buyer.toLowerCase() === buyer && now >= j.deadline + 2) {
        tried.current.add(id)
        void settlements.settleJob(id)
      }
    }
  })

  const ctx: FlowCtx = useMemo(() => ({ jobs: ours, now, refresh, settlements, settle, sweep }), [ours, now, refresh, settlements, settle, sweep])

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
