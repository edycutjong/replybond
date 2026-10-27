import type { JobResult } from './actions.js'
import { readJob, respondToJob } from './actions.js'
import { ctx } from './config.js'
import type { Mode } from './fixtures.js'
import { loadSnapshot } from './state.js'
import type { Snapshot } from './state.js'
import { sendTx } from './tx.js'

/**
 * The one seam for tests: every function that talks to the chain, the clock or the wallets takes an optional
 * `deps` and falls back to the real values. Pure planners take the snapshot as their argument instead.
 */
export interface Deps {
  pub: ReturnType<typeof ctx>['pub']
  wallets: ReturnType<typeof ctx>['wallets']
  accounts: ReturnType<typeof ctx>['accounts']
  /** Milliseconds, like Date.now(). */
  now: () => number
  send: typeof sendTx
  snapshot: () => Promise<Snapshot>
  respond: (id: bigint, mode: Mode) => Promise<JobResult>
  readJob: typeof readJob
}

export function withDeps(overrides: Partial<Deps> = {}): Deps {
  const c = ctx()
  return {
    pub: c.pub,
    wallets: c.wallets,
    accounts: c.accounts,
    now: () => Date.now(),
    send: sendTx,
    snapshot: loadSnapshot,
    respond: respondToJob,
    readJob,
    ...overrides,
  }
}
