import { ArrowDown, ArrowRight, ArrowUpRight } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { NavLink } from './components/NavLink'
import { LandingFooter, LandingNav } from './components/landing/Chrome'
import { HeroTexture } from './components/landing/Glyphs'
import { LandingFoil } from './components/landing/LandingFoil'
import { Proof } from './components/landing/Proof'
import { Endings, Faq, Honest, Receipts, Studio } from './components/landing/Sections'
import { useChainIdentity } from './hooks/useChainIdentity'
import { useHeroCard } from './hooks/useHeroCard'
import { useJobs, useTick } from './hooks/useJobs'
import { useReducedMotion } from './hooks/useReplay'
import { useSettleNow } from './hooks/useSettleNow'
import { useSettlements } from './hooks/useSettlements'
import { Status } from './lib/abi'
import { CHAIN_ID, NETWORK_NAME, addressUrl, fmtUsdc, shortHash } from './lib/appConfig'
import { shortTx, tapeFor } from './lib/landingModel'
import { MAINNET_PROOF } from './lib/proof'
import { BOND, PRICE, RESPONSE_WINDOW_S } from './lib/terms'

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
      See the {Object.keys(MAINNET_PROOF.txs).length} mainnet transactions <ArrowDown size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />
    </a>
  )
}

/** `/`: the replay card of the latest real settled timeout, the receipts, the endings, the mainnet proof, the limits. */
export default function Landing() {
  const { jobs, loading, scanning, refresh, chainNow } = useJobs()
  useTick()
  const now = chainNow()
  const reduced = useReducedMotion()
  const identity = useChainIdentity()
  const settlements = useSettlements(refresh)
  const settle = useSettleNow(refresh, chainNow)

  const provider = identity.provider?.toLowerCase() ?? null
  const ours = useMemo(() => (provider ? jobs.filter((j) => j.provider.toLowerCase() === provider) : []), [jobs, provider])

  // Read and classify the settle receipt of the latest timeout; a receipt the browser could not fetch is retried.
  const retried = useRef(new Map<string, number>())
  useEffect(() => {
    const j = ours.find((x) => x.status === Status.TimedOut && x.txs.settled)
    if (!j?.txs.settled) return
    const id = String(j.id)
    const s = settlements.byJob[id]
    if (settlements.reading[id] || (s && !s.unavailable)) return
    if (s && Date.now() - (retried.current.get(id) ?? 0) < 15_000) return
    retried.current.set(id, Date.now())
    void settlements.load(id, j.txs.settled)
  }, [ours, settlements])

  const { initial, heroLoading } = useHeroCard({ ours, settlements, loading, scanning, waitingOnSweep: identity.waiting })

  const { state, run } = settle
  const own = state.phase === 'settled' ? state.card : null
  const notreadyCard = state.phase === 'notready' ? state.card : null
  const card = own ?? initial ?? notreadyCard
  const running = state.phase === 'running'
  const left = state.phase === 'notready' && state.nextReadyInSeconds !== null ? Math.max(0, Math.ceil(state.nextReadyInSeconds - (now - state.at))) : null

  // The real tape for the "timeout" tile when this deployment has no mainnet proof set: the card on screen.
  const c = card?.settlement.classification
  const liveTape = card && c?.kind === 'PAID' && c.event === 'JobTimedOut' && c.amount !== null && c.payee
    ? tapeFor({ jobId: card.jobId, amount: fmtUsdc(c.amount), payeeShort: shortHash(c.payee), hash: card.settlement.txHash, hashShort: shortTx(card.settlement.txHash) })
    : null

  const total = fmtUsdc(PRICE + BOND)
  return (
    <div className="lp">
      <div className="lp-hero">
        <HeroTexture ring={`${NETWORK_NAME.toUpperCase()} · CHAIN ${CHAIN_ID} · REGISTERED · INSURED ·`} />
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
                <button className="lp-btn lp-pri" type="button" onClick={() => void run()} disabled={running}>
                  {running ? 'Settling …' : 'Settle a missed deadline now'}
                </button>
                <NavLink to="/app#miss-title" className="lp-btn">
                  Watch a live {RESPONSE_WINDOW_S} s run <ArrowRight size={16} aria-hidden />
                </NavLink>
              </div>
              {state.phase === 'notready' && (
                <p className="lp-note" role="status">
                  {state.message ? state.message : left === null ? 'No pooled job yet. A refill is on its way.' : left > 0 ? `No pooled job is past its deadline yet. Next one ready in ${left} s.` : 'The next one is ready. Press again.'} The card shows the latest real settled receipt.
                </p>
              )}
              {state.phase === 'error' && (
                <p className="lp-note lp-bad" role="alert">
                  {state.message} <button className="lp-linkbtn" type="button" onClick={() => void run()}>Try again</button>
                </p>
              )}
              <p className="lp-fine lp-st lp-d4">
                Settle sends a real timeout on {NETWORK_NAME}; the payout goes to our demo-buyer address, not to you.
                {identity.demoBuyer && (
                  <>
                    {' '}
                    <a className="lp-data" href={addressUrl(identity.demoBuyer)} target="_blank" rel="noopener noreferrer" title={identity.demoBuyer}>
                      {shortHash(identity.demoBuyer)} <ArrowUpRight size={12} aria-hidden style={{ display: 'inline', verticalAlign: '-1px' }} />
                    </a>
                  </>
                )}{' '}
                <JumpToProof reduced={reduced} />
              </p>
            </div>
            <LandingFoil card={card} loading={heroLoading} mode={own ? 'live' : 'replay'} />
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
