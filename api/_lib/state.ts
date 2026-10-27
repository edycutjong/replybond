import { parseEventLogs } from 'viem'
import type { Address, Hex } from 'viem'
import { replyBondAbi, Status } from '../../src/lib/abi.js'
import { LIMITS, MIN_WALLET_BALANCE, POOL_TARGET, ctx, sameAddr } from './config.js'
import type { Deps } from './deps.js'
import { isPoolStock } from '../../src/lib/pool.js'
import { orderLogs, pageLogs } from '../../src/lib/pageLogs.js'
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
interface EventCache {
  startedAt: number
  from: bigint
  scanned: bigint
  logs: ParsedLog[]
}

// Kept behind accessor functions on purpose: @vercel/nft statically evaluates module-level bindings, and a bare
// `let cache = null` made it fold `cache.scanned + 1n` into `undefined + 1n`, which throws inside the tracer.
const cacheBox: { current: EventCache | null } = { current: null }
const readCache = (): EventCache | null => cacheBox.current
const writeCache = (next: EventCache): void => {
  cacheBox.current = next
}
/** First block still to scan: the window start before the first scan, then the block after the last scanned one. */
function nextScanStart(cache: EventCache): bigint {
  return cache.scanned < 0n ? cache.from : cache.scanned + 1n
}

export async function loadSnapshot(): Promise<Snapshot> {
  const c = ctx()
  const latest = await c.pub.getBlock()
  const head = latest.number
  const now = Number(latest.timestamp)
  // Incremental event cache per instance (no reorgs on Arc): the first call scans the ~25h window, later calls only the new blocks.
  let cache = readCache()
  if (!cache || Date.now() - cache.startedAt > 60 * 60 * 1000) {
    cache = { startedAt: Date.now(), from: await scanFrom(head, now), scanned: -1n, logs: [] }
    writeCache(cache)
  }
  const fromBlock = cache.from
  const start = nextScanStart(cache)
  if (start <= head) {
    const raw = await pageLogs((from, to) => c.pub.getLogs({ address: c.replyBond, fromBlock: from, toBlock: to }), start, head)
    const fresh = parseEventLogs({ abi: replyBondAbi, logs: raw })
    cache = { ...cache, scanned: head, logs: [...cache.logs, ...fresh] }
    writeCache(cache)
  }
  const logs = orderLogs(cache.logs)

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

/**
 * Pool stock that is Accepted and past its deadline, oldest first. The daily cron times all of it out and posts
 * fresh stock, so no stock job ever ages out of the scan window.
 */
export function rotationCandidates(s: Snapshot): Job[] {
  const buyer = ctx().demoBuyerAddress
  return s.jobs
    .filter((j) => j.status === Status.Accepted && s.now > j.deadline && isPoolStock(j, buyer) && classify(j, 'silent').ok)
    .sort((a, b) => (a.deadline === b.deadline ? (a.id < b.id ? -1 : 1) : a.deadline - b.deadline))
}

/** Demo-buyer jobs of ours past their deadline that are not pool stock (e.g. a watch run nobody settled). Any fixture mode. */
export function orphanedExpired(s: Snapshot): Job[] {
  const buyer = ctx().demoBuyerAddress
  return s.jobs.filter((j) => j.status === Status.Accepted && s.now > j.deadline && sameAddr(j.buyer, buyer) && !isPoolStock(j, buyer) && classify(j).ok)
}

type PoolStatus = ReturnType<typeof poolStatus>

/** Body of POST /api/settle when nothing could be settled. An empty pool asks the page for a refill. */
export function emptySettleBody(pool: PoolStatus) {
  const empty = pool.size === 0
  return {
    settled: false,
    note: empty ? 'No pooled job is ready; the page will request a refill.' : `Next one ready in ${pool.nextReadyInSeconds ?? 0} s.`,
    refillSuggested: empty,
    nextReadyInSeconds: pool.nextReadyInSeconds,
  }
}

/** An Open normal offer of ours, designated to `buyer`, posted under five minutes ago: reused instead of posting again. */
export function reusableOffer(s: Snapshot, buyer: string): Job | undefined {
  return [...s.jobs]
    .reverse()
    .find((j) => j.status === Status.Open && sameAddr(j.designated, buyer) && classify(j, 'normal').ok && s.now - j.postedAt < 300)
}

export function floorOk(provider: bigint, buyer: bigint, min: bigint): boolean {
  return provider >= min && buyer >= min
}

export interface WalletFloor {
  ok: boolean
  provider: bigint
  buyer: bigint
}

/** Native balances of both demo wallets against the floor. */
export async function walletFloor(deps: Partial<Pick<Deps, 'pub' | 'accounts'>> = {}): Promise<WalletFloor> {
  const c = ctx()
  const pub = deps.pub ?? c.pub
  const accounts = deps.accounts ?? c.accounts
  const [provider, buyer] = await Promise.all([pub.getBalance({ address: accounts.provider.address }), pub.getBalance({ address: accounts.buyer.address })])
  return { ok: floorOk(provider, buyer, MIN_WALLET_BALANCE), provider, buyer }
}

/** HTTP 503 body used by every route that would spend from a low demo wallet. */
export const walletsLowBody = (f: Pick<WalletFloor, 'provider' | 'buyer'>) => ({
  error: 'wallets_low',
  message: 'The demo wallets are low on USDC. The proof transactions on this page stay verifiable on the explorer.',
  balances: { provider: f.provider, buyer: f.buyer },
})

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
