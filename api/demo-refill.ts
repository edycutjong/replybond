import { refill } from './_lib/flows.js'
import { route } from './_lib/http.js'

/** GET (Vercel Cron) or POST: top the pool up to 3 silent jobs designated to, and accepted by, the demo buyer. */
export default route(['GET', 'POST'], async () => {
  const r = await refill()
  return { status: r.status, body: r.body }
})
