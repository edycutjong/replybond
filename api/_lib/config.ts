import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseEther, parseGwei } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { requireChain } from '../../src/onchain-facts.js'
import { HttpError } from './http.js'

// Testnet deployment of ReplyBond, used only when REPLYBOND_ADDRESS is unset, and its deployment block.
// arc-studio-allow-onchain-literal
const DEFAULT_REPLYBOND = '0x1234fb0fb613d284d98bbe2ff89045aae5d22458'
const DEFAULT_START_BLOCK = 68986043n

export const MIN_MAX_FEE = parseGwei('20')
export const PRICE = parseEther('0.01') // 18-decimal native USDC
export const BOND = parseEther('0.005')
export const RESPONSE_WINDOW = 45n
export const GRACE_WINDOW = 120n
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

/** RPC_URL wins; else the environment's RPC proxy when it covers Arc Testnet; else the registry default. */
function resolveRpcUrl(): string {
  const explicit = process.env.RPC_URL?.trim()
  if (explicit) return explicit
  const base = process.env.RPC_PROXY_BASE_URL
  const chains = (process.env.RPC_PROXY_CHAINS || '').split(',')
  if (base && chains.indexOf('Arc_Testnet') !== -1) {
    return `${base}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`
  }
  return requireChain(arcTestnet.id).rpcUrls[0]
}

function build() {
  const provider = privateKeyToAccount(envKey('PROVIDER_KEY'))
  const buyer = privateKeyToAccount(envKey('DEMO_BUYER_KEY'))
  const rawAddr = process.env.REPLYBOND_ADDRESS?.trim() || DEFAULT_REPLYBOND
  if (!isAddress(rawAddr)) throw new HttpError(500, 'REPLYBOND_ADDRESS is not a valid address')
  const replyBond = getAddress(rawAddr)
  const transport = http(resolveRpcUrl())
  const startEnv = process.env.REPLYBOND_START_BLOCK?.trim()
  const startBlock = startEnv
    ? BigInt(startEnv)
    : replyBond.toLowerCase() === DEFAULT_REPLYBOND
      ? DEFAULT_START_BLOCK
      : 0n
  return {
    replyBond,
    startBlock,
    providerAddress: provider.address,
    demoBuyerAddress: buyer.address,
    accounts: { provider, buyer },
    pub: createPublicClient({ chain: arcTestnet, transport, pollingInterval: 500 }),
    wallets: {
      provider: createWalletClient({ account: provider, chain: arcTestnet, transport }),
      buyer: createWalletClient({ account: buyer, chain: arcTestnet, transport }),
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
