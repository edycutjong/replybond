import { formatEther, parseEventLogs } from 'viem'
import type { Address, Hex } from 'viem'
import { replyBondAbi, Status, STATUS_NAMES } from './abi.js'
import { readJob, chainNow, respondToJob, runSweep, settlePath } from './actions.js'
import type { JobResult } from './actions.js'
import { BOND, GRACE_WINDOW, POOL_TARGET, PRICE, RESPONSE_WINDOW, ctx, sameAddr } from './config.js'
import { recordByMode } from './fixtures.js'
import type { Mode, OfferRecord } from './fixtures.js'
import { busyStatus, classify, loadSnapshot, poolStatus, rateStatus } from './state.js'
import type { Snapshot } from './state.js'
import { Skipped, sendTx } from './tx.js'

const shortErr = (e: unknown) => (e as { shortMessage?: string }).shortMessage ?? (e as Error).message

const sweepSummary = (s: Awaited<ReturnType<typeof runSweep>>) => ({
  responded: s.responded.length,
  claimed: s.claimed.length,
  withdrawn: s.withdrawn.length,
  errors: s.errors,
})

async function postOffer(record: OfferRecord, designated: Address) {
  const tx = await sendTx('provider', 'postOffer', [record.requestHash, designated, PRICE, RESPONSE_WINDOW, GRACE_WINDOW], { value: BOND })
  const ev = parseEventLogs({ abi: replyBondAbi, logs: tx.receipt.logs, eventName: 'OfferPosted' })[0]
  if (!ev) throw new Error(`OfferPosted not found in ${tx.hash}`)
  return { jobId: ev.args.id, txHash: tx.hash }
}

async function acceptAsDemoBuyer(jobId: bigint) {
  const tx = await sendTx('buyer', 'acceptOffer', [jobId], { value: PRICE })
  const job = await readJob(jobId)
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

export async function demoRun(mode: Mode): Promise<JobResult> {
  const sweep = await runSweep()
  const snap = await loadSnapshot()
  const rate = rateStatus(snap, 1)
  if (!rate.allowed) return { status: 409, body: limited('rate_limited', snap, rate, null) }
  const busy = await busyStatus(snap)
  if (busy.busy) return { status: 409, body: limited('busy', snap, rate, busy) }

  const record = recordByMode(mode)
  const posted = await postOffer(record, ctx().demoBuyerAddress)
  const accepted = await acceptAsDemoBuyer(posted.jobId)
  const txHashes: Record<string, Hex | null> = { postOffer: posted.txHash, acceptOffer: accepted.txHash }
  if (mode === 'silent') return { status: 200, body: { mode, jobId: posted.jobId, deadline: accepted.deadline, txHashes, sweep: sweepSummary(sweep) } }

  const answered = await respondToJob(posted.jobId, 'normal')
  if (answered.status !== 200) return { status: 502, body: { error: 'job route refused our own demo job', jobId: posted.jobId, txHashes, detail: answered.body } }
  txHashes.respond = (answered.body.txHash as Hex | null) ?? null
  const ack = await sendTx('buyer', 'acknowledge', [posted.jobId], {
    precheck: async () => ((await readJob(posted.jobId))?.status === Status.Responded ? null : 'job is not Responded'),
  })
  txHashes.acknowledge = ack.hash
  return {
    status: 200,
    body: { mode, jobId: posted.jobId, deadline: accepted.deadline, output: answered.body.output, responseHash: answered.body.responseHash, finalStatus: 'Paid', txHashes, sweep: sweepSummary(sweep) },
  }
}

export async function ownWalletOffer(buyer: Address): Promise<JobResult> {
  const sweep = await runSweep()
  const snap = await loadSnapshot()
  const rate = rateStatus(snap, 1)
  if (!rate.allowed) return { status: 429, body: limited('rate_limited', snap, rate, null) }
  const record = recordByMode('normal')
  const posted = await postOffer(record, buyer)
  return {
    status: 200,
    body: {
      jobId: posted.jobId,
      txHash: posted.txHash,
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
      note: 'Accept it from the buyer wallet with acceptOffer(jobId), paying exactly price. The sweep answers within the deadline.',
      sweep: sweepSummary(sweep),
    },
  }
}

export async function refill(): Promise<JobResult> {
  const snap = await loadSnapshot()
  const pool = poolStatus(snap)
  const need = POOL_TARGET - pool.size
  if (need <= 0) return { status: 200, body: { created: [], note: 'pool already at target', pool } }
  let n = need
  while (n > 0 && !rateStatus(snap, n).allowed) n--
  if (n === 0) return { status: 429, body: limited('rate_limited', snap, rateStatus(snap, 1), null) }

  const record = recordByMode('silent')
  const created: { jobId: bigint; postOffer: Hex; acceptOffer: Hex; deadline: number }[] = []
  let failure: string | undefined
  for (let i = 0; i < n && !failure; i++) {
    try {
      const posted = await postOffer(record, ctx().demoBuyerAddress)
      const accepted = await acceptAsDemoBuyer(posted.jobId)
      created.push({ jobId: posted.jobId, postOffer: posted.txHash, acceptOffer: accepted.txHash, deadline: accepted.deadline })
    } catch (err) {
      failure = shortErr(err)
    }
  }
  const after = await loadSnapshot()
  return { status: failure && !created.length ? 502 : 200, body: { requested: need, attempted: n, created, error: failure, pool: poolStatus(after) } }
}

export async function settle(jobId?: bigint): Promise<JobResult> {
  const sweep = await runSweep()
  const snap = await loadSnapshot()
  const c = ctx()
  const done = async (action: string, id: bigint, hash: Hex, extra: Record<string, unknown> = {}): Promise<JobResult> => ({
    status: 200,
    body: { settled: true, action, jobId: id, txHash: hash, receipt: await receiptSummary(hash), ...extra, pool: poolStatus(await loadSnapshot()), sweep: sweepSummary(sweep) },
  })

  if (jobId !== undefined) {
    const cj = await readJob(jobId)
    if (!cj) return { status: 404, body: { refused: true, reason: 'job does not exist', jobId } }
    const cls = classify(cj)
    if (!cls.ok) return { status: 403, body: { refused: true, reason: cls.reason, jobId } }
    const now = await chainNow()
    const state = STATUS_NAMES[cj.status]
    if (cj.status === Status.Open) return { status: 409, body: { refused: true, reason: 'offer has not been accepted yet', jobId, state } }
    if (cj.status > Status.Responded) {
      const prior = snap.jobs.find((j) => j.id === jobId)?.txs.settled
      return {
        status: 200,
        body: { settled: true, alreadySettled: true, jobId, state, txHash: prior ?? null, receipt: prior ? await receiptSummary(prior) : null, pool: poolStatus(snap), sweep: sweepSummary(sweep) },
      }
    }
    const path = settlePath(cj, now)
    if (path.action === 'wait') return { status: 409, body: { settled: false, reason: path.note, jobId, state, readyInSeconds: path.readyInSeconds } }
    if (cj.status === Status.Accepted) {
      if (!sameAddr(cj.buyer, c.demoBuyerAddress)) return { status: 403, body: { refused: true, reason: 'the server only pays gas to time out demo-buyer jobs; the buyer wallet can call timeout itself', jobId, state } }
      const tx = await sendTx('buyer', 'timeout', [jobId], { precheck: async () => ((await readJob(jobId))?.status === Status.Accepted ? null : 'already settled') })
      return done('timeout', jobId, tx.hash)
    }
    const tx = await sendTx('provider', 'claim', [jobId], { precheck: async () => ((await readJob(jobId))?.status === Status.Responded ? null : 'already settled') })
    return done('claim', jobId, tx.hash)
  }

  // No jobId: time out the oldest pooled silent job that is past its deadline.
  const pool = poolStatus(snap)
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
      settled: false,
      note: pool.nextReadyInSeconds === null ? 'No pooled job yet; call /api/demo-refill.' : `Next one ready in ${pool.nextReadyInSeconds} s.`,
      nextReadyInSeconds: pool.nextReadyInSeconds,
      latestSettledTimeout: latest?.txs.settled ? { jobId: latest.id, receipt: await receiptSummary(latest.txs.settled) } : null,
      pool,
      sweep: sweepSummary(sweep),
    },
  }
}
