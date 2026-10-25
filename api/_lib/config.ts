import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseGwei } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { GRACE_WINDOW_S, POOL_GRACE_WINDOW_S, RESPONSE_WINDOW_S } from '../../src/lib/terms.js'
import { requireChain } from '../../src/onchain-facts.js'
import { HttpError } from './http.js'

// Testnet deployment of ReplyBond, used only when REPLYBOND_ADDRESS is unset, and its deployment block.
// arc-studio-allow-onchain-literal
const DEFAULT_REPLYBOND = '0x1234fb0fb613d284d98bbe2ff89045aae5d22458'
const DEFAULT_START_BLOCK = 68986043n
const DEFAULT_CHAIN_ID = 5042002 // Arc Testnet: the current config

export const MIN_MAX_FEE = parseGwei('20')
export { BOND, PRICE } from '../../src/lib/terms.js'
export const RESPONSE_WINDOW = BigInt(RESPONSE_WINDOW_S)
export const GRACE_WINDOW = BigInt(GRACE_WINDOW_S)
export const POOL_GRACE_WINDOW = BigInt(POOL_GRACE_WINDOW_S)
export const LIMITS = { hour: 30, day: 150 } as const
export const OPEN_OFFER_MAX_AGE_S = 600
export const POOL_TARGET = 3

function envKey(name: string): Hex {
  const raw = process.env[name]?.trim()
  if (!raw) throw new HttpError(500, `${name} is not set in the environment`)
  const k = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new HttpError(500, `${name} is not a valid 32-byte hex private key`)
  return k as Hex
}

const isProduction = () => process.env.VERCEL_ENV === 'production'

/** Shared config (VITE_*). Production must set it explicitly; elsewhere the testnet defaults apply. */
function sharedEnv(name: string): string | undefined {
  const v = process.env[name]?.trim()
  if (!v && isProduction()) throw new HttpError(500, `${name} is not set (required when VERCEL_ENV is production)`)
  return v || undefined
}

/** The chain comes from config (VITE_CHAIN_ID, shared with the page), described by the onchain-facts registry. */
function resolveChain() {
  const id = Number(sharedEnv('VITE_CHAIN_ID') || DEFAULT_CHAIN_ID)
  const fact = requireChain(id)
  return defineChain({
    id,
    name: fact.name,
    nativeCurrency: { name: fact.nativeCurrency.symbol, symbol: fact.nativeCurrency.symbol, decimals: fact.nativeCurrency.decimals },
    rpcUrls: { default: { http: fact.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: fact.explorerBase } },
  })
}

/**
 * RPC_URL wins. Otherwise the sandbox RPC proxy, only when RPC_PROXY_BASE_URL is set (the Arc Studio preview).
 * In production there is no further fallback: a missing RPC_URL is a clear 500, never a default endpoint.
 * Outside production (local dev) the registry's public endpoint is used.
 */
function resolveRpcUrl(chain: ReturnType<typeof resolveChain>): string {
  const explicit = process.env.RPC_URL?.trim()
  if (explicit) return explicit
  const base = process.env.RPC_PROXY_BASE_URL?.trim()
  if (base) {
    const proxyKey = requireChain(chain.id).name.replace(/\s+/g, '_')
    if ((process.env.RPC_PROXY_CHAINS || '').split(',').indexOf(proxyKey) !== -1) {
      return `${base}/api/rpc/${proxyKey}?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`
    }
  }
  if (isProduction()) throw new HttpError(500, 'RPC_URL is not set (required when VERCEL_ENV is production)')
  return chain.rpcUrls.default.http[0]
}

function build() {
  const provider = privateKeyToAccount(envKey('PROVIDER_KEY'))
  const buyer = privateKeyToAccount(envKey('DEMO_BUYER_KEY'))
  const rawAddr = process.env.REPLYBOND_ADDRESS?.trim() || sharedEnv('VITE_REPLYBOND_ADDRESS') || DEFAULT_REPLYBOND
  if (!isAddress(rawAddr)) throw new HttpError(500, 'REPLYBOND_ADDRESS is not a valid address')
  const replyBond = getAddress(rawAddr)
  const chain = resolveChain()
  const transport = http(resolveRpcUrl(chain))
  const startEnv = process.env.REPLYBOND_START_BLOCK?.trim() || sharedEnv('VITE_REPLYBOND_START_BLOCK')
  const startBlock = startEnv
    ? BigInt(startEnv)
    : replyBond.toLowerCase() === DEFAULT_REPLYBOND
      ? DEFAULT_START_BLOCK
      : 0n
  return {
    chain,
    replyBond,
    startBlock,
    providerAddress: provider.address,
    demoBuyerAddress: buyer.address,
    accounts: { provider, buyer },
    pub: createPublicClient({ chain, transport, pollingInterval: 500 }),
    wallets: {
      provider: createWalletClient({ account: provider, chain, transport }),
      buyer: createWalletClient({ account: buyer, chain, transport }),
    },
  }
}

let cached: ReturnType<typeof build> | undefined

/** Lazily built from the environment; PROVIDER_ADDRESS and DEMO_BUYER_ADDRESS are derived from the keys. */
export function ctx() {
  cached ??= build()
  return cached
}

export const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
