// Pure config helpers (no env access), so they can be tested for every chain.

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
