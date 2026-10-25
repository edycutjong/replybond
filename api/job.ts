import { respondToJob } from './_lib/actions.js'
import { isMode } from './_lib/fixtures.js'
import { HttpError, bodyOf, parseJobId, route } from './_lib/http.js'

/** POST /api/job {jobId, mode?}: answer one of our jobs (normal) or acknowledge it (silent), else refuse with the reason. */
export default route(['POST'], async (req) => {
  const body = bodyOf(req)
  const jobId = parseJobId(body.jobId)
  if (body.mode !== undefined && !isMode(body.mode)) throw new HttpError(400, 'mode must be "normal" or "silent"')
  const r = await respondToJob(jobId, body.mode)
  return { status: r.status, body: r.body }
})
