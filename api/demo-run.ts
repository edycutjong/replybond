import { demoRun, isDemoMode } from './_lib/flows.js'
import { HttpError, bodyOf, route } from './_lib/http.js'
import { parseTermsChoice } from '../src/lib/terms.js'

/** POST /api/demo-run {mode, windowS?, bond?}: a full demo job for visitors without a wallet, with the chosen deadline and bond. */
export default route(['POST'], async (req) => {
  const body = bodyOf(req)
  const { mode } = body
  if (!isDemoMode(mode)) throw new HttpError(400, 'mode must be "normal", "silent" or "buyer-silent"')
  const parsed = parseTermsChoice(body)
  if (!parsed.ok) throw new HttpError(400, parsed.error)
  const r = await demoRun(mode, undefined, parsed.chosen ? parsed.terms : undefined)
  return { status: r.status, body: r.body }
})
