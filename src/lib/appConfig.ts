import { defineChain, formatUnits } from 'viem'
import type { Address } from 'viem'
import { buildAddressExplorerUrl, buildTxExplorerUrl, requireChain } from '@/onchain-facts'

/**
 * Everything chain-specific comes from here, and from the env behind it:
 * VITE_CHAIN_ID, VITE_REPLYBOND_ADDRESS, VITE_REPLYBOND_START_BLOCK. Testnet vs mainnet is a config change.
 */
const env = import.meta.env as Record<string, string | undefined>

export const CHAIN_ID = Number(env.VITE_CHAIN_ID?.trim() || 5042002)
const fact = requireChain(CHAIN_ID)

export const NETWORK_NAME = fact.name
export const IS_TESTNET = fact.isTestnet
export const NATIVE_DECIMALS = fact.nativeCurrency.decimals

export const appChain = defineChain({
  id: CHAIN_ID,
  name: fact.name,
  nativeCurrency: { name: fact.nativeCurrency.symbol, symbol: fact.nativeCurrency.symbol, decimals: fact.nativeCurrency.decimals },
  rpcUrls: { default: { http: fact.rpcUrls } },
  blockExplorers: { default: { name: 'Arc Explorer', url: fact.explorerBase } },
})

const rawContract = env.VITE_REPLYBOND_ADDRESS?.trim()
export const CONTRACT: Address | null = rawContract && /^0x[0-9a-fA-F]{40}$/.test(rawContract) ? (rawContract as Address) : null
export const START_BLOCK = env.VITE_REPLYBOND_START_BLOCK?.trim() ? BigInt(env.VITE_REPLYBOND_START_BLOCK.trim()) : 0n

export const STUDIO_PROJECT_URL =
  env.VITE_STUDIO_PROJECT_URL?.trim() || 'https://studio.arc.io/app/aaea9afa-1278-4d24-8918-87e8ba733ca4'

export const txUrl = (hash: string) => buildTxExplorerUrl(CHAIN_ID, hash)
export const addressUrl = (address: string) => buildAddressExplorerUrl(CHAIN_ID, address)

/** Native-view USDC amount (gas decimals) as "0.010": at least 3 fraction digits, trailing zeros trimmed beyond that. */
export function fmtUsdc(raw: bigint): string {
  const [whole, frac = ''] = formatUnits(raw, NATIVE_DECIMALS).split('.')
  let f = frac.replace(/0+$/, '')
  while (f.length < 3) f += '0'
  return `${whole}.${f}`
}

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`
export const padId = (id: bigint | string) => String(id).padStart(4, '0')
