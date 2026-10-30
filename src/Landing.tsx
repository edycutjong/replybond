import { ArrowDown, ArrowRight, ArrowUpRight } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react'
import { NavLink } from './components/NavLink'
import { LandingFooter, LandingNav } from './components/landing/Chrome'
import { HeroTexture } from './components/landing/Glyphs'
import { LandingFoil } from './components/landing/LandingFoil'
import { Proof } from './components/landing/Proof'
import { Endings, Faq, Honest, Receipts, Studio } from './components/landing/Sections'
import { useReducedMotion } from './hooks/useReplay'
import { CHAIN_ID, NETWORK_NAME, addressUrl, fmtUsdc, shortHash } from './lib/appConfig'
import { shortTx, tapeFor } from './lib/landingModel'
import { getLive, requestSettle, subscribeLive } from './lib/landingStore'
import { MAINNET_PROOF } from './lib/proof'
import { BOND, PRICE, RESPONSE_WINDOW_S } from './lib/terms'

// The chain-reading side (viem, the event scan, the settle hooks) is its own chunk, fetched after the first paint.
const LandingLive = lazy(() => import('./LandingLive'))

/** Runs `fn` when the browser is idle (or soon after the first paint where it has no idle callback). */
function afterFirstPaint(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 400 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(fn, 120)
  return () => window.clearTimeout(id)
}

/** Scrolls to the proof section; instant when the visitor prefers reduced motion. */
function JumpToProof({ reduced }: { reduced: boolean }) {
  if (CHAIN_ID !== MAINNET_PROOF.chainId) return null
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('proof')
    if (!target) return
    e.preventDefault()
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    window.history.replaceState(null, '', '#proof')
  }
  return (
    <a href="#proof" onClick={onClick} style={{ whiteSpace: 'nowrap' }}>
      See the {Object.keys(MAINNET_PROOF.txs).length} proof transactions <ArrowDown size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />
    </a>
  )
}

/**
 * `/`: the replay card of the latest real settled timeout, the receipts, the endings, the mainnet proof, the limits.
 * Everything here renders from static data; the card and the settle button get their data from LandingLive once it loads.
 */
export default function Landing() {
  const live = useSyncExternalStore(subscribeLive, getLive, getLive)
  const reduced = useReducedMotion()
  const [wantLive, setWantLive] = useState(false)
  useEffect(() => afterFirstPaint(() => setWantLive(true)), [])

  const running = live.phase === 'running'
  // The real tape for the "timeout" tile when this deployment has no mainnet proof set: the card on screen.
  const card = live.card
  const c = card?.settlement.classification
  const liveTape = card && c?.kind === 'PAID' && c.event === 'JobTimedOut' && c.amount !== null && c.payee
    ? tapeFor({ jobId: card.jobId, amount: fmtUsdc(c.amount), payeeShort: shortHash(c.payee), hash: card.settlement.txHash, hashShort: shortTx(card.settlement.txHash) })
    : null

  const total = fmtUsdc(PRICE + BOND)
  return (
    <div className="lp">
      {wantLive && (
        <Suspense fallback={null}>
          <LandingLive />
        </Suspense>
      )}
      <div className="lp-hero">
        <HeroTexture ring={`${NETWORK_NAME.toUpperCase()} · CHAIN ${CHAIN_ID} · REGISTERED · BONDED ·`} />
        <div className="lp-w">
          <LandingNav />
          <div className="lp-hg">
            <div className="lp-lead">
              <p className="lp-cap lp-eyebrow lp-st">Registered API calls · bonded against silence</p>
              <h1 className="lp-st lp-d1">An API that ghosts you <em>pays you back.</em></h1>
              <p className="lp-sub lp-st lp-d2">
                Pay <b>{fmtUsdc(PRICE)}</b> USDC for one call; the provider bonds <b>{fmtUsdc(BOND)}</b> USDC. No answer inside <strong>{RESPONSE_WINDOW_S} seconds</strong>, and anyone can settle it: the contract sends <b>+{total}</b> USDC back to the buyer, on {NETWORK_NAME}.
              </p>
              <div className="lp-ctas lp-st lp-d3">
                <button className="lp-btn lp-pri" type="button" onClick={() => requestSettle(() => setWantLive(true))} disabled={running}>
                  {running ? 'Settling …' : 'Settle a missed deadline now'}
                </button>
                <NavLink to="/app#miss-title" className="lp-btn">
                  Watch a live {RESPONSE_WINDOW_S} s run <ArrowRight size={16} aria-hidden />
                </NavLink>
              </div>
              {live.phase === 'notready' && <p className="lp-note" role="status">{live.message}</p>}
              {live.phase === 'error' && (
                <p className="lp-note lp-bad" role="alert">
                  {live.message} <button className="lp-linkbtn" type="button" onClick={() => requestSettle(() => setWantLive(true))}>Try again</button>
                </p>
              )}
              <p className="lp-fine lp-st lp-d4">
                Settle sends a real timeout on {NETWORK_NAME}; the payout goes to our demo-buyer address, not to you.
                {live.demoBuyer && (
                  <>
                    {' '}
                    <a className="lp-data" href={addressUrl(live.demoBuyer)} target="_blank" rel="noopener noreferrer" title={live.demoBuyer}>
                      {shortHash(live.demoBuyer)} <ArrowUpRight size={12} aria-hidden style={{ display: 'inline', verticalAlign: '-1px' }} />
                    </a>
                  </>
                )}{' '}
                <JumpToProof reduced={reduced} />
              </p>
            </div>
            <LandingFoil card={card} loading={live.loading} mode={live.mode} />
          </div>
          <Receipts />
        </div>
      </div>
      <Endings liveTape={liveTape} />
      <Proof />
      <Studio />
      <Honest />
      <Faq />
      <LandingFooter />
    </div>
  )
}
