import type { HeroCard } from '@/components/Hero'
import { DEMO_BUYER_ADDRESS } from './appConfig'
import type { ReplayMode } from './landingModel'

/**
 * What the landing page needs from the chain-reading code. That code (viem, the event scan, the settle hooks) loads after
 * the first paint; until it has, the page renders from static data and this store holds its "loading" defaults.
 */
export interface LiveView {
  /** The chain-reading module has mounted. */
  ready: boolean
  card: HeroCard | null
  loading: boolean
  mode: ReplayMode
  phase: 'idle' | 'running' | 'notready' | 'error'
  /** The line under the buttons for the notready and error phases. */
  message: string
  demoBuyer: string | null
}

const INITIAL: LiveView = { ready: false, card: null, loading: true, mode: 'replay', phase: 'idle', message: '', demoBuyer: DEMO_BUYER_ADDRESS }

const box: { view: LiveView; runner: (() => void) | null; queued: boolean } = { view: INITIAL, runner: null, queued: false }
const listeners = new Set<() => void>()

export const getLive = (): LiveView => box.view
export const subscribeLive = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Two cards are the same card when nothing that is drawn from them differs (the live module rebuilds the object every render). */
export function sameCard(a: HeroCard | null, b: HeroCard | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.jobId === b.jobId &&
    a.price === b.price &&
    a.bond === b.bond &&
    a.responseWindow === b.responseWindow &&
    a.onRecordAt === b.onRecordAt &&
    a.settlement.txHash === b.settlement.txHash &&
    a.settlement.unavailable === b.settlement.unavailable &&
    a.settlement.classification.kind === b.settlement.classification.kind &&
    a.settlement.classification.amount === b.settlement.classification.amount &&
    a.settlement.classification.payee === b.settlement.classification.payee &&
    a.settlement.blockTime === b.settlement.blockTime
  )
}

/** Merge a patch; subscribers are told only when something actually changed. */
export function setLive(patch: Partial<LiveView>): void {
  const next = { ...box.view, ...patch }
  const changed = (Object.keys(next) as (keyof LiveView)[]).some((k) => (k === 'card' ? !sameCard(next.card, box.view.card) : next[k] !== box.view[k]))
  if (!changed) return
  box.view = next
  for (const l of listeners) l()
}

/** The live module registers what "Settle a missed deadline now" does; a click before it has loaded is queued. */
export function registerSettle(run: () => void): () => void {
  box.runner = run
  if (box.queued) {
    box.queued = false
    run()
  }
  return () => {
    if (box.runner === run) box.runner = null
  }
}

/** Run the settle, or queue it and ask for the live module if it is not there yet. */
export function requestSettle(loadLive: () => void): void {
  if (box.runner) box.runner()
  else {
    box.queued = true
    loadLive()
  }
}
