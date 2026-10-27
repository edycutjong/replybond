import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { STATUS_NAMES, Status } from '@/lib/abi'
import { fmtUsdc, padId, shortHash, txUrl } from '@/lib/appConfig'
import type { Settlement } from '@/lib/chainReads'
import { RESPONSE_WINDOW_S } from '@/lib/terms'

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

export function blockTime(ts: number | null): string {
  return ts ? new Date(ts * 1000).toISOString().slice(11, 19) + ' UTC' : ''
}

/** Round response dial: carbon blue while the clock runs, ruled grey and 00:00 once it has stopped. */
export function Dial({ left, total, label, size = 92 }: { left: number; total: number; label: string; size?: number }) {
  const running = left > 0
  const frac = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0
  const r = 40
  const c = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center" role="timer" aria-label={`${label} ${mmss(left)}`}>
      <div className="dial" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--rule)" strokeWidth="8" />
          {running && <circle cx="50" cy="50" r={r} fill="none" stroke="var(--before)" strokeWidth="8" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 50 50)" />}
          <line x1="50" y1="3" x2="50" y2="13" stroke="var(--ink)" strokeWidth="3" />
        </svg>
        <span className="dial-time data" style={{ color: running ? 'var(--before)' : 'var(--ink)', fontSize: size < 80 ? 15 : undefined }}>{mmss(left)}</span>
      </div>
      <div className="label mt-1">{label}</div>
    </div>
  )
}

/**
 * The settlement mark. The red stamp is only for a TimedOut job whose receipt classifyReceipt marks PAID.
 * A withdrawn offer is not a job: its bond simply went back. OWED and UNREADABLE get ink text, never a stamp.
 */
export function SettlementMark({ jobStatus, settlement, price, bond, animate = true }: { jobStatus: number; settlement: Settlement; price?: bigint; bond?: bigint; animate?: boolean }) {
  const c = settlement.classification
  if (c.kind === 'UNREADABLE') return <p className="ink-note" style={{ color: 'var(--muted)', borderColor: 'var(--muted)' }}>transfer not confirmed</p>
  if (c.kind === 'OWED') return <p className="ink-note">SETTLED · PAYOUT OWED</p>
  const amount = c.amount ?? 0n
  if (c.event === 'OfferWithdrawn' || jobStatus === Status.Withdrawn) {
    return (
      <div className="py-2">
        <p className="ink-note">WITHDRAWN · BOND RETURNED</p>
        <p className="mt-2 text-[15px]">Bond reclaimed by the provider · <TxLink hash={settlement.txHash} /></p>
      </div>
    )
  }
  if (c.event === 'JobTimedOut' || jobStatus === Status.TimedOut) {
    const splits = price !== undefined && bond !== undefined && price + bond === amount
    return (
      <div className="pt-2 pb-1">
        <div key={settlement.txHash} className={`stamp mb-6 mt-2${animate ? '' : ' stamp--still'}`} role="img" aria-label={`Indemnity paid, plus ${fmtUsdc(amount)} USDC`}>
          Indemnity paid · <span className="stamp-amount">+{fmtUsdc(amount)} USDC</span>
        </div>
        {splits && (
          <p className="text-[15px]">
            <span className="data">{fmtUsdc(price)}</span> refund + <span className="data">{fmtUsdc(bond)}</span> penalty (derived from the job terms)
          </p>
        )}
        <p className="text-[15px]">
          Settle tx: <TxLink hash={settlement.txHash} />
        </p>
      </div>
    )
  }
  const text =
    c.event === 'JobClaimed' ? 'Paid · buyer silent' : `Paid on time${settlement.blockTime ? ` · ${blockTime(settlement.blockTime)}` : ''}`
  return (
    <div className="py-2 flex items-center gap-4">
      <div key={settlement.txHash} className={`postmark${animate ? '' : ' postmark--still'}`}>
        <span>{text}</span>
      </div>
      <p className="text-[15px]">
        +<span className="data">{fmtUsdc(amount)}</span> USDC to the provider · <TxLink hash={settlement.txHash} />
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
  responseWindow?: number
  now: number
  output?: string | null
  settlement?: Settlement | null
  /** Pinned older proof (unix seconds; null when the date is unknown): shown as "On record · <UTC date>" so it never reads as fresh. */
  onRecordAt?: number | null
  /** false: the stamp or postmark is drawn in place (first paint); true: it lands with the pop. */
  animate?: boolean
  children?: ReactNode
}

/** One job as a perforated counterfoil: the buyer's stub on the left, form fields and the dial on the right. */
export function Counterfoil(p: CounterfoilProps) {
  const total = p.responseWindow ?? RESPONSE_WINDOW_S
  const ev = p.settlement?.classification.event
  const paid = p.settlement?.classification.kind === 'PAID'
  // The dial sits in the main row on wide screens and in the stub on phones, so the card stays short.
  let dial: ((size: number) => ReactNode) | null = null
  if (p.status === Status.Accepted && p.deadline) dial = (size) => <Dial left={p.deadline! - p.now} total={total} label="Deadline" size={size} />
  else if (p.status === Status.Responded && p.respondedAt !== undefined && p.graceWindow !== undefined)
    dial = (size) => <Dial left={p.respondedAt! + p.graceWindow! - p.now} total={p.graceWindow!} label="Grace" size={size} />
  else if (ev === 'JobTimedOut') dial = (size) => <Dial left={0} total={total} label={`Deadline ${total} s`} size={size} />
  return (
    <article className="counterfoil" aria-label={`Job ${padId(p.id)}`}>
      <div className="stub">
        <div className="label">Job Nº</div>
        <div className="data text-[22px] font-semibold">{padId(p.id)}</div>
        {dial && <div className="mt-3 sm:hidden">{dial(68)}</div>}
        <div className="label mt-3" style={{ color: 'var(--ink)' }}>Buyer stub</div>
        {paid && ev === 'JobTimedOut' && p.settlement?.classification.amount ? (
          <>
            <div className="label mt-2">Received</div>
            <div className="data text-[17px] font-semibold">+{fmtUsdc(p.settlement.classification.amount)}</div>
          </>
        ) : null}
      </div>
      <div className="p-4 grid gap-3 min-w-0">
        <div style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 4 }}>
          <div className="label status-line">
            Registered job · provider bonded {p.status !== null && <span style={{ color: 'var(--ink)' }}>· {STATUS_NAMES[p.status]}</span>}
          </div>
          {p.onRecordAt !== undefined && (
            <div className="label" style={{ color: 'var(--ink)' }}>
              On record{p.onRecordAt ? ` · ${new Date(p.onRecordAt * 1000).toISOString().slice(0, 10)} UTC` : ''}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="field min-w-[96px]">
            <div className="label">Price</div>
            <div className="amount" style={{ color: 'var(--before)' }}>{fmtUsdc(p.price)}</div>
          </div>
          <div className="field min-w-[96px]">
            <div className="label">Bond</div>
            <div className="amount" style={{ color: 'var(--before)' }}>{fmtUsdc(p.bond)}</div>
          </div>
          {dial && <div className="hidden sm:block">{dial(92)}</div>}
        </div>
        {p.output ? (
          <div className="field">
            <div className="label">Output (read from the chain)</div>
            <div className="data" style={{ whiteSpace: 'normal', wordBreak: 'break-word', fontSize: 15 }}>“{p.output}”</div>
          </div>
        ) : null}
        {p.settlement && p.status !== null ? <SettlementMark jobStatus={p.status} settlement={p.settlement} price={p.price} bond={p.bond} animate={p.animate} /> : null}
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
