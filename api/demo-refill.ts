import { runSweep } from './_lib/actions.js'
import { refill, refillOptions } from './_lib/flows.js'
import { isCronRequest, route } from './_lib/http.js'

/**
 * GET (Vercel Cron) or POST. The page's on-demand call tops the pool up to 3 silent jobs designated to, and
 * accepted by, the demo buyer. The daily cron call also runs the sweep and rotates ready stock first.
 */
export default route(['GET', 'POST'], async (req) => {
  const cron = isCronRequest(req.headers.authorization)
  // Both paths are bounded: the platform stops a function at 60 s, and a call cut off between a post and its accept
  // would leave an offer behind. The on-demand call never rotates and never runs the sweep.
  const opts = refillOptions(cron, Date.now())
  if (!cron) {
    const r = await refill(opts)
    return { status: r.status, body: r.body }
  }
  const sweep = await runSweep(opts.deadlineMs)
  const r = await refill(opts)
  return {
    status: r.status,
    body: {
      ...r.body,
      sweep: { responded: sweep.responded.length, claimed: sweep.claimed.length, withdrawn: sweep.withdrawn.length, errors: sweep.errors.length, errorDetails: sweep.errors, skipped: sweep.skipped.length },
    },
  }
})
