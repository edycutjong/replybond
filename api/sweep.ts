import { runSweep } from './_lib/actions.js'
import { route } from './_lib/http.js'

/** GET /api/sweep: respond to our live normal jobs, claim after grace, withdraw stale open offers. Idempotent. */
export default route(['GET', 'POST'], async () => ({ body: await runSweep() }))
