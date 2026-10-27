import { BaseError, ContractFunctionRevertedError, keccak256, stringToHex, toBytes } from 'viem'
import type { Address, Hex } from 'viem'
import { replyBondAbi, Status, STATUS_NAMES } from '../../src/lib/abi.js'
import { OPEN_OFFER_MAX_AGE_S, ctx, sameAddr } from './config.js'
import { hashInput } from './fixtures.js'
import type { Mode } from './fixtures.js'
import type { Deps } from './deps.js'
import { redact } from './http.js'
import { classify, loadSnapshot } from './state.js'
import type { Snapshot } from './state.js'
import { Skipped, sendTx } from './tx.js'

export interface ChainJob {
  provider: Address
  buyer: Address
  price: bigint
  bond: bigint
  requestHash: Hex
  graceWindow: number
  deadline: number
  respondedAt: number
  responseHash: Hex
  status: number
}

/** Authoritative onchain read; null when the job id does not exist. */
export async function readJob(id: bigint): Promise<ChainJob | null> {
  const c = ctx()
  try {
    const j = await c.pub.readContract({ address: c.replyBond, abi: replyBondAbi, functionName: 'getJob', args: [id] })
    return {
      provider: j.provider,
      buyer: j.buyer,
      price: j.price,
      bond: j.bond,
      requestHash: j.requestHash,
      graceWindow: Number(j.graceWindow),
      deadline: Number(j.deadline),
      respondedAt: Number(j.respondedAt),
      responseHash: j.responseHash,
      status: j.status,
    }
  } catch (err) {
    if (err instanceof BaseError) {
      const rev = err.walk((e) => e instanceof ContractFunctionRevertedError)
      if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName === 'UnknownJob') return null
    }
    throw err
  }
}

export async function chainNow(): Promise<number> {
  return Number((await ctx().pub.getBlock()).timestamp)
}

/** What the page can do next with a job that cannot be answered. */
export function settlePath(j: ChainJob, now: number) {
  const demo = sameAddr(j.buyer, ctx().demoBuyerAddress)
  if (j.status === Status.Accepted) {
    if (now > j.deadline) {
      return demo
        ? { action: 'timeout', via: 'POST /api/settle', note: 'deadline passed; the demo buyer can call timeout (refund + bond)' }
        : { action: 'timeout', by: 'buyer', note: 'deadline passed; the buyer wallet can call timeout itself' }
    }
    return { action: 'wait', readyInSeconds: j.deadline + 1 - now, note: 'still inside the response deadline' }
  }
  if (j.status === Status.Responded) {
    return now > j.respondedAt + j.graceWindow
      ? { action: 'claim', via: 'POST /api/settle', note: 'grace window over; the provider claims price + bond' }
      : { action: 'wait', readyInSeconds: j.respondedAt + j.graceWindow + 1 - now, note: 'buyer may acknowledge; claim opens after the grace window' }
  }
  return { action: 'none', note: `job is ${STATUS_NAMES[j.status]}` }
}

export interface JobResult {
  status: number
  body: Record<string, unknown>
}

const refuse = (status: number, reason: string, extra: Record<string, unknown> = {}): JobResult => ({
  status,
  body: { refused: true, reason, ...extra },
})

/** Shared by POST /api/job, the sweep, and demo-run. */
export async function respondToJob(jobId: bigint, mode?: Mode): Promise<JobResult> {
  const cj = await readJob(jobId)
  if (!cj) return refuse(404, 'job does not exist', { jobId })
  const cls = classify(cj, mode)
  if (!cls.ok) return refuse(403, cls.reason, { jobId })
  const { record } = cls
  const now = await chainNow()
  const state = STATUS_NAMES[cj.status]

  if (cj.status === Status.Open) return refuse(409, 'offer has not been accepted yet', { jobId, state })
  if (cj.status !== Status.Accepted && cj.status !== Status.Responded) {
    const snapJob = (await loadSnapshot()).jobs.find((j) => j.id === jobId)
    return refuse(409, `job is already ${state}`, { jobId, state, settleTxHash: snapJob?.txs.settled ?? null, settle: settlePath(cj, now) })
  }

  if (record.mode === 'silent') {
    if (cj.status !== Status.Accepted) return refuse(409, `silent job is ${state}`, { jobId, state })
    return { status: 200, body: { accepted: true, jobId, deadline: cj.deadline, pastDeadline: now > cj.deadline, settle: settlePath(cj, now) } }
  }

  if (hashInput(record.input) !== cj.requestHash.toLowerCase()) return refuse(403, 'refused: keccak256(input) does not match the job requestHash', { jobId })
  const output = record.input.toUpperCase()
  const responseHash = keccak256(toBytes(output))

  if (cj.status === Status.Responded) {
    const snapJob = (await loadSnapshot()).jobs.find((j) => j.id === jobId)
    return { status: 200, body: { output, responseHash: cj.responseHash, txHash: snapJob?.txs.responded ?? null, alreadyResponded: true } }
  }
  if (now > cj.deadline) return refuse(409, 'response deadline has passed', { jobId, state, settle: settlePath(cj, now) })

  const tx = await sendTx('provider', 'respond', [jobId, stringToHex(output)], {
    precheck: async () => {
      const fresh = await readJob(jobId)
      return fresh && fresh.status === Status.Accepted && (await chainNow()) <= fresh.deadline ? null : 'job is no longer Accepted within its deadline'
    },
  }).catch(async (err: unknown) => {
    if (!(err instanceof Skipped)) throw err
    const again = await readJob(jobId)
    if (again?.status === Status.Responded) return null
    throw err
  })
  if (!tx) {
    const snapJob = (await loadSnapshot()).jobs.find((j) => j.id === jobId)
    return { status: 200, body: { output, responseHash, txHash: snapJob?.txs.responded ?? null, alreadyResponded: true } }
  }
  return { status: 200, body: { output, responseHash, txHash: tx.hash } }
}

export interface SweepResult {
  contract: Address
  chainId: number
  providerAddress: Address
  demoBuyerAddress: Address
  chainTime: number
  scannedJobs: number
  fromBlock: bigint
  responded: { jobId: bigint; txHash: Hex }[]
  claimed: { jobId: bigint; txHash: Hex }[]
  withdrawn: { jobId: bigint; txHash: Hex }[]
  skipped: { jobId: bigint; action: string; why: string }[]
  errors: { jobId: bigint; action: string; error: string }[]
}

export type SweepAction = 'respond' | 'claim' | 'withdraw'
export interface PlannedAction {
  jobId: bigint
  action: SweepAction
}

/** At most this many claims plus withdrawals run in one sweep; answering a buyer always comes first. */
export const SWEEP_SETTLE_CAP = 3

/**
 * Order of work for one sweep: every respond (soonest deadline first), then claims, then withdrawals.
 * Claims and withdrawals together are capped; what is left over is reported as skipped and picked up next time.
 */
export function planSweep(snap: Snapshot): { actions: PlannedAction[]; skipped: { jobId: bigint; action: SweepAction; why: string }[] } {
  const responds: Snapshot['jobs'] = []
  const rest: PlannedAction[] = []
  const claims: PlannedAction[] = []
  const withdraws: PlannedAction[] = []
  for (const j of snap.jobs) {
    const cls = classify(j)
    if (cls.ok && cls.record.mode === 'normal' && j.status === Status.Accepted && snap.now <= j.deadline) responds.push(j)
    else if (cls.ok && j.status === Status.Responded && snap.now > j.respondedAt + j.graceWindow) claims.push({ jobId: j.id, action: 'claim' })
    else if (j.status === Status.Open && snap.now - j.postedAt > OPEN_OFFER_MAX_AGE_S) withdraws.push({ jobId: j.id, action: 'withdraw' })
  }
  responds.sort((a, b) => (a.deadline === b.deadline ? (a.id < b.id ? -1 : 1) : a.deadline - b.deadline))
  rest.push(...claims, ...withdraws)
  return {
    actions: [...responds.map((j): PlannedAction => ({ jobId: j.id, action: 'respond' })), ...rest.slice(0, SWEEP_SETTLE_CAP)],
    skipped: rest.slice(SWEEP_SETTLE_CAP).map((a) => ({ ...a, why: 'cap' })),
  }
}

/**
 * Idempotent dispatch sweep over our provider's jobs. Never responds to silent records.
 * With `deadlineMs` (a Date.now()-style time) it starts no new action once that time has passed.
 */
export async function runSweep(deadlineMs?: number, deps: Partial<Pick<Deps, 'now' | 'send' | 'snapshot' | 'respond'>> = {}): Promise<SweepResult> {
  const now = deps.now ?? (() => Date.now())
  const send = deps.send ?? sendTx
  const respond = deps.respond ?? respondToJob
  const snap = await (deps.snapshot ?? loadSnapshot)()
  const c = ctx()
  const plan = planSweep(snap)
  const out: SweepResult = {
    contract: c.replyBond,
    chainId: c.chain.id,
    providerAddress: c.providerAddress,
    demoBuyerAddress: c.demoBuyerAddress,
    chainTime: snap.now,
    scannedJobs: snap.jobs.length,
    fromBlock: snap.fromBlock,
    responded: [],
    claimed: [],
    withdrawn: [],
    skipped: [...plan.skipped],
    errors: [],
  }
  for (const { jobId, action } of plan.actions) {
    if (deadlineMs !== undefined && now() >= deadlineMs) {
      out.skipped.push({ jobId, action, why: 'budget' })
      continue
    }
    try {
      if (action === 'respond') {
        const r = await respond(jobId, 'normal')
        if (r.status === 200 && typeof r.body.txHash === 'string' && !r.body.alreadyResponded) out.responded.push({ jobId, txHash: r.body.txHash as Hex })
        else out.skipped.push({ jobId, action, why: String(r.body.reason ?? 'already responded') })
      } else {
        const fn = action === 'claim' ? 'claim' : 'withdrawOffer'
        const want = action === 'claim' ? Status.Responded : Status.Open
        const tx = await send('provider', fn, [jobId], {
          precheck: async () => {
            const fresh = await readJob(jobId)
            if (!fresh || fresh.status !== want) return `job is no longer ${STATUS_NAMES[want]}`
            return action === 'claim' && (await chainNow()) <= fresh.respondedAt + fresh.graceWindow ? 'grace window not over' : null
          },
        })
        ;(action === 'claim' ? out.claimed : out.withdrawn).push({ jobId, txHash: tx.hash })
      }
    } catch (err) {
      if (err instanceof Skipped) out.skipped.push({ jobId, action, why: err.message })
      else out.errors.push({ jobId, action, error: redact((err as { shortMessage?: string; message?: string }).shortMessage ?? (err as Error).message) })
    }
  }
  return out
}
