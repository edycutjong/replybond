import { defineChain, formatUnits, isAddress } from 'viem'
import type { Address } from 'viem'
import { buildAddressExplorerUrl, buildTxExplorerUrl, requireChain } from '@/onchain-facts'
import { networkLabel, proofTimeoutTx } from './proof'

/**
 * Everything chain-specific comes from here, and from the env behind it:
 * VITE_CHAIN_ID, VITE_REPLYBOND_ADDRESS, VITE_REPLYBOND_START_BLOCK. Testnet vs mainnet is a config change.
 */
const env = import.meta.env as Record<string, string | undefined>

export const CHAIN_ID = Number(env.VITE_CHAIN_ID?.trim() || 5042002)
const fact = requireChain(CHAIN_ID)

// Shown in the header, the hero label and every "Watch it on …" button; derived from the configured chain, never typed twice.
export const NETWORK_NAME = networkLabel(CHAIN_ID, fact.name, fact.isTestnet)
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

/** Page identity from config, so the page does not need the sweep to know whose jobs to show. Unset means null. */
const configuredAddress = (raw: string | undefined): Address | null => (raw?.trim() && isAddress(raw.trim()) ? (raw.trim() as Address) : null)
export const PROVIDER_ADDRESS = configuredAddress(env.VITE_PROVIDER_ADDRESS)
export const DEMO_BUYER_ADDRESS = configuredAddress(env.VITE_DEMO_BUYER_ADDRESS)

/** A real settled timeout pinned in the hero when the scanned window holds none (see proof.ts). */
export const PROOF_TIMEOUT_TX = proofTimeoutTx(CHAIN_ID, env.VITE_PROOF_TIMEOUT_TX)

/** The README section that lists the Studio turns one by one. */
export const TURNS_TABLE_URL = 'https://github.com/edycutjong/replybond#how-arc-studio-built-it'

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
