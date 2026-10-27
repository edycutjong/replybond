import { useEffect, useMemo, useRef } from 'react'
import { BuiltWithStudio, HowItWorks, JumpToProof, LimitsAndNext, LiveContract, OpenAppButton } from './components/landing'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { useChainIdentity } from './hooks/useChainIdentity'
import { useHeroCard } from './hooks/useHeroCard'
import { useJobs, useTick } from './hooks/useJobs'
import { useSettleNow } from './hooks/useSettleNow'
import { useSettlements } from './hooks/useSettlements'
import { Status } from './lib/abi'
import { CHAIN_ID, NETWORK_NAME, PROOF_TIMEOUT_TX } from './lib/appConfig'
import { MAINNET_PROOF, heroCaption } from './lib/proof'

/** `/`: the problem, a live stamp hero from the same receipt path as the app, how it works, the proof, the limits. */
export default function Landing() {
  const { jobs, loading, scanning, refresh, chainNow } = useJobs()
  useTick()
  const now = chainNow()
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

  // Says whether the card is the pinned proof or a live run, and where the fixed proof set is.
  const caption = heroCaption({
    shownTx: initial?.settlement.txHash ?? null,
    pinnedTx: PROOF_TIMEOUT_TX,
    jobId: initial?.jobId ?? null,
    proofCount: CHAIN_ID === MAINNET_PROOF.chainId ? Object.keys(MAINNET_PROOF.txs).length : null,
  })

  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-28">
      <Header variant="landing" />
      <section aria-labelledby="problem" className="mt-6 sm:mt-8 max-w-[860px]">
        <h2 id="problem" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '0.01em', fontSize: 'clamp(24px, 4.4vw, 38px)', lineHeight: 1.12 }}>
          When you pay an API and it never answers, you lose the money and the time, and nobody pays you back.
        </h2>
        <p className="mt-3 text-[17px] sm:text-[19px]">
          ReplyBond holds the provider's bond. A missed deadline pays the buyer back plus a penalty, on Arc, in USDC.
        </p>
      </section>
      <div className="mt-5">
        <Hero
          settle={settle}
          initial={initial}
          loading={heroLoading}
          demoBuyer={identity.demoBuyer ?? undefined}
          now={now}
          stacked
          extraAction={
            <>
              <OpenAppButton />
              <JumpToProof />
            </>
          }
          caption={caption}
          subline={`Sends a real settlement on ${NETWORK_NAME}. Refund + penalty lands in seconds.`}
        />
      </div>
      <HowItWorks />
      <LiveContract />
      <BuiltWithStudio />
      <LimitsAndNext />
    </main>
  )
}
