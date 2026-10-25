import type { SettleNow } from '@/hooks/useSettleNow'
import { ExternalLink } from 'lucide-react'
import { addressUrl, shortHash } from '@/lib/appConfig'
import { Counterfoil, STATUS_FOR_EVENT } from './ui'
import type { SettledCard } from '@/hooks/useSettleNow'

export const PAYOUT_NOTE = 'The payout goes to our demo-buyer address, not to you.'

function CardView({ c, now }: { c: SettledCard; now: number }) {
  const event = c.settlement.classification.event
  const status = event ? STATUS_FOR_EVENT[event] : null
  return (
    <div className="mt-4 max-w-[760px]">
      <Counterfoil id={c.jobId} price={c.price ?? 0n} bond={c.bond ?? 0n} status={status} now={now} settlement={c.settlement} />
    </div>
  )
}

export function SettleNowBlock({ settle, demoBuyer, now }: { settle: SettleNow; demoBuyer?: string; now: number }) {
  const { state, run } = settle
  const running = state.phase === 'running'
  const left =
    state.phase === 'notready' && state.nextReadyInSeconds !== null
      ? Math.max(0, Math.ceil(state.nextReadyInSeconds - (now - state.at)))
      : null
  return (
    <section aria-labelledby="settle-now" className="py-6">
      <div className="flex flex-wrap items-center gap-4">
        <button id="settle-now" className="btn btn-primary" onClick={() => void run()} disabled={running}>
          {running ? <span className="dots-wait">Settling</span> : 'Settle a missed deadline now'}
        </button>
        <span>Refund + penalty lands in seconds.</span>
      </div>
      <p className="mt-2 text-[15px]" style={{ color: 'var(--muted)' }}>
        {PAYOUT_NOTE}
        {demoBuyer ? (
          <>
            {' '}
            <a className="link data text-[13px]" href={addressUrl(demoBuyer)} target="_blank" rel="noopener noreferrer" title={demoBuyer}>
              {shortHash(demoBuyer)} <ExternalLink size={12} className="inline -mt-0.5" aria-hidden />
            </a>
          </>
        ) : null}
      </p>
      {state.phase === 'settled' && (
        <>
          <CardView c={state.card} now={now} />
          <p className="mt-2 text-[15px]">{PAYOUT_NOTE}</p>
        </>
      )}
      {state.phase === 'notready' && (
        <div className="mt-4 max-w-[760px]">
          <p className="panel-title" style={{ fontSize: 22 }}>
            {left === null ? 'No pooled job yet. A refill is on its way.' : left > 0 ? `Next one ready in ${left} s` : 'Next one is ready. Press again.'}
          </p>
          <p className="text-[15px]">No pooled job is past its deadline yet. Latest real settled timeout:</p>
          {state.card ? <CardView c={state.card} now={now} /> : <p className="text-[15px]">None found in the scanned window.</p>}
          <p className="mt-2 text-[15px]">{PAYOUT_NOTE}</p>
        </div>
      )}
      {state.phase === 'error' && (
        <p role="alert" className="mt-3" style={{ color: 'var(--after)' }}>
          {state.message} <button className="link" onClick={() => void run()}>Try again</button>
        </p>
      )}
    </section>
  )
}
