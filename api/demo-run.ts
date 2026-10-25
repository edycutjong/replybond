import { demoRun } from './_lib/flows.js'
import { isMode } from './_lib/fixtures.js'
import { HttpError, bodyOf, route } from './_lib/http.js'

/** POST /api/demo-run {mode}: a full demo job for reviewers without a wallet. */
export default route(['POST'], async (req) => {
  const { mode } = bodyOf(req)
  if (!isMode(mode)) throw new HttpError(400, 'mode must be "normal" or "silent"')
  const r = await demoRun(mode)
  return { status: r.status, body: r.body }
})
