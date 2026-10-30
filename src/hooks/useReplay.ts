import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { REPLAY_START_DELAY_MS, REPLAY_TICK_MS, clockRunMs, finalReplayState, replayEndMs, replayState } from '@/lib/landingModel'
import type { ReplayMode, ReplayState } from '@/lib/landingModel'

const QUERY = '(prefers-reduced-motion: reduce)'
function subscribe(cb: () => void) {
  const m = window.matchMedia(QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
/** True when the visitor asked for reduced motion. */
export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)

/**
 * Drives the counterfoil replay. The clock starts at most REPLAY_START_DELAY_MS after the card is ready (at once for the
 * visitor's own settlement) and runs at the replay speed; `replay()` plays it again. With reduced motion the final
 * state is shown at once and nothing animates.
 */
export function useReplay({ cardKey, windowS, mode, active }: { cardKey: string; windowS: number; mode: ReplayMode; active: boolean }): { state: ReplayState; replay: () => void } {
  const reduced = useReducedMotion()
  const [run, setRun] = useState<{ key: string; elapsed: number }>({ key: '', elapsed: -1 })
  const timer = useRef(0)
  const offset = mode === 'live' ? clockRunMs(windowS) : 0

  // One update per clock step (about 15 a second at the replay speed), not one per frame: the clock text changes only
  // that often, and the bar between steps is smoothed by a CSS transition.
  const begin = useCallback(() => {
    window.clearInterval(timer.current)
    const t0 = performance.now()
    const end = replayEndMs(windowS) + 100
    const tick = () => {
      const elapsed = performance.now() - t0 + offset
      setRun({ key: cardKey, elapsed })
      if (elapsed >= end) window.clearInterval(timer.current)
    }
    tick()
    timer.current = window.setInterval(tick, REPLAY_TICK_MS)
  }, [cardKey, windowS, offset])

  useEffect(() => {
    if (!active || reduced) return
    const id = window.setTimeout(begin, mode === 'live' ? 0 : REPLAY_START_DELAY_MS)
    return () => {
      window.clearTimeout(id)
      window.clearInterval(timer.current)
    }
  }, [active, reduced, mode, begin])

  // Before the first frame of a card: a live settlement is already at the stamp, a replay waits at the full clock.
  const elapsed = run.key === cardKey ? run.elapsed : mode === 'live' ? offset : -1
  const state = !active ? replayState(-1, windowS) : reduced ? finalReplayState(windowS) : replayState(elapsed, windowS)
  return { state, replay: begin }
}
