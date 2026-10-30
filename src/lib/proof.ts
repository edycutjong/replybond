// Pure config helpers (no env access), so they can be tested for every chain.
import { BOND, PRICE } from './terms'

/**
 * The verified Arc mainnet deployment and its proof transactions: the only place these values live. The landing page links to
 * them (shown when the configured chain is Arc mainnet, 5042) and the hero falls back to the timeout when the scanned
 * window holds none. Nothing else on the page is typed in.
 */
// arc-studio-allow-onchain-literal
export const MAINNET_PROOF = {
  chainId: 5042,
  contract: '0x2a0f4aeF8E5379d8E4606F40846cf97716fe749f',
  txs: {
    postOffer: '0xaf44d46742f2450b970cee9be66f67a17bcec622f7397a381a4420d362bb9911',
    acceptOffer: '0xd36045c287853e39482c4a81cabbe1698ce93aede9201aaeb61feb41fb81f51d',
    respond: '0xc41b409017c57c5e1d84ff8a4b382170a536eedd0b2284380f5bb2e308e71093',
    acknowledge: '0xce43ecd7b5470259caf9658accb7197ecd1707a9b24584a978f0e8b3477de338',
    timeout: '0x7312e5db712a360e5b582e0f0afa0a9b96e4ce228d89036d6fcd5aae26783a77',
    claim: '0x2c008eb8e69a417b781d6da6065b2b98d87cb40d2cfd6b950db0fe1a3fe2de6f',
  },
  /** The job each ending belongs to (verified onchain): acknowledge pays the provider, timeout pays the buyer, claim pays the provider. */
  jobs: { acknowledge: 5, timeout: 6, claim: 7 },
  /** How the timeout's payee reads in the receipt tape (the buyer of job 6), shortened for display. */
  timeoutPayeeShort: '0xbD95…C8D2',
} as const

/** The settled timeout (job 6) used as the hero's "On record" fallback on Arc mainnet. */
export const MAINNET_PROOF_TIMEOUT_TX = MAINNET_PROOF.txs.timeout

/** Sourcify's lookup page for a contract; the mainnet deployment is an exact match there. */
export const sourcifyUrl = (address: string) => `https://sourcify.dev/#/lookup/${address}`

/**
 * The settled timeout pinned in the hero when the scanned window holds none. VITE_PROOF_TIMEOUT_TX wins when it is a
 * transaction hash; otherwise only Arc mainnet (5042) has a default. Any other chain: null.
 */
export function proofTimeoutTx(chainId: number, configured: string | undefined): `0x${string}` | null {
  const raw = configured?.trim()
  if (raw && /^0x[0-9a-fA-F]{64}$/.test(raw)) return raw as `0x${string}`
  return chainId === MAINNET_PROOF.chainId ? MAINNET_PROOF_TIMEOUT_TX : null
}

/** "Arc mainnet" / "Arc testnet" for the two Arc chains; any other chain keeps its registry name (plus "testnet" if it lacks one). */
export function networkLabel(chainId: number, registryName: string, isTestnet: boolean): string {
  if (chainId === 5042) return 'Arc mainnet'
  if (chainId === 5042002) return 'Arc testnet'
  return isTestnet && !/test/i.test(registryName) ? `${registryName} testnet` : registryName
}

export interface ProofStep {
  name: keyof typeof MAINNET_PROOF.txs
  hash: string
  /** What the transaction did, with every figure taken from the job terms. */
  result: string
}

/** The mainnet proof transactions in order, each with its result. `fmt` formats a native-USDC amount. */
export function proofSteps(fmt: (raw: bigint) => string): ProofStep[] {
  const total = fmt(PRICE + BOND)
  const t = MAINNET_PROOF.txs
  return [
    { name: 'postOffer', hash: t.postOffer, result: `provider posts a ${fmt(BOND)} bond` },
    { name: 'acceptOffer', hash: t.acceptOffer, result: `buyer pays ${fmt(PRICE)}` },
    { name: 'respond', hash: t.respond, result: 'answer written onchain' },
    { name: 'acknowledge', hash: t.acknowledge, result: `provider paid ${total}` },
    { name: 'timeout', hash: t.timeout, result: `buyer +${total}` },
    { name: 'claim', hash: t.claim, result: `provider +${total}, buyer silent` },
  ]
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/**
 * The caption under the landing hero card. When the card is the pinned proof settlement it says so (with its job id);
 * otherwise it says the card is the latest live run and, on Arc mainnet, where the fixed proof set is.
 */
export function heroCaption(o: { shownTx: string | null; pinnedTx: string | null; jobId: string | null; proofCount: number | null }): string | null {
  if (!o.shownTx) return null
  if (o.pinnedTx && o.shownTx.toLowerCase() === o.pinnedTx.toLowerCase()) {
    return o.jobId ? `This is the pinned proof settlement (job ${Number(o.jobId)}).` : 'This is the pinned proof settlement.'
  }
  if (o.proofCount === null) return 'Latest live run shown above.'
  const n = o.proofCount <= 10 ? WORDS[o.proofCount] : String(o.proofCount)
  return `Latest live run shown above. The fixed ${n}-transaction proof set is further down.`
}

/** The repository the landing page links to. */
export const REPO_URL = 'https://github.com/edycutjong/replybond'

/**
 * Test counts shown on the landing page and in the README Tests line (a test fails if they drift apart).
 * forge: what `forge test` prints (63 unit and fuzz tests plus 3 invariant tests); each invariant test runs `runs` times with `calls` calls.
 */
export const TEST_COUNTS = {
  forge: 66,
  bun: 112,
  bunFiles: 15,
  invariants: { count: 3, runs: 256, calls: 128_000 },
} as const

/** Selected Studio turns shown on the landing page, oldest first (the full table is in the README). */
export const STUDIO_TURNS = [
  { tag: 'TURN', no: '1', title: 'The contract', blurb: 'ReplyBond, its Foundry tests and a testnet deploy.', commit: 'cd3e816' },
  { tag: 'TURN', no: '3', title: 'A live timeout', blurb: 'Testnet timeout and claim, with the Transfer logs confirmed.', commit: 'c96cc0f' },
  { tag: 'TURN', no: '4', title: 'The app', blurb: 'Sweep on load, settle-now, the job table, receipt checks.', commit: '6b1be61' },
  { tag: 'FIX', no: '4.2', title: 'The stamp', blurb: 'The counterfoil and the INDEMNITY PAID stamp.', commit: '9417730' },
  { tag: 'TURN', no: '5A', title: 'Mainnet-ready', blurb: 'Rate limits, a wallet floor, idempotent sends.', commit: 'd973d46' },
] as const
