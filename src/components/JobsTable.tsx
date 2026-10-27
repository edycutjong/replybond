import { STATUS_NAMES, Status } from '@/lib/abi'
import { useWalletActions } from '@/hooks/useWalletActions'
import { fmtUsdc, padId } from '@/lib/appConfig'
import type { JobView } from '@/lib/chainReads'
import { readMine } from '@/lib/mine'
import type { FlowCtx } from './types'
import { TxLink, blockTime, mmss } from './ui'

function Kind({ job, ctx }: { job: JobView; ctx: FlowCtx }) {
  const s = ctx.settlements.byJob[String(job.id)]
  if (job.status === Status.Withdrawn) return <span className="label ml-2">bond returned</span>
  if (!s) return null
  if (s.unavailable) return <span className="label ml-2">reading receipt…</span>
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
  const note = ctx.settlements.notes[id]
  const ours = ctx.provider?.toLowerCase() === job.provider.toLowerCase()
  const small = { minHeight: 44, fontSize: 15, padding: '0 12px' }
  const retry = (text: string) => (
    <button className="btn" style={small} onClick={() => void ctx.settlements.settleJob(id)} disabled={settling}>
      {settling ? <span className="dots-wait">Working</span> : text}
    </button>
  )
  let body: React.ReactNode = null
  if (job.status === Status.Accepted) {
    body = ctx.now <= job.deadline ? <span className="data" style={{ color: 'var(--before)' }}>{mmss(job.deadline - ctx.now)}</span> : retry('Settle now')
  } else if (job.status === Status.Responded) {
    const graceEnd = job.respondedAt + job.graceWindow
    if (ctx.now <= graceEnd) {
      body = (
        <span className="flex items-center gap-2 flex-wrap">
          <span className="label">grace</span>
          <span className="data" style={{ color: 'var(--before)' }}>{mmss(graceEnd - ctx.now)}</span>
          {wallet.address?.toLowerCase() === job.buyer.toLowerCase() && (
            <button className="btn" style={small} onClick={() => void wallet.acknowledge(job.id).then((s) => { ctx.settlements.remember(id, s); void ctx.refresh() })}>
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
      {note && <div className="text-[13px]" style={{ color: 'var(--muted)', whiteSpace: 'normal' }}>{note}</div>}
      {err && <div role="alert" className="text-[13px]" style={{ color: 'var(--after)', whiteSpace: 'normal' }}>{err}</div>}
    </>
  )
}

export interface PoolSummary {
  ready: number
  waiting: number
  onSettle: () => void
  settling: boolean
}

export function JobsTable({ ctx, rows, total, pool, loading, error, focus, onFocus }: { ctx: FlowCtx; rows: JobView[]; total: number; pool: PoolSummary; loading: boolean; error: string | null; focus: bigint | null; onFocus: (id: bigint) => void }) {
  const mine = new Set(readMine())
  const shown = rows.slice(0, 25)
  const small = { minHeight: 44, fontSize: 15, padding: '0 12px' }
  return (
    <section aria-labelledby="jobs-title" className="mt-8">
      <h2 id="jobs-title" className="panel-title">Live jobs</h2>
      <p className="label mt-1">This provider's jobs, from the contract's events. Updates every few seconds.</p>
      {error && <p role="alert" style={{ color: 'var(--after)' }}>Could not read events: {error}</p>}
      <div className="mt-3 bg-card" style={{ border: '1px solid var(--rule)' }}>
        {(pool.ready > 0 || pool.waiting > 0) && (
          <div className="flex flex-wrap items-center gap-3 p-3" style={{ borderBottom: '1px solid var(--rule)' }}>
            <span className="font-semibold">
              {pool.ready} ready to settle
              {pool.waiting > 0 && <span className="font-normal" style={{ color: 'var(--muted)' }}> · {pool.waiting} still counting down</span>}
            </span>
            {pool.ready > 0 && (
              <button className="btn" style={small} onClick={pool.onSettle} disabled={pool.settling}>
                {pool.settling ? <span className="dots-wait">Settling</span> : 'Settle one'}
              </button>
            )}
          </div>
        )}
        <table className="jobs">
          <thead>
            <tr><th>Nº</th><th>Status</th><th>Price</th><th>Bond</th><th>Deadline</th><th>Settle / action</th></tr>
          </thead>
          <tbody>
            {loading && shown.length === 0 && <tr><td colSpan={6} className="label">Loading jobs from the chain…</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={6}>No jobs yet. Use “Watch it” above to create one.</td></tr>}
            {shown.map((j) => (
              <tr key={String(j.id)} style={j.id === focus ? { background: '#eef3fa' } : undefined}>
                <td data-label="Nº">
                  <button className="link data" onClick={() => onFocus(j.id)} title={`Show the money trail for job ${padId(j.id)}`}>{padId(j.id)}</button>
                  {mine.has(String(j.id)) && <span className="label ml-2">yours</span>}
                </td>
                <td data-label="Status"><span className="font-semibold">{j.status === Status.Withdrawn ? 'Withdrawn' : STATUS_NAMES[j.status]}</span><Kind job={j} ctx={ctx} /></td>
                <td data-label="Price" className="data">{fmtUsdc(j.price)}</td>
                <td data-label="Bond" className="data">{fmtUsdc(j.bond)}</td>
                <td data-label="Deadline" className="data text-[14px]">{j.deadline ? blockTime(j.deadline) : '—'}</td>
                <td data-label="Action"><Action job={j} ctx={ctx} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="label mt-2">Shown: {shown.length} of {total} jobs by this provider{ctx.provider ? '' : ' · waiting for the provider address'}</p>
    </section>
  )
}
