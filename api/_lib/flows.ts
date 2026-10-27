import { formatEther, parseEventLogs } from 'viem'
import type { Address, Hex } from 'viem'
import { replyBondAbi, Status, STATUS_NAMES } from '../../src/lib/abi.js'
import { readJob, chainNow, runSweep, settlePath } from './actions.js'
import type { JobResult } from './actions.js'
import { withDeps } from './deps.js'
import type { Deps } from './deps.js'
import { redact } from './http.js'
import { BOND, GRACE_WINDOW, MIN_WALLET_BALANCE, POOL_GRACE_WINDOW, POOL_TARGET, PRICE, RESPONSE_WINDOW, ctx, sameAddr } from './config.js'
import { recordByMode } from './fixtures.js'
import type { Mode, OfferRecord } from './fixtures.js'
import { busyStatus, classify, emptySettleBody, loadSnapshot, orphanedExpired, poolStatus, rateStatus, reusableOffer, rotationCandidates, walletFloor, walletsLowBody } from './state.js'
import type { Snapshot } from './state.js'
import { Skipped, sendTx } from './tx.js'

const shortErr = (e: unknown) => redact((e as { shortMessage?: string }).shortMessage ?? (e as Error).message)

const sweepSummary = (s: Awaited<ReturnType<typeof runSweep>>) => ({
  responded: s.responded.length,
  claimed: s.claimed.length,
  withdrawn: s.withdrawn.length,
  errors: s.errors,
})

/** `grace` is GRACE_WINDOW for real jobs and POOL_GRACE_WINDOW for refill stock (the on-chain pool marker). */
async function postOffer(d: Deps, record: OfferRecord, designated: Address, grace: bigint = GRACE_WINDOW) {
  const tx = await d.send('provider', 'postOffer', [record.requestHash, designated, PRICE, RESPONSE_WINDOW, grace], { value: BOND })
  const ev = parseEventLogs({ abi: replyBondAbi, logs: tx.receipt.logs, eventName: 'OfferPosted' })[0]
  if (!ev) throw new Error(`OfferPosted not found in ${tx.hash}`)
  return { jobId: ev.args.id, txHash: tx.hash }
}

async function acceptAsDemoBuyer(d: Deps, jobId: bigint) {
  const tx = await d.send('buyer', 'acceptOffer', [jobId], { value: PRICE })
  const job = await d.readJob(jobId)
  return { txHash: tx.hash, deadline: job?.deadline ?? 0 }
}

export async function receiptSummary(hash: Hex) {
  const r = await ctx().pub.getTransactionReceipt({ hash })
  return {
    txHash: hash,
    status: r.status,
    blockNumber: r.blockNumber,
    gasUsed: r.gasUsed,
    logs: r.logs.map((l) => ({ logIndex: l.logIndex, address: l.address, topics: l.topics, data: l.data })),
  }
}

function limited(kind: 'busy' | 'rate_limited', snap: Snapshot, rate: ReturnType<typeof rateStatus>, busy: Awaited<ReturnType<typeof busyStatus>> | null) {
  const retryAts = [!rate.allowed ? rate.retryAt : null, busy?.retryAt ?? null].filter((x): x is number => x !== null)
  const retryAt = retryAts.length ? Math.max(...retryAts) : null
  return {
    error: kind,
    message: kind === 'busy' ? 'A job is in flight; try again at retryAt.' : 'Hourly or daily offer limit reached; try again at retryAt.',
    retryAt,
    retryInSeconds: retryAt === null ? null : Math.max(0, retryAt - snap.now),
    busy: busy ? { reasons: busy.reasons } : undefined,
    rate: { hour: rate.hour, day: rate.day },
    pool: poolStatus(snap),
  }
}

/** 'buyer-silent': a normal job that the provider answers and the demo buyer never acknowledges (the claim path). */
export type DemoMode = Mode | 'buyer-silent'
export const isDemoMode = (v: unknown): v is DemoMode => v === 'normal' || v === 'silent' || v === 'buyer-silent'

export async function demoRun(mode: DemoMode, deps?: Partial<Deps>): Promise<JobResult> {
  const d = withDeps(deps)
  const floor = await walletFloor(d)
  if (!floor.ok) return { status: 503, body: walletsLowBody(floor) }
  const sweep = await runSweep(undefined, d)
  const snap = await d.snapshot()
  const rate = rateStatus(snap, 1)
  if (!rate.allowed) return { status: 409, body: limited('rate_limited', snap, rate, null) }
  const busy = await busyStatus(snap)
  if (busy.busy) return { status: 409, body: limited('busy', snap, rate, busy) }

  const record = recordByMode(mode === 'silent' ? 'silent' : 'normal')
  const posted = await postOffer(d, record, ctx().demoBuyerAddress)
  const accepted = await acceptAsDemoBuyer(d, posted.jobId)
  const txHashes: Record<string, Hex | null> = { postOffer: posted.txHash, acceptOffer: accepted.txHash }
  if (mode === 'silent') return { status: 200, body: { mode, jobId: posted.jobId, deadline: accepted.deadline, txHashes, sweep: sweepSummary(sweep) } }

  const answered = await d.respond(posted.jobId, 'normal')
  if (answered.status !== 200) return { status: 502, body: { error: 'job route refused our own demo job', jobId: posted.jobId, txHashes, detail: answered.body } }
  txHashes.respond = (answered.body.txHash as Hex | null) ?? null
  if (mode === 'buyer-silent') {
    // The demo buyer does not acknowledge: after the (unchanged) grace window the provider claims.
    const answeredJob = await d.readJob(posted.jobId)
    return {
      status: 200,
      body: {
        mode,
        jobId: posted.jobId,
        deadline: accepted.deadline,
        respondedAt: answeredJob?.respondedAt ?? null,
        graceWindow: Number(GRACE_WINDOW),
        output: answered.body.output,
        responseHash: answered.body.responseHash,
        txHashes,
        sweep: sweepSummary(sweep),
      },
    }
  }
  const ack = await d.send('buyer', 'acknowledge', [posted.jobId], {
    precheck: async () => ((await d.readJob(posted.jobId))?.status === Status.Responded ? null : 'job is not Responded'),
  })
  txHashes.acknowledge = ack.hash
  return {
    status: 200,
    body: { mode, jobId: posted.jobId, deadline: accepted.deadline, output: answered.body.output, responseHash: answered.body.responseHash, finalStatus: 'Paid', txHashes, receipt: await receiptSummary(ack.hash), sweep: sweepSummary(sweep) },
  }
}

function offerBody(d: Deps, jobId: bigint, txHash: Hex | undefined, buyer: Address, sweep: Awaited<ReturnType<typeof runSweep>>, reused: boolean) {
  const record = recordByMode('normal')
  return {
    jobId,
    txHash: txHash ?? null,
    buyer,
    contract: ctx().replyBond,
    input: record.input,
    requestHash: record.requestHash,
    price: PRICE,
    priceUsdc: formatEther(PRICE),
    bond: BOND,
    bondUsdc: formatEther(BOND),
    responseWindow: Number(RESPONSE_WINDOW),
    graceWindow: Number(GRACE_WINDOW),
    reused,
    note: 'Accept it from the buyer wallet with acceptOffer(jobId), paying exactly price. The sweep answers within the deadline.',
    sweep: sweepSummary(sweep),
  }
}

export async function ownWalletOffer(buyer: Address, deps?: Partial<Deps>): Promise<JobResult> {
  const d = withDeps(deps)
  const sweep = await runSweep(undefined, d)
  const snap = await d.snapshot()
  // An offer for this buyer that is still Open and fresh is handed back instead of posting another one.
  const reusable = reusableOffer(snap, buyer)
  if (reusable) return { status: 200, body: offerBody(d, reusable.id, reusable.txs.posted, buyer, sweep, true) }
  // This path spends only the provider's bond and gas, so only the provider wallet must clear the floor.
  const floor = await walletFloor(d)
  if (floor.provider < MIN_WALLET_BALANCE) return { status: 503, body: walletsLowBody(floor) }
  const rate = rateStatus(snap, 1)
  if (!rate.allowed) return { status: 429, body: limited('rate_limited', snap, rate, null) }
  const posted = await postOffer(d, recordByMode('normal'), buyer)
  return { status: 200, body: offerBody(d, posted.jobId, posted.txHash, buyer, sweep, false) }
}

/** The platform stops a function at 60 s: the daily cron call stays inside 50 s, the page's on-demand call inside 45 s. */
export const CRON_REFILL_BUDGET_MS = 50_000
export const ON_DEMAND_REFILL_BUDGET_MS = 45_000

/** Options for one refill call. Only the authorised cron call rotates stock; both calls carry a deadline. */
export function refillOptions(cron: boolean, startedMs: number): { rotate: boolean; deadlineMs: number } {
  return { rotate: cron, deadlineMs: startedMs + (cron ? CRON_REFILL_BUDGET_MS : ON_DEMAND_REFILL_BUDGET_MS) }
}

/**
 * Tops the pool up to POOL_TARGET silent jobs. With `rotate` (the daily cron) every ready stock job is timed out
 * first, so stock never gets older than a day. `deadlineMs` bounds the call: no new timeout with less than 5 s
 * left, no new post+accept pair with less than 15 s left, so a function is never stopped between a post and its accept
 * by a call that was allowed to start the pair.
 */
export async function refill(opts: { rotate?: boolean; deadlineMs?: number } = {}, deps?: Partial<Deps>): Promise<JobResult> {
  const d = withDeps(deps)
  const left = () => (opts.deadlineMs === undefined ? Number.POSITIVE_INFINITY : opts.deadlineMs - d.now())
  let snap = await d.snapshot()

  const rotated: { jobId: bigint; txHash: Hex }[] = []
  const rotateErrors: { jobId: bigint; error: string }[] = []
  if (opts.rotate) {
    for (const j of rotationCandidates(snap)) {
      if (left() < 5_000) break
      try {
        const tx = await d.send('buyer', 'timeout', [j.id], {
          precheck: async () => {
            const f = await d.readJob(j.id)
            return f && f.status === Status.Accepted && (await chainNow()) > f.deadline ? null : 'job is not past its deadline'
          },
        })
        rotated.push({ jobId: j.id, txHash: tx.hash })
      } catch (err) {
        if (!(err instanceof Skipped)) rotateErrors.push({ jobId: j.id, error: shortErr(err) })
      }
    }
    snap = await d.snapshot()
  }

  const need = POOL_TARGET - poolStatus(snap).size
  if (need <= 0) return { status: 200, body: { created: [], rotated, rotateErrors, note: 'pool already at target', pool: poolStatus(snap) } }
  const floor = await walletFloor(d)
  if (!floor.ok) return { status: 503, body: { ...walletsLowBody(floor), rotated } }
  let planned = need
  while (planned > 0 && !rateStatus(snap, planned).allowed) planned--
  if (planned === 0) return { status: 429, body: { ...limited('rate_limited', snap, rateStatus(snap, 1), null), rotated } }

  const record = recordByMode('silent')
  const created: { jobId: bigint; postOffer: Hex; acceptOffer: Hex; deadline: number }[] = []
  let failure: string | undefined
  let attempted = 0
  let stoppedForTime = false
  for (let i = 0; i < planned && !failure; i++) {
    if (left() < 15_000) {
      stoppedForTime = true
      break
    }
    // Re-read the pool before every pair, so concurrent refills cannot overshoot the target by a whole set.
    const current = i === 0 ? snap : await d.snapshot()
    if (poolStatus(current).size >= POOL_TARGET || !rateStatus(current, 1).allowed) break
    attempted++
    try {
      const posted = await postOffer(d, record, ctx().demoBuyerAddress, POOL_GRACE_WINDOW)
      const accepted = await acceptAsDemoBuyer(d, posted.jobId)
      created.push({ jobId: posted.jobId, postOffer: posted.txHash, acceptOffer: accepted.txHash, deadline: accepted.deadline })
    } catch (err) {
      failure = shortErr(err)
    }
  }
  const after = await d.snapshot()
  return {
    status: failure && !created.length ? 502 : 200,
    body: { requested: need, planned, attempted, created, rotated, rotateErrors, stoppedForTime, error: failure, pool: poolStatus(after) },
  }
}

export async function settle(jobId?: bigint): Promise<JobResult> {
  const sweep = await runSweep()
  const snap = await loadSnapshot()
  const c = ctx()
  const done = async (action: string, id: bigint, hash: Hex, extra: Record<string, unknown> = {}): Promise<JobResult> => ({
    status: 200,
    body: { settled: true, action, actionLabel: action === 'timeout' ? 'timed out' : 'claimed', by: 'this call', jobId: id, txHash: hash, receipt: await receiptSummary(hash), ...extra, pool: poolStatus(await loadSnapshot()), sweep: sweepSummary(sweep) },
  })

  /** The job is already settled (by this sweep, an earlier call, or a wallet): report the action actually taken. */
  const alreadySettled = async (id: bigint, status: number): Promise<JobResult> => {
    const sid = String(id)
    const bySweep = [...sweep.claimed, ...sweep.withdrawn].some((x) => String(x.jobId) === sid)
    const what: Record<number, [string, string, string]> = {
      [Status.Paid]: ['paid', 'paid by the buyer', 'already paid (acknowledged)'],
      [Status.Claimed]: ['claimed', 'claimed by sweep', 'already claimed'],
      [Status.TimedOut]: ['timed_out', 'timed out by sweep', 'already timed out'],
      [Status.Withdrawn]: ['withdrawn', 'withdrawn by sweep', 'already withdrawn'],
    }
    const [action, swept, earlier] = what[status] ?? ['settled', 'settled by sweep', 'already settled']
    const hash = (await loadSnapshot()).jobs.find((j) => j.id === id)?.txs.settled ?? null
    return {
      status: 200,
      body: {
        settled: true,
        alreadySettled: true,
        action,
        actionLabel: bySweep ? swept : earlier,
        by: bySweep ? 'sweep' : 'earlier',
        jobId: id,
        state: STATUS_NAMES[status],
        txHash: hash,
        receipt: hash ? await receiptSummary(hash) : null,
        pool: poolStatus(await loadSnapshot()),
        sweep: sweepSummary(sweep),
      },
    }
  }

  if (jobId !== undefined) {
    const cj = await readJob(jobId)
    if (!cj) return { status: 404, body: { refused: true, reason: 'job does not exist', jobId } }
    const cls = classify(cj)
    if (!cls.ok) return { status: 403, body: { refused: true, reason: cls.reason, jobId } }
    const now = await chainNow()
    const state = STATUS_NAMES[cj.status]
    if (cj.status === Status.Open) return { status: 409, body: { refused: true, reason: 'offer has not been accepted yet', jobId, state } }
    if (cj.status > Status.Responded) return alreadySettled(jobId, cj.status)
    const path = settlePath(cj, now)
    if (path.action === 'wait') return { status: 409, body: { settled: false, reason: path.note, jobId, state, readyInSeconds: path.readyInSeconds } }
    if (cj.status === Status.Accepted) {
      if (!sameAddr(cj.buyer, c.demoBuyerAddress)) return { status: 403, body: { refused: true, reason: 'the server only pays gas to time out demo-buyer jobs; the buyer wallet can call timeout itself', jobId, state } }
      try {
        const tx = await sendTx('buyer', 'timeout', [jobId], { precheck: async () => ((await readJob(jobId))?.status === Status.Accepted ? null : 'already settled') })
        return done('timeout', jobId, tx.hash)
      } catch (err) {
        if (err instanceof Skipped) return alreadySettled(jobId, (await readJob(jobId))?.status ?? cj.status)
        throw err
      }
    }
    try {
      const tx = await sendTx('provider', 'claim', [jobId], { precheck: async () => ((await readJob(jobId))?.status === Status.Responded ? null : 'already settled') })
      return done('claim', jobId, tx.hash)
    } catch (err) {
      if (err instanceof Skipped) return alreadySettled(jobId, (await readJob(jobId))?.status ?? cj.status)
      throw err
    }
  }

  // No jobId. A missed deadline nobody settled (a stuck demo job, any fixture) comes first; pool stock waits behind it.
  const pool = poolStatus(snap)
  for (const o of orphanedExpired(snap)) {
    try {
      const tx = await sendTx('buyer', 'timeout', [o.id], { precheck: async () => ((await readJob(o.id))?.status === Status.Accepted ? null : 'already settled') })
      return done('timeout', o.id, tx.hash, { source: 'expired demo job' })
    } catch (err) {
      if (!(err instanceof Skipped)) throw err
    }
  }
  // Then the oldest pooled silent job that is past its deadline.
  for (const id of pool.ready) {
    try {
      const tx = await sendTx('buyer', 'timeout', [id], {
        precheck: async () => {
          const f = await readJob(id)
          return f && f.status === Status.Accepted && (await chainNow()) > f.deadline ? null : 'job is not past its deadline'
        },
      })
      return done('timeout', id, tx.hash, { source: 'pool' })
    } catch (err) {
      if (!(err instanceof Skipped)) throw err
    }
  }
  const latest = [...snap.jobs].reverse().find((j) => j.status === Status.TimedOut && j.txs.settled)
  return {
    status: 200,
    body: {
      ...emptySettleBody(pool),
      latestSettledTimeout: latest?.txs.settled ? { jobId: latest.id, receipt: await receiptSummary(latest.txs.settled) } : null,
      pool,
      sweep: sweepSummary(sweep),
    },
  }
}
