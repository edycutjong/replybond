import { createPublicClient, http, parseEventLogs } from 'viem'
import type { Address, Hex, TransactionReceipt } from 'viem'
import { replyBondAbi, Status } from './abi'
import { appChain, CONTRACT, START_BLOCK } from './appConfig'
import { classifyReceipt } from './classifyReceipt'
import type { Classification } from './classifyReceipt'
import type { ReceiptSummary } from './api'

export const publicClient = createPublicClient({ chain: appChain, transport: http(appChain.rpcUrls.default.http[0], { batch: { wait: 20 }, retryCount: 5, retryDelay: 300 }), pollingInterval: 500 })

export interface JobView {
  id: bigint
  provider: Address
  designated: Address
  buyer: Address // the acceptor once Accepted, else the designated buyer
  requestHash: Hex
  price: bigint
  bond: bigint
  responseWindow: number
  graceWindow: number
  status: number
  postedAt: number
  deadline: number
  respondedAt: number
  responseHash: Hex | null
  output: string | null
  txs: { posted?: Hex; accepted?: Hex; responded?: Hex; settled?: Hex }
}

type Parsed = ReturnType<typeof parseEventLogs<typeof replyBondAbi>>[number]

const RANGE_ERR = /range|limit|too many|exceed|response size|more than|too large|timeout/i

async function getLogsChunked(from: bigint, to: bigint, depth = 0): Promise<Parsed[]> {
  if (!CONTRACT) return []
  try {
    const raw = await publicClient.getLogs({ address: CONTRACT, fromBlock: from, toBlock: to })
    return parseEventLogs({ abi: replyBondAbi, logs: raw })
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (from >= to || depth >= 6 || !RANGE_ERR.test(msg)) throw err
    const mid = from + (to - from) / 2n
    return [...(await getLogsChunked(from, mid, depth + 1)), ...(await getLogsChunked(mid + 1n, to, depth + 1))]
  }
}

/** Start of a ~25h scan, measured from recent block spacing and never before the deployment block. */
async function scanFrom(head: bigint, headTs: number): Promise<bigint> {
  const span = head > 20_000n ? 20_000n : head > 1n ? head - 1n : 0n
  let secPerBlock = 0.5
  if (span > 0n) {
    const sample = await publicClient.getBlock({ blockNumber: head - span })
    const measured = (headTs - Number(sample.timestamp)) / Number(span)
    if (measured > 0.01) secPerBlock = measured
  }
  const lookback = BigInt(Math.ceil((86_400 * 1.15) / secPerBlock)) + 2_000n
  const from = head > lookback ? head - lookback : 0n
  return from > START_BLOCK ? from : START_BLOCK
}

// Incremental cache: the first load scans the window, later polls only fetch new blocks.
let cache: { from: bigint; scanned: bigint; logs: Parsed[] } | null = null
const stampCache = new Map<bigint, number>()

async function tsOf(l: Parsed): Promise<number> {
  const inline = (l as { blockTimestamp?: bigint | string | null }).blockTimestamp
  if (inline !== undefined && inline !== null) return Number(inline)
  const hit = stampCache.get(l.blockNumber)
  if (hit !== undefined) return hit
  const t = Number((await publicClient.getBlock({ blockNumber: l.blockNumber })).timestamp)
  stampCache.set(l.blockNumber, t)
  return t
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
function decodeOutput(hex: Hex): string {
  try {
    const bytes = Uint8Array.from(hex.slice(2).match(/.{2}/g) ?? [], (b) => parseInt(b, 16))
    return utf8.decode(bytes)
  } catch {
    return hex
  }
}

async function reduce(logs: Parsed[]): Promise<JobView[]> {
  const byId = new Map<bigint, JobView>()
  for (const l of logs) {
    const tx = l.transactionHash
    switch (l.eventName) {
      case 'OfferPosted':
        byId.set(l.args.id, {
          id: l.args.id,
          provider: l.args.provider,
          designated: l.args.buyer,
          buyer: l.args.buyer,
          requestHash: l.args.requestHash,
          price: l.args.price,
          bond: l.args.bond,
          responseWindow: Number(l.args.responseWindow),
          graceWindow: Number(l.args.graceWindow),
          status: Status.Open,
          postedAt: await tsOf(l),
          deadline: 0,
          respondedAt: 0,
          responseHash: null,
          output: null,
          txs: { posted: tx },
        })
        break
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
        Object.assign(j, { status: Status.Responded, respondedAt: Number(l.args.respondedAt), responseHash: l.args.responseHash, output: decodeOutput(l.args.output) })
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
  return [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : -1)) // newest first
}

export async function loadJobs(): Promise<{ jobs: JobView[]; now: number; head: bigint }> {
  const latest = await publicClient.getBlock()
  const head = latest.number
  const now = Number(latest.timestamp)
  if (!cache) cache = { from: await scanFrom(head, now), scanned: -1n, logs: [] }
  const start = cache.scanned < 0n ? cache.from : cache.scanned + 1n
  if (start <= head) {
    const fresh = await getLogsChunked(start, head)
    cache = { ...cache, scanned: head, logs: [...cache.logs, ...fresh] }
  }
  return { jobs: await reduce(cache.logs), now, head }
}

const receipts = new Map<string, Promise<TransactionReceipt | null>>()

/** Receipts are immutable once mined, so they are cached; a receipt not yet visible is retried briefly. */
let inflight = 0
const waiting: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (inflight >= 4) await new Promise<void>((r) => waiting.push(r))
  inflight++
  try {
    return await fn()
  } finally {
    inflight--
    waiting.shift()?.()
  }
}

export function getReceipt(hash: Hex): Promise<TransactionReceipt | null> {
  let p = receipts.get(hash)
  if (!p) {
    p = (async () => {
      for (let i = 0; i < 6; i++) {
        try {
          return await slot(() => publicClient.getTransactionReceipt({ hash }))
        } catch {
          await new Promise((r) => setTimeout(r, 700 * (i + 1)))
        }
      }
      return null
    })()
    receipts.set(hash, p)
    void p.then((r) => {
      if (!r) receipts.delete(hash)
    })
  }
  return p
}

export interface Settlement {
  jobId: bigint | null
  txHash: Hex
  classification: Classification
  blockTime: number | null
  /** The receipt could not be fetched (RPC trouble): not a verdict, so callers retry instead of showing UNREADABLE. */
  unavailable?: boolean
}

/** Fetches the settle receipt from the chain and classifies it with the shared function. */
export async function resolveSettlement(txHash: Hex): Promise<Settlement> {
  const receipt = await getReceipt(txHash)
  const classification = CONTRACT ? classifyReceipt(receipt, CONTRACT) : classifyReceipt(null, '0x0000000000000000000000000000000000000000')
  // Arc receipts carry the block timestamp on each log; only fall back to a block read for a postmark time.
  const inline = (receipt?.logs[0] as { blockTimestamp?: bigint | string | null } | undefined)?.blockTimestamp
  let blockTime: number | null = inline !== undefined && inline !== null ? Number(inline) : null
  if (blockTime === null && receipt && classification.event === 'JobPaid') {
    try {
      blockTime = Number((await slot(() => publicClient.getBlock({ blockNumber: receipt.blockNumber }))).timestamp)
    } catch {
      blockTime = null
    }
  }
  return { jobId: classification.jobId, txHash, classification, blockTime, unavailable: receipt === null }
}

/**
 * Classifies the receipt that /api/settle (or /api/demo-run) returned, with the same shared function, so the stamp or
 * postmark does not depend on the browser's own RPC being reachable at that moment.
 */
export async function settlementFromSummary(s: ReceiptSummary): Promise<Settlement> {
  const classification = CONTRACT ? classifyReceipt({ status: s.status, logs: s.logs }, CONTRACT) : classifyReceipt(null, '0x0000000000000000000000000000000000000000')
  let blockTime: number | null = null
  try {
    blockTime = Number((await slot(() => publicClient.getBlock({ blockNumber: BigInt(s.blockNumber) }))).timestamp)
  } catch {
    blockTime = null // the time on the postmark is optional
  }
  return { jobId: classification.jobId, txHash: s.txHash, classification, blockTime }
}

export async function readJobTerms(id: bigint): Promise<{ price: bigint; bond: bigint } | null> {
  if (!CONTRACT) return null
  try {
    const j = await publicClient.readContract({ address: CONTRACT, abi: replyBondAbi, functionName: 'getJob', args: [id] })
    return { price: j.price, bond: j.bond }
  } catch {
    return null
  }
}

/** The output the provider committed for a job, read from its ResponseCommitted event. */
export async function readCommittedOutput(id: bigint, fromBlock: bigint): Promise<{ output: string; txHash: Hex } | null> {
  if (!CONTRACT) return null
  const raw = await publicClient.getLogs({
    address: CONTRACT,
    event: replyBondAbi.find((x) => x.type === 'event' && x.name === 'ResponseCommitted') as never,
    args: { id } as never,
    fromBlock,
    toBlock: 'latest',
  })
  const hit = parseEventLogs({ abi: replyBondAbi, logs: raw, eventName: 'ResponseCommitted' })[0]
  return hit ? { output: decodeOutput(hit.args.output), txHash: hit.transactionHash } : null
}
