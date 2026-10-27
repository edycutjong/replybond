import { demoRun, isDemoMode } from './_lib/flows.js'
import { HttpError, bodyOf, route } from './_lib/http.js'

/** POST /api/demo-run {mode}: a full demo job for visitors without a wallet. */
export default route(['POST'], async (req) => {
  const { mode } = bodyOf(req)
  if (!isDemoMode(mode)) throw new HttpError(400, 'mode must be "normal", "silent" or "buyer-silent"')
  const r = await demoRun(mode)
  return { status: r.status, body: r.body }
})
