// Pure parts of the landing page: the replay timeline, captions, the endings strip, the receipts band and the FAQ.
// Nothing here reads the environment, so every figure is a function of its arguments and can be tested.
import { MAINNET_PROOF, TEST_COUNTS } from './proof'
import { BOND, DEMO_OFFER_LIMITS, GRACE_WINDOW_S, MIN_WALLET_BALANCE_NATIVE, PRICE } from './terms'

export const REPLAY_SPEED = 15
/** The replay starts at most this long after the card is ready. */
export const REPLAY_START_DELAY_MS = 300
export const TAPE_FIRST_MS = 520
export const TAPE_STEP_MS = 380
export const TAPE_LINE_COUNT = 3

/** "0x7312e5db…3a77": the transaction hash as the receipt tape shows it. */
export const shortTx = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "00:45" style clock for the seconds left (rounded up, so it shows 00:00 only when the time is out). */
export function clockText(left: number): string {
  const s = Math.max(0, Math.ceil(left))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}

/** How long the sped-up clock runs, in ms. */
export const clockRunMs = (windowS: number, speed = REPLAY_SPEED) => (windowS / speed) * 1000

export interface ReplayState {
  /** The replay has begun (false while the card waits for its start). */
  started: boolean
  left: number
  clock: string
  /** 1 at the start, 0 when the clock is out. */
  barScale: number
  /** The clock is out: the stamp, the stub tear, the split line and the tape belong to this phase. */
  done: boolean
  stamp: boolean
  /** How many tape lines are typed so far (0 to 3). */
  tapeLines: number
}

/** The whole replay as a function of the elapsed time. A negative time means "not started yet". */
export function replayState(elapsedMs: number, windowS: number, speed = REPLAY_SPEED): ReplayState {
  if (elapsedMs < 0) return { started: false, left: windowS, clock: clockText(windowS), barScale: 1, done: false, stamp: false, tapeLines: 0 }
  const left = Math.max(0, windowS - (elapsedMs / 1000) * speed)
  const done = left <= 0
  const since = done ? elapsedMs - clockRunMs(windowS, speed) : 0
  let tapeLines = 0
  if (done) for (let i = 0; i < TAPE_LINE_COUNT; i++) if (since >= TAPE_FIRST_MS + i * TAPE_STEP_MS) tapeLines = i + 1
  return { started: true, left, clock: clockText(left), barScale: windowS > 0 ? left / windowS : 0, done, stamp: done, tapeLines }
}

/** The state to show at once: reduced motion, or a settlement that is already final. */
export const finalReplayState = (windowS: number): ReplayState => replayState(Number.POSITIVE_INFINITY, windowS)

/** The elapsed time at which the whole replay, tape included, is finished. */
export const replayEndMs = (windowS: number, speed = REPLAY_SPEED) => clockRunMs(windowS, speed) + TAPE_FIRST_MS + (TAPE_LINE_COUNT - 1) * TAPE_STEP_MS

/** The red stamp (and the stub tear) happen only for a timeout whose payout classifyReceipt confirmed as PAID. */
export const shouldStamp = (c: { kind: string; event: string | null } | undefined | null): boolean => !!c && c.kind === 'PAID' && c.event === 'JobTimedOut'

export type ReplayMode = 'replay' | 'live'

export const chipText = (mode: ReplayMode, speed = REPLAY_SPEED) => (mode === 'replay' ? `Replay · sped up ×${speed}` : 'Your settlement · live')

/** The line under the card: it says what the viewer is looking at, including the speed-up on a replay. */
export function replayCaption(o: { mode: ReplayMode; jobId: string; windowS: number; network: string; speed?: number }): string {
  if (o.mode === 'live') return `Your settlement, sent live on ${o.network}. Settle sends another.`
  return `Replay of job ${Number(o.jobId)}, a real timeout settled on ${o.network}, sped up ×${o.speed ?? REPLAY_SPEED} (the real window is ${o.windowS} s). Settle sends a new one.`
}

export interface TapeLine {
  kind: 'call' | 'transfer' | 'tx'
  text: string
  /** "status 1" after the call line. */
  status?: string
  hash?: string
  /** The shortened hash shown as the explorer link text. */
  hashShort?: string
}

/** The three receipt lines typed under the card, from the settled job. */
export function tapeFor(o: { jobId: string | number; amount: string; payeeShort: string; hash: string; hashShort: string }): TapeLine[] {
  return [
    { kind: 'call', text: `timeout(${Number(o.jobId)})`, status: 'status 1' },
    { kind: 'transfer', text: `Transfer +${o.amount} USDC → buyer ${o.payeeShort}` },
    { kind: 'tx', text: 'tx', hash: o.hash, hashShort: o.hashShort },
  ]
}

export interface Ending {
  key: 'acknowledge' | 'timeout' | 'claim'
  jobId: number
  text: string
  /** A round ink postmark for the two provider-paid endings, the red stamp for the timeout only. */
  mark: 'postmark' | 'stamp'
  markLines: [string, string]
}

/** The three endings of the proof run (jobs 5, 6 and 7), from MAINNET_PROOF and the job terms. */
export function endingsStrip(fmt: (raw: bigint) => string, windowS: number): Ending[] {
  const total = fmt(PRICE + BOND)
  const j = MAINNET_PROOF.jobs
  return [
    { key: 'acknowledge', jobId: j.acknowledge, text: `Answered in time; the buyer acknowledged. Provider +${total}.`, mark: 'postmark', markLines: ['PAID', 'ON TIME'] },
    { key: 'timeout', jobId: j.timeout, text: `No answer inside ${windowS} s. Buyer +${total}.`, mark: 'stamp', markLines: ['Indemnity paid', `+${total} USDC`] },
    { key: 'claim', jobId: j.claim, text: `Answered; the buyer stayed silent past the grace. Provider claimed +${total}.`, mark: 'postmark', markLines: ['PAID ·', 'BUYER SILENT'] },
  ]
}

export interface ReceiptStat {
  /** The number the count-up ends on, and how many decimals it shows. */
  value: number
  decimals: number
  label: string
  source: string
  red?: boolean
}

/** The four receipts: every number is read from the job terms, the proof config or the test counts. */
export function receiptStats(fmt: (raw: bigint) => string): ReceiptStat[] {
  const total = fmt(PRICE + BOND)
  const inv = TEST_COUNTS.invariants
  return [
    { value: Number(total), decimals: total.split('.')[1]?.length ?? 0, label: 'USDC back to the buyer per missed deadline', source: 'src/lib/terms.ts · price + bond', red: true },
    { value: Object.keys(MAINNET_PROOF.txs).length, decimals: 0, label: 'mainnet transactions, every one status 1', source: 'src/lib/proof.ts' },
    { value: TEST_COUNTS.forge, decimals: 0, label: `forge tests pass, including ${inv.count} invariants (each ${inv.runs} runs, ${inv.calls.toLocaleString('en-US')} calls)`, source: 'README · Tests' },
    { value: TEST_COUNTS.bun, decimals: 0, label: `bun tests across ${TEST_COUNTS.bunFiles} files`, source: 'README · Tests' },
  ]
}

/** The three lines of the "Honest by design" band, copied from the README's Honest limits. */
export const HONEST_QUOTES = [
  'The contract proves the output was delivered onchain on time. It does not prove the output is correct.',
  'The demo provider answers only while some request runs the sweep.',
  'The proof is about timing and payment, not about useful answers.',
] as const

export interface FaqCtx {
  network: string
  chainId: number
  isMainnet: boolean
  fmt: (raw: bigint) => string
  windowS: number
}

export interface FaqItem {
  q: string
  a: string
}

/** The six questions, with every figure taken from the terms, the limits and the configured chain. */
export function faqItems(c: FaqCtx): FaqItem[] {
  const lim = DEMO_OFFER_LIMITS
  return [
    {
      q: 'Is this real money?',
      a: c.isMainnet
        ? `Yes. ${c.network} (chain ${c.chainId}), native USDC, at demo sizes: ${c.fmt(PRICE)} price and ${c.fmt(BOND)} bond. The contract is a Sourcify exact match.`
        : `This deployment runs on ${c.network} (chain ${c.chainId}) with test funds, at demo sizes: ${c.fmt(PRICE)} price and ${c.fmt(BOND)} bond.`,
    },
    { q: `Who receives the ${c.fmt(PRICE + BOND)} when I press Settle?`, a: 'Our demo-buyer address, not you. In the app you can call the API from your own wallet instead.' },
    { q: 'Does it prove the answer is right?', a: 'No. It proves delivery on time, not correctness. The demo provider is an echo service.' },
    { q: 'What if the buyer never acknowledges?', a: `After the ${GRACE_WINDOW_S} s grace window anyone can call claim, and the provider gets price + bond.${c.isMainnet ? ' That path is in the ledger above.' : ''}` },
    { q: 'What stops the demo being drained?', a: `${lim.hour} new offers per hour and ${lim.day} per day across all visitors, and runs pause below ${c.fmt(MIN_WALLET_BALANCE_NATIVE)} USDC per wallet.` },
    { q: 'What did Arc Studio build?', a: `The contract, its tests, the API routes, this page and the app, one Studio turn at a time.${c.isMainnet ? ' Only the mainnet deploy ran outside Studio.' : ''}` },
  ]
}
