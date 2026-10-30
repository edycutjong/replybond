import { useEffect, useMemo, useRef } from 'react'
import { useChainIdentity } from './hooks/useChainIdentity'
import { useHeroCard } from './hooks/useHeroCard'
import { useJobs, useTick } from './hooks/useJobs'
import { useSettleNow } from './hooks/useSettleNow'
import { useSettlements } from './hooks/useSettlements'
import { Status } from './lib/abi'
import { registerSettle, setLive } from './lib/landingStore'

/**
 * The landing page's chain-reading side, loaded after the first paint. It renders nothing: it reads the latest settled
 * timeout the same way /app does and hands the card, the loading flag and the settle state to the landing store.
 */
export default function LandingLive() {
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

  const { state, run } = settle
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })
  useEffect(() => registerSettle(() => void runRef.current()), [])

  const own = state.phase === 'settled' ? state.card : null
  const notreadyCard = state.phase === 'notready' ? state.card : null
  const left = state.phase === 'notready' && state.nextReadyInSeconds !== null ? Math.max(0, Math.ceil(state.nextReadyInSeconds - (now - state.at))) : null
  let message = ''
  if (state.phase === 'notready') {
    message = `${state.message ? state.message : left === null ? 'No pooled job yet. A refill is on its way.' : left > 0 ? `No pooled job is past its deadline yet. Next one ready in ${left} s.` : 'The next one is ready. Press again.'} The card shows the latest real settled receipt.`
  } else if (state.phase === 'error') message = state.message

  useEffect(() => {
    setLive({
      ready: true,
      card: own ?? initial ?? notreadyCard,
      loading: heroLoading,
      mode: own ? 'live' : 'replay',
      phase: state.phase === 'running' || state.phase === 'notready' || state.phase === 'error' ? state.phase : 'idle',
      message,
      demoBuyer: identity.demoBuyer,
    })
  })
  return null
}
