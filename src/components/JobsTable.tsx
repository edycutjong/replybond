import { STATUS_NAMES, Status } from '@/lib/abi'
import { useWalletActions } from '@/hooks/useWalletActions'
import { fmtUsdc, padId, shortHash } from '@/lib/appConfig'
import type { JobView } from '@/lib/chainReads'
import { readMine } from '@/lib/mine'
import type { FlowCtx } from './types'
import { TxLink, blockTime, mmss } from './ui'

function Kind({ job, ctx }: { job: JobView; ctx: FlowCtx }) {
  const s = ctx.settlements.byJob[String(job.id)]
  if (!s) return null
  const k = s.classification.kind
  if (k === 'PAID' && job.status === Status.TimedOut) return <span className="label ml-2 px-1" style={{ color: 'var(--after)', border: '1px solid var(--after)' }}>Indemnity</span>
  if (k === 'PAID') return <span className="label ml-2">paid</span>
  if (k === 'OWED') return <span className="label ml-2" style={{ color: 'var(--ink)' }}>payout owed</span>
  return <span className="label ml-2">transfer not confirmed</span>
}

function Action({ job, ctx }: { job: JobView; ctx: FlowCtx }) {
  const wallet = useWalletActions()
  const id = String(job.id)
  const settling = ctx.settlements.settling[id]
  const err = ctx.settlements.errors[id]
  const ours = ctx.sweep?.providerAddress?.toLowerCase() === job.provider.toLowerCase()
  const retry = (text: string) => (
    <button className="btn" style={{ minHeight: 44, fontSize: 15, padding: '0 12px' }} onClick={() => void ctx.settlements.settleJob(id)} disabled={settling}>
      {settling ? <span className="dots-wait">Working</span> : text}
    </button>
  )
  let body: React.ReactNode = null
  if (job.status === Status.Accepted) {
    body =
      ctx.now <= job.deadline ? (
        <span className="data" style={{ color: 'var(--before)' }}>{mmss(job.deadline - ctx.now)}</span>
      ) : (
        retry('Settle')
      )
  } else if (job.status === Status.Responded) {
    const graceEnd = job.respondedAt + job.graceWindow
    if (ctx.now <= graceEnd) {
      body = (
        <span className="flex items-center gap-2 flex-wrap">
          <span className="label">grace</span>
          <span className="data" style={{ color: 'var(--before)' }}>{mmss(graceEnd - ctx.now)}</span>
          {wallet.address?.toLowerCase() === job.buyer.toLowerCase() && (
            <button className="btn" style={{ minHeight: 44, fontSize: 15, padding: '0 12px' }} onClick={() => void wallet.acknowledge(job.id).then((s) => { ctx.settlements.remember(id, s); void ctx.refresh() })}>
              Acknowledge
            </button>
          )}
        </span>
      )
    } else {
      body = ours ? retry('Claim') : <span className="label">grace over</span>
    }
  } else if (job.txs.settled) {
    body = <TxLink hash={job.txs.settled} />
  } else {
    body = <span className="label">{STATUS_NAMES[job.status].toLowerCase()}</span>
  }
  return (
    <>
      {body}
      {err && <div role="alert" className="text-[13px]" style={{ color: 'var(--after)', whiteSpace: 'normal' }}>{err}</div>}
    </>
  )
}

export function JobsTable({ ctx, loading, error, focus, onFocus }: { ctx: FlowCtx; loading: boolean; error: string | null; focus: bigint | null; onFocus: (id: bigint) => void }) {
  const mine = new Set(readMine())
  const rows = ctx.jobs.slice(0, 25)
  return (
    <section aria-labelledby="jobs-title" className="mt-8">
      <h2 id="jobs-title" className="panel-title">Live jobs</h2>
      <p className="label mt-1">From the contract's events. Updates every few seconds.</p>
      {error && <p role="alert" style={{ color: 'var(--after)' }}>Could not read events: {error}</p>}
      <div className="mt-3 bg-card" style={{ border: '1px solid var(--rule)' }}>
        <table className="jobs">
          <thead>
            <tr><th>Nº</th><th>Status</th><th>Price</th><th>Bond</th><th>Deadline</th><th>Settle / action</th></tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={6} className="label">Loading jobs from the chain…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6}>No jobs yet. Use “Watch it” above to create one.</td></tr>}
            {rows.map((j) => (
              <tr key={String(j.id)} style={j.id === focus ? { background: '#eef3fa' } : undefined}>
                <td data-label="Nº">
                  <button className="link data" onClick={() => onFocus(j.id)} title={`Show the money trail for job ${padId(j.id)}`}>{padId(j.id)}</button>
                  {mine.has(String(j.id)) && <span className="label ml-2">yours</span>}
                </td>
                <td data-label="Status"><span className="font-semibold">{STATUS_NAMES[j.status]}</span><Kind job={j} ctx={ctx} /></td>
                <td data-label="Price" className="data">{fmtUsdc(j.price)}</td>
                <td data-label="Bond" className="data">{fmtUsdc(j.bond)}</td>
                <td data-label="Deadline" className="data text-[14px]">{j.deadline ? blockTime(j.deadline) : '—'}</td>
                <td data-label="Action"><Action job={j} ctx={ctx} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="label mt-2">Shown: newest {rows.length} of {ctx.jobs.length} · provider {ctx.sweep?.providerAddress ? shortHash(ctx.sweep.providerAddress) : '…'}</p>
    </section>
  )
}
