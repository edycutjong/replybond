// Pure config helpers (no env access), so they can be tested for every chain.

/**
 * The settled timeout pinned in the hero when the scanned window holds none. VITE_PROOF_TIMEOUT_TX wins when it is a
 * transaction hash; otherwise only Arc mainnet (5042) has a default, the timeout of job 6. Any other chain: null.
 */
// arc-studio-allow-onchain-literal
export const MAINNET_PROOF_TIMEOUT_TX = '0x7312e5db712a360e5b582e0f0afa0a9b96e4ce228d89036d6fcd5aae26783a77'

export function proofTimeoutTx(chainId: number, configured: string | undefined): `0x${string}` | null {
  const raw = configured?.trim()
  if (raw && /^0x[0-9a-fA-F]{64}$/.test(raw)) return raw as `0x${string}`
  return chainId === 5042 ? MAINNET_PROOF_TIMEOUT_TX : null
}

/** "Arc mainnet" / "Arc testnet" for the two Arc chains; any other chain keeps its registry name (plus "testnet" if it lacks one). */
export function networkLabel(chainId: number, registryName: string, isTestnet: boolean): string {
  if (chainId === 5042) return 'Arc mainnet'
  if (chainId === 5042002) return 'Arc testnet'
  return isTestnet && !/test/i.test(registryName) ? `${registryName} testnet` : registryName
}
