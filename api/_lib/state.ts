import { parseEventLogs } from 'viem'
import type { Address, Hex, Log } from 'viem'
import { replyBondAbi, Status } from '../../src/lib/abi.js'
import { LIMITS, POOL_TARGET, ctx, sameAddr } from './config.js'
import { isPoolStock } from '../../src/lib/pool.js'
import { recordByHash } from './fixtures.js'
import type { Mode, OfferRecord } from './fixtures.js'

export interface Job {
  id: bigint
  provider: Address
  designated: Address
  buyer: Address // the acceptor once Accepted, else the designated buyer
  requestHash: Hex
  price: bigint
  bond: bigint
  graceWindow: number
  status: number
  postedAt: number
  deadline: number
  respondedAt: number
  responseHash: Hex | null
  txs: { posted?: Hex; accepted?: Hex; responded?: Hex; settled?: Hex }
}

export interface Snapshot {
  now: number // latest block timestamp (chain time)
  head: bigint
  fromBlock: bigint
  jobs: Job[] // every job posted by OUR provider inside the scanned window, by id
}

const RANGE_ERR = /range|limit|too many|exceed|response size|more than|too large|timeout/i

async function getLogsChunked(from: bigint, to: bigint, depth = 0): Promise<Log[]> {
  const c = ctx()
  try {
    return await c.pub.getLogs({ address: c.replyBond, fromBlock: from, toBlock: to })
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (from >= to || depth >= 6 || !RANGE_ERR.test(msg)) throw err
    const mid = from + (to - from) / 2n
    return [...(await getLogsChunked(from, mid, depth + 1)), ...(await getLogsChunked(mid + 1n, to, depth + 1))]
  }
}

/** Start block for a ~25h scan: measured from recent block spacing, never earlier than the deployment block. */
async function scanFrom(head: bigint, headTs: number): Promise<bigint> {
  const c = ctx()
  const span = head > 20_000n ? 20_000n : head > 1n ? head - 1n : 0n
  let secPerBlock = 0.5
  if (span > 0n) {
    const sample = await c.pub.getBlock({ blockNumber: head - span })
    const measured = (headTs - Number(sample.timestamp)) / Number(span)
    if (measured > 0.01) secPerBlock = measured
  }
  const lookback = BigInt(Math.ceil((86_400 * 1.15) / secPerBlock)) + 2_000n
  const from = head > lookback ? head - lookback : 0n
  return from > c.startBlock ? from : c.startBlock
}

type ParsedLog = ReturnType<typeof parseEventLogs<typeof replyBondAbi>>[number]
let eventCache: { startedAt: number; from: bigint; scanned: bigint; logs: ParsedLog[] } | null = null

export async function loadSnapshot(): Promise<Snapshot> {
  const c = ctx()
  const latest = await c.pub.getBlock()
  const head = latest.number
  const now = Number(latest.timestamp)
  // Incremental event cache per instance (no reorgs on Arc): the first call scans the ~25h window, later calls only the new blocks.
  if (!eventCache || Date.now() - eventCache.startedAt > 60 * 60 * 1000) {
    eventCache = { startedAt: Date.now(), from: await scanFrom(head, now), scanned: -1n, logs: [] }
  }
  const fromBlock = eventCache.from
  const start = eventCache.scanned < 0n ? fromBlock : eventCache.scanned + 1n
  if (start <= head) {
    const fresh = parseEventLogs({ abi: replyBondAbi, logs: await getLogsChunked(start, head) })
    eventCache = { ...eventCache, scanned: head, logs: [...eventCache.logs, ...fresh] }
  }
  const logs = [...eventCache.logs]
  logs.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  )

  const tsCache = new Map<bigint, number>()
  const tsOf = async (l: (typeof logs)[number]): Promise<number> => {
    const inline = (l as { blockTimestamp?: bigint | string | null }).blockTimestamp
    if (inline !== undefined && inline !== null) return Number(inline)
    const hit = tsCache.get(l.blockNumber)
    if (hit !== undefined) return hit
    const t = Number((await c.pub.getBlock({ blockNumber: l.blockNumber })).timestamp)
    tsCache.set(l.blockNumber, t)
    return t
  }

  const byId = new Map<bigint, Job>()
  for (const l of logs) {
    const tx = l.transactionHash
    switch (l.eventName) {
      case 'OfferPosted': {
        if (!sameAddr(l.args.provider, c.providerAddress)) break
        byId.set(l.args.id, {
          id: l.args.id,
          provider: l.args.provider,
          designated: l.args.buyer,
          buyer: l.args.buyer,
          requestHash: l.args.requestHash,
          price: l.args.price,
          bond: l.args.bond,
          graceWindow: Number(l.args.graceWindow),
          status: Status.Open,
          postedAt: await tsOf(l),
          deadline: 0,
          respondedAt: 0,
          responseHash: null,
          txs: { posted: tx },
        })
        break
      }
      case 'OfferAccepted': {
        const j = byId.get(l.args.id)
        if (!j) break
        Object.assign(j, { status: Status.Accepted, buyer: l.args.buyer, deadline: Number(l.args.deadline) })
        j.txs.accepted = tx
        break
      }
      case 'ResponseCommitted': {
        const j = byId.get(l.args.id)
        if (!j) break
        Object.assign(j, {
          status: Status.Responded,
          respondedAt: Number(l.args.respondedAt),
          responseHash: l.args.responseHash,
        })
        j.txs.responded = tx
        break
      }
      case 'JobPaid':
      case 'JobClaimed':
      case 'JobTimedOut':
      case 'OfferWithdrawn': {
        const j = byId.get(l.args.id)
        if (!j) break
        j.status = { JobPaid: Status.Paid, JobClaimed: Status.Claimed, JobTimedOut: Status.TimedOut, OfferWithdrawn: Status.Withdrawn }[l.eventName]
        j.txs.settled = tx
        break
      }
      default:
        break
    }
  }
  return { now, head, fromBlock, jobs: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) }
}

export type Classified = { ok: true; record: OfferRecord } | { ok: false; reason: string }

/** "Suitable offer / our job": our provider AND a known fixture hash AND (if asked) the requested mode. */
export function classify(job: { provider: string; requestHash: string }, mode?: Mode): Classified {
  if (!sameAddr(job.provider, ctx().providerAddress)) return { ok: false, reason: 'not our job: provider is not PROVIDER_ADDRESS' }
  const record = recordByHash(job.requestHash)
  if (!record) return { ok: false, reason: 'refused: requestHash does not match any fixture record' }
  if (mode && record.mode !== mode) return { ok: false, reason: `refused: fixture record is mode "${record.mode}", requested "${mode}"` }
  return { ok: true, record }
}

const isOurs = (j: Job) => classify(j).ok

export function rateStatus(s: Snapshot, needed = 1) {
  const within = (secs: number) => s.jobs.map((j) => j.postedAt).filter((t) => t > s.now - secs).sort((a, b) => a - b)
  const hour = within(3600)
  const day = within(86_400)
  const retryFor = (ts: number[], max: number, secs: number): number | null => {
    const over = ts.length + needed - max
    if (over <= 0) return s.now
    return over > ts.length ? null : ts[over - 1] + secs
  }
  const allowed = hour.length + needed <= LIMITS.hour && day.length + needed <= LIMITS.day
  const retries = [retryFor(hour, LIMITS.hour, 3600), retryFor(day, LIMITS.day, 86_400)]
  const retryAt = retries.includes(null) ? null : Math.max(...(retries as number[]))
  return {
    allowed,
    hour: { count: hour.length, max: LIMITS.hour },
    day: { count: day.length, max: LIMITS.day },
    retryAt: allowed ? null : retryAt,
    retryInSeconds: allowed || retryAt === null ? null : Math.max(0, retryAt - s.now),
  }
}

/** Pool stock that is still Accepted (waiting on its deadline, or past it and ready to time out). */
const poolJobs = (s: Snapshot) => {
  const buyer = ctx().demoBuyerAddress
  return s.jobs.filter((j) => j.status === Status.Accepted && isPoolStock(j, buyer) && classify(j, 'silent').ok)
}

export function poolStatus(s: Snapshot) {
  const pool = poolJobs(s)
  const ready = pool.filter((j) => s.now > j.deadline)
  const waiting = pool.filter((j) => s.now <= j.deadline)
  return {
    target: POOL_TARGET,
    size: pool.length,
    ready: ready.map((j) => j.id),
    waiting: waiting.map((j) => j.id),
    nextReadyInSeconds: ready.length ? 0 : waiting.length ? Math.max(0, Math.min(...waiting.map((j) => j.deadline)) + 1 - s.now) : null,
  }
}

/** Silent demo-buyer jobs past their deadline that are not pool stock (e.g. a watch run nobody settled). */
export function orphanedExpired(s: Snapshot): Job[] {
  const buyer = ctx().demoBuyerAddress
  return s.jobs.filter(
    (j) => j.status === Status.Accepted && s.now > j.deadline && sameAddr(j.buyer, buyer) && !isPoolStock(j, buyer) && classify(j, 'silent').ok,
  )
}

export interface BusyReason {
  kind: 'pending_nonce' | 'accepted_within_deadline' | 'responded_within_grace'
  detail: string
  until: number
}

/** Job-state half of the busy rule (no network): a non-pool job Accepted within its deadline, or Responded within grace. */
export function jobBusyReasons(s: Snapshot): BusyReason[] {
  const reasons: BusyReason[] = []
  const demoBuyer = ctx().demoBuyerAddress
  for (const j of s.jobs.filter(isOurs)) {
    // Pool stock is exempt from the busy rule whatever its deadline: it is stock, not a job anyone is watching.
    if (j.status === Status.Accepted && isPoolStock(j, demoBuyer)) continue
    if (j.status === Status.Accepted && s.now <= j.deadline) {
      reasons.push({ kind: 'accepted_within_deadline', detail: `job ${j.id} is Accepted, deadline ${j.deadline}`, until: j.deadline + 1 })
    } else if (j.status === Status.Responded && s.now <= j.respondedAt + j.graceWindow) {
      reasons.push({ kind: 'responded_within_grace', detail: `job ${j.id} is Responded, grace ends ${j.respondedAt + j.graceWindow}`, until: j.respondedAt + j.graceWindow + 1 })
    }
  }
  return reasons
}

/**
 * Busy = pending nonce on either wallet, or a (non-pool) job of ours Accepted within its deadline, or Responded within grace.
 * Pool stock (see src/lib/pool.ts) never counts.
 */
export async function busyStatus(s: Snapshot) {
  const c = ctx()
  const reasons: BusyReason[] = []
  for (const who of ['provider', 'buyer'] as const) {
    const address = c.accounts[who].address
    const [pending, latest] = await Promise.all([
      c.pub.getTransactionCount({ address, blockTag: 'pending' }),
      c.pub.getTransactionCount({ address, blockTag: 'latest' }),
    ])
    if (pending > latest) reasons.push({ kind: 'pending_nonce', detail: `${who} wallet has ${pending - latest} pending tx`, until: s.now + 5 })
  }
  reasons.push(...jobBusyReasons(s))
  const retryAt = reasons.length ? Math.max(...reasons.map((r) => r.until)) : null
  return { busy: reasons.length > 0, reasons, retryAt, retryInSeconds: retryAt === null ? null : Math.max(0, retryAt - s.now) }
}
