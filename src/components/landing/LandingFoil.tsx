import { ArrowUpRight, RotateCcw } from 'lucide-react'
import type { HeroCard } from '@/components/Hero'
import { useReplay } from '@/hooks/useReplay'
import { TapeText } from './Glyphs'
import { NETWORK_NAME, fmtUsdc, padId, shortHash, txUrl } from '@/lib/appConfig'
import { chipText, replayCaption, shortTx, shouldStamp, tapeFor } from '@/lib/landingModel'
import type { ReplayMode } from '@/lib/landingModel'
import { RESPONSE_WINDOW_S } from '@/lib/terms'

/**
 * The hero card: a counterfoil that replays the latest real settled timeout (or plays the visitor's own settlement as it
 * landed). The clock runs down, and only when classifyReceipt says PAID for a timeout does the stamp land and the buyer
 * stub tear off. Every figure on the card comes from the card's job terms and its classification.
 */
export function LandingFoil({ card, loading, mode }: { card: HeroCard | null; loading: boolean; mode: ReplayMode }) {
  const c = card?.settlement.classification
  const isTimeout = c?.event === 'JobTimedOut'
  const unavailable = !!card?.settlement.unavailable
  const paid = !!card && shouldStamp(c)
  const windowS = card?.responseWindow ?? RESPONSE_WINDOW_S
  const { state, replay } = useReplay({ cardKey: card ? `${card.jobId}:${card.settlement.txHash}:${mode}` : 'none', windowS, mode, active: !!card && isTimeout && !unavailable })

  const amount = c?.amount ?? null
  const amountText = amount !== null ? fmtUsdc(amount) : null
  const stampOn = paid && state.stamp && amountText !== null
  const split =
    stampOn && card.price !== null && card.bond !== null && card.price + card.bond === amount
      ? `${fmtUsdc(card.price)} refund + ${fmtUsdc(card.bond)} penalty, from the job terms`
      : ''
  const inkNote = state.done && c && !unavailable ? (c.kind === 'OWED' ? 'SETTLED · PAYOUT OWED' : c.kind === 'UNREADABLE' ? 'transfer not confirmed' : null) : null

  let stateText = 'awaiting the chain'
  if (card) stateText = unavailable ? 'reading the receipt' : !isTimeout ? 'settled' : !state.done ? 'clock running' : paid ? 'deadline missed' : c?.kind === 'OWED' ? 'payout owed' : 'transfer not confirmed'

  const tape = stampOn && c?.payee && card ? tapeFor({ jobId: card.jobId, amount: amountText, payeeShort: shortHash(c.payee), hash: card.settlement.txHash, hashShort: shortTx(card.settlement.txHash) }).slice(0, state.tapeLines) : []

  return (
    <div className="lp-card">
      <div className={`lp-foil${stampOn ? ' lp-paid' : ''}`} role="group" aria-label={card ? `Job ${Number(card.jobId)} counterfoil` : 'Counterfoil, waiting for the chain'}>
        <div className="lp-stub">
          <span className="lp-cap">Job Nº</span>
          <strong>{card ? padId(card.jobId) : '····'}</strong>
          <span className="lp-cap">Buyer stub</span>
          <strong className="lp-got">{!card ? '—' : stampOn ? `+${amountText}` : `+${fmtUsdc(0n)}`}</strong>
        </div>
        <div className="lp-face">
          <div className="lp-top">
            <p className="lp-cap">Registered job · <span>{stateText}</span></p>
            {card && <span className="lp-chip">{chipText(mode)}</span>}
          </div>
          <div className="lp-row">
            <div className="lp-box"><span className="lp-cap">Price</span><b>{card?.price != null ? fmtUsdc(card.price) : '—'}</b></div>
            <div className="lp-box"><span className="lp-cap">Bond</span><b>{card?.bond != null ? fmtUsdc(card.bond) : '—'}</b></div>
          </div>
          <div className="lp-clockarea">
            <div className="lp-clock">{card ? state.clock : '--:--'}</div>
            {stampOn && (
              <div className="lp-stamp" aria-hidden="true">
                Indemnity paid<small>+{amountText} USDC</small>
              </div>
            )}
            {inkNote && <div className="lp-inkmark">{inkNote}</div>}
          </div>
          <div className="lp-bar"><i style={{ transform: `scaleX(${card ? state.barScale : 1})` }} /></div>
          <p className="lp-split">{split}</p>
          <div className="lp-tape">
            {loading && !card && <div className="lp-wait">awaiting the latest settled timeout from the chain …</div>}
            {!loading && !card && <div className="lp-wait">No settled timeout from this provider in the scanned window yet. Settle one.</div>}
            {card && unavailable && <div className="lp-wait">reading the receipt …</div>}
            {card && !unavailable && isTimeout && !state.done && <div className="lp-wait">awaiting respond() from the provider …</div>}
            {tape.map((l) => (
              <div key={l.kind}>
                <TapeText text={l.text} />
                {l.status && <span className="lp-ok"> · {l.status}</span>}
                {l.hash && (
                  <>
                    {' '}
                    <a href={txUrl(l.hash)} target="_blank" rel="noopener noreferrer">
                      {l.hashShort} <ArrowUpRight size={13} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />
                    </a>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="lp-under">
        <span>{card ? replayCaption({ mode, jobId: card.jobId, windowS, network: NETWORK_NAME }) : ' '}</span>
        {mode === 'replay' && card && isTimeout && !unavailable && (
          <button className="lp-replay" type="button" onClick={replay}>
            Replay <RotateCcw size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />
          </button>
        )}
      </div>
      <p className="lp-sr" aria-live="polite">{stampOn ? `Indemnity paid, +${amountText} USDC to the buyer` : ''}</p>
    </div>
  )
}
