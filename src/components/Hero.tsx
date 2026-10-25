import { ExternalLink } from 'lucide-react'
import type { SettleNow } from '@/hooks/useSettleNow'
import { NETWORK_NAME, addressUrl, shortHash } from '@/lib/appConfig'
import type { Settlement } from '@/lib/chainReads'
import { STATUS_FOR_EVENT, Counterfoil } from './ui'

export const PAYOUT_NOTE = 'The payout goes to our demo-buyer address, not to you.'

export interface HeroCard {
  jobId: string
  settlement: Settlement
  price: bigint | null
  bond: bigint | null
  responseWindow?: number
}

/**
 * First screen: the counterfoil of the latest real settled timeout of our provider, with the settle button beside it.
 * Clicking replaces the card with the visitor's own new receipt; the stamp lands only if classifyReceipt says PAID.
 */
export function Hero({ settle, initial, loading, demoBuyer, now }: { settle: SettleNow; initial: HeroCard | null; loading: boolean; demoBuyer?: string; now: number }) {
  const { state, run } = settle
  const running = state.phase === 'running'
  const own = state.phase === 'settled' ? state.card : null
  const shown: (HeroCard & { animate: boolean }) | null = own ? { ...own, animate: true } : initial ? { ...initial, animate: false } : null
  const left = state.phase === 'notready' && state.nextReadyInSeconds !== null ? Math.max(0, Math.ceil(state.nextReadyInSeconds - (now - state.at))) : null
  const event = shown?.settlement.classification.event
  return (
    <section aria-labelledby="hero-title" className="pt-3 sm:pt-5 pb-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="order-2 lg:order-1 min-w-0">
          <h2 id="hero-title" className="label mb-2">
            {own ? 'Your settlement, read from the chain' : 'Latest real settled timeout'} · {NETWORK_NAME}
          </h2>
          {shown ? (
            <Counterfoil
              id={shown.jobId}
              price={shown.price ?? 0n}
              bond={shown.bond ?? 0n}
              status={event ? STATUS_FOR_EVENT[event] : null}
              responseWindow={shown.responseWindow}
              now={now}
              settlement={shown.settlement}
              animate={shown.animate}
            />
          ) : (
            <div className="counterfoil hero-skeleton" role="status">
              <div className="stub">
                <div className="label">Job Nº</div>
                <div className="data text-[22px]">····</div>
              </div>
              <div className="p-4 label">
                {loading ? <span className="dots-wait">Reading the latest settled timeout from the chain</span> : 'No settled timeout from this provider in the scanned window yet. Press the button to make one.'}
              </div>
            </div>
          )}
        </div>
        <div className="order-1 lg:order-2">
          <h3 className="panel-title hidden sm:block" style={{ fontSize: 24 }}>When the API stays silent, the buyer is compensated.</h3>
          <div className="sm:mt-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={() => void run()} disabled={running}>
              {running ? <span className="dots-wait">Settling</span> : 'Settle a missed deadline now'}
            </button>
          </div>
          <p className="mt-1 sm:mt-2 text-[15px]">Refund + penalty lands in seconds.</p>
          <p className="mt-1 text-[15px]" style={{ color: 'var(--muted)' }}>
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
          {state.phase === 'notready' && (
            <p className="mt-2 font-semibold" role="status">
              {left === null ? 'No pooled job yet. A refill is on its way.' : left > 0 ? `No pooled job is past its deadline yet. Next one ready in ${left} s.` : 'The next one is ready. Press again.'}
              <span className="block font-normal text-[15px]">The card shows the latest real settled receipt.</span>
            </p>
          )}
          {state.phase === 'error' && (
            <p role="alert" className="mt-2" style={{ color: 'var(--after)' }}>
              {state.message} <button className="link" onClick={() => void run()}>Try again</button>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
