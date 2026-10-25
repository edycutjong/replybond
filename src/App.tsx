import { useEffect, useMemo, useRef, useState } from 'react'
import { Status } from '@/lib/abi'
import { CallApiPanel } from './components/CallApiPanel'
import { Header } from './components/Header'
import { JobsTable } from './components/JobsTable'
import { MissPanel } from './components/MissPanel'
import { MoneyTrail } from './components/MoneyTrail'
import { SettleNowBlock } from './components/SettleNow'
import type { FlowCtx } from './components/types'
import { useJobs, useTick } from './hooks/useJobs'
import { useSettleNow } from './hooks/useSettleNow'
import { useSettlements } from './hooks/useSettlements'
import { api } from './lib/api'
import type { SweepBody } from './lib/api'
import { CONTRACT } from './lib/appConfig'
import { readMine } from './lib/mine'

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

  // Settled jobs: read each settle receipt from the chain and classify it (newest 25).
  useEffect(() => {
    for (const j of jobs.slice(0, 25)) {
      const id = String(j.id)
      if (j.txs.settled && !settlements.byJob[id]) void settlements.load(id, j.txs.settled)
    }
  }, [jobs, settlements])

  // Restored pending jobs: at deadline + 2 s call settle for the demo jobs this browser started.
  const tried = useRef(new Set<string>())
  useEffect(() => {
    const mine = new Set(readMine())
    const demoBuyer = sweep?.demoBuyerAddress?.toLowerCase()
    for (const j of jobs) {
      const id = String(j.id)
      if (!mine.has(id) || tried.current.has(id) || !demoBuyer) continue
      if (j.status === Status.Accepted && j.buyer.toLowerCase() === demoBuyer && now >= j.deadline + 2) {
        tried.current.add(id)
        void settlements.settleJob(id)
      }
    }
  })

  const ctx: FlowCtx = useMemo(() => ({ jobs, now, refresh, settlements, settle, sweep }), [jobs, now, refresh, settlements, settle, sweep])
  const focusJob = jobs.find((j) => j.id === focus) ?? jobs[0]

  if (!CONTRACT) {
    return <main className="mx-auto max-w-[1100px] px-4 pb-24"><Header /><p role="alert" className="mt-6" style={{ color: 'var(--after)' }}>Set VITE_REPLYBOND_ADDRESS to the deployed contract address.</p></main>
  }

  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-28">
      <Header />
      <SettleNowBlock settle={settle} demoBuyer={sweep?.demoBuyerAddress} now={now} />
      <p className="label -mt-3 mb-4" role="status">{sweepNote}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:order-2"><MissPanel ctx={ctx} /></div>
        <div className="lg:order-1"><CallApiPanel ctx={ctx} /></div>
      </div>
      <MoneyTrail job={focusJob} settlement={focusJob ? settlements.byJob[String(focusJob.id)] : undefined} />
      <JobsTable ctx={ctx} loading={loading} error={error} focus={focusJob?.id ?? null} onFocus={setFocus} />
    </main>
  )
}
