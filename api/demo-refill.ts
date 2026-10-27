import { runSweep } from './_lib/actions.js'
import { refill } from './_lib/flows.js'
import { isCronRequest, route } from './_lib/http.js'

/**
 * GET (Vercel Cron) or POST. The page's on-demand call tops the pool up to 3 silent jobs designated to, and
 * accepted by, the demo buyer. The daily cron call also runs the sweep and rotates ready stock first.
 */
export default route(['GET', 'POST'], async (req) => {
  if (!isCronRequest(req.headers.authorization)) {
    const r = await refill({ rotate: false })
    return { status: r.status, body: r.body }
  }
  const started = Date.now()
  const deadlineMs = started + 50_000
  const sweep = await runSweep(deadlineMs)
  const r = await refill({ rotate: true, deadlineMs })
  return {
    status: r.status,
    body: {
      ...r.body,
      sweep: { responded: sweep.responded.length, claimed: sweep.claimed.length, withdrawn: sweep.withdrawn.length, errors: sweep.errors.length, errorDetails: sweep.errors, skipped: sweep.skipped.length },
    },
  }
})
