import { useEffect, useRef } from 'react'
import type { DemoRunBody } from '@/lib/api'
import type { SettleNow } from '@/hooks/useSettleNow'
import { blockTime } from './ui'

/** Busy or over the limit: never a dead state. Offers "Settle a missed deadline now" from the pool. */
export function BusyNotice({ body, now, settle }: { body: DemoRunBody; now: number; settle: SettleNow }) {
  const asked = useRef(false)
  const poolEmpty = body.pool?.size === 0
  useEffect(() => {
    // An empty pool has nothing to settle, so asking is side-effect free and fills in the latest real receipt.
    if (poolEmpty && !asked.current) {
      asked.current = true
      void settle.run()
    }
  }, [poolEmpty, settle])
  const left = body.retryAt ? Math.max(0, Math.ceil(body.retryAt - now)) : null
  return (
    <div className="field mt-3" role="status">
      <p className="font-semibold">{body.error === 'rate_limited' ? 'The hourly or daily demo limit is reached.' : 'Another demo job is in flight.'}</p>
      {body.retryAt ? (
        <p className="text-[15px]">
          Try again at <span className="data">{blockTime(body.retryAt)}</span>
          {left !== null ? <> (in <span className="data">{left} s</span>)</> : null}.
        </p>
      ) : null}
      <p className="text-[15px]">
        {poolEmpty ? 'The pool of expired jobs is empty; the latest settled timeout is shown at the top.' : `${body.pool?.size ?? 0} job(s) are in the pool.`} Meanwhile:
      </p>
      <button
        className="btn mt-2"
        onClick={() => {
          void settle.run()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        disabled={settle.state.phase === 'running'}
      >
        Settle a missed deadline now
      </button>
    </div>
  )
}
