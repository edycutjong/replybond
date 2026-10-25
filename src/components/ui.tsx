import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { STATUS_NAMES, Status } from '@/lib/abi'
import { fmtUsdc, padId, shortHash, txUrl } from '@/lib/appConfig'
import type { Settlement } from '@/lib/chainReads'

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a className="link data text-[14px]" href={txUrl(hash)} target="_blank" rel="noopener noreferrer" title={hash}>
      {label ?? shortHash(hash)} <ExternalLink size={12} className="inline -mt-0.5" aria-hidden />
    </a>
  )
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function Countdown({ target, now, label, expiredText }: { target: number; now: number; label: string; expiredText?: string }) {
  const left = target - now
  const expired = left <= 0
  return (
    <div className="field min-w-[130px]">
      <div className="label">{label}</div>
      <div className="amount" style={{ color: expired ? 'var(--muted)' : 'var(--before)' }} aria-live="off">
        {expired ? (expiredText ?? '00:00') : mmss(left)}
      </div>
    </div>
  )
}

export function blockTime(ts: number | null): string {
  return ts ? new Date(ts * 1000).toISOString().slice(11, 19) + ' UTC' : ''
}

/**
 * The settlement mark. Red stamp only for a TimedOut job whose receipt classifyReceipt marks PAID.
 * OWED and UNREADABLE get ink text, never a stamp.
 */
export function SettlementMark({ jobStatus, settlement, price, bond }: { jobStatus: number; settlement: Settlement; price?: bigint; bond?: bigint }) {
  const c = settlement.classification
  if (c.kind === 'UNREADABLE') return <p className="ink-note" style={{ color: 'var(--muted)', borderColor: 'var(--muted)' }}>transfer not confirmed</p>
  if (c.kind === 'OWED') return <p className="ink-note">SETTLED · PAYOUT OWED</p>
  const amount = c.amount ?? 0n
  const timedOut = jobStatus === Status.TimedOut || c.event === 'JobTimedOut'
  if (timedOut) {
    const splits = price !== undefined && bond !== undefined && price + bond === amount
    return (
      <div className="pt-2 pb-1">
        <div className="stamp mb-4 mt-2" role="img" aria-label={`Indemnity paid, plus ${fmtUsdc(amount)} USDC`}>
          Indemnity paid · +{fmtUsdc(amount)} USDC
        </div>
        {splits && (
          <p className="mt-3 text-[15px]">
            <span className="data">{fmtUsdc(price)}</span> refund + <span className="data">{fmtUsdc(bond)}</span> penalty (derived from the job terms)
          </p>
        )}
        <p className="text-[15px]">
          Payout to the buyer: <TxLink hash={settlement.txHash} />
        </p>
      </div>
    )
  }
  const text =
    c.event === 'JobClaimed'
      ? 'Paid · buyer silent'
      : c.event === 'OfferWithdrawn'
        ? 'Bond reclaimed'
        : `Paid on time${settlement.blockTime ? ` · ${blockTime(settlement.blockTime)}` : ''}`
  return (
    <div className="py-2 flex items-center gap-4">
      <div className="postmark">
        <span>{text}</span>
      </div>
      <p className="text-[15px]">
        +<span className="data">{fmtUsdc(amount)}</span> USDC to the {c.event === 'OfferWithdrawn' ? 'provider (bond)' : 'provider'} · <TxLink hash={settlement.txHash} />
      </p>
    </div>
  )
}

export interface CounterfoilProps {
  id: bigint | string
  price: bigint
  bond: bigint
  status: number | null
  deadline?: number
  respondedAt?: number
  graceWindow?: number
  now: number
  output?: string | null
  settlement?: Settlement | null
  children?: ReactNode
}

/** One job as a perforated counterfoil: stub on the left, form fields on the right. */
export function Counterfoil(p: CounterfoilProps) {
  const accepted = p.status === Status.Accepted && p.deadline
  const responded = p.status === Status.Responded && p.respondedAt !== undefined && p.graceWindow !== undefined
  return (
    <article className="counterfoil" aria-label={`Job ${padId(p.id)}`}>
      <div className="stub">
        <div className="label">Job Nº</div>
        <div className="data text-[22px] font-semibold">{padId(p.id)}</div>
        <div className="label mt-6">Stub</div>
        <div className="label" style={{ color: 'var(--ink)' }}>Buyer</div>
      </div>
      <div className="p-4 grid gap-3">
        <div className="label" style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 4 }}>
          Registered job · provider bonded {p.status !== null && <span style={{ color: 'var(--ink)' }}>· {STATUS_NAMES[p.status]}</span>}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="field min-w-[110px]">
            <div className="label">Price</div>
            <div className="amount" style={{ color: 'var(--before)' }}>{fmtUsdc(p.price)}</div>
          </div>
          <div className="field min-w-[110px]">
            <div className="label">Bond</div>
            <div className="amount" style={{ color: 'var(--before)' }}>{fmtUsdc(p.bond)}</div>
          </div>
          {accepted ? <Countdown target={p.deadline!} now={p.now} label="Deadline" /> : null}
          {responded ? <Countdown target={p.respondedAt! + p.graceWindow!} now={p.now} label="Grace ends" expiredText="00:00" /> : null}
        </div>
        {p.output ? (
          <div className="field">
            <div className="label">Output (read from the chain)</div>
            <div className="data" style={{ whiteSpace: 'normal', wordBreak: 'break-word', fontSize: 15 }}>“{p.output}”</div>
          </div>
        ) : null}
        {p.settlement && p.status !== null ? <SettlementMark jobStatus={p.status} settlement={p.settlement} price={p.price} bond={p.bond} /> : null}
        {p.children}
      </div>
    </article>
  )
}

export const STATUS_FOR_EVENT = {
  JobPaid: Status.Paid,
  JobClaimed: Status.Claimed,
  JobTimedOut: Status.TimedOut,
  OfferWithdrawn: Status.Withdrawn,
} as const
