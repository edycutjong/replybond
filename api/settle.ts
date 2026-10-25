import { settle } from './_lib/flows.js'
import { bodyOf, parseJobId, route } from './_lib/http.js'

/** POST /api/settle {jobId?}: idempotent settlement (timeout for demo jobs, claim for our provider). */
export default route(['POST'], async (req) => {
  const { jobId } = bodyOf(req)
  const r = await settle(jobId === undefined || jobId === null ? undefined : parseJobId(jobId))
  return { status: r.status, body: r.body }
})
