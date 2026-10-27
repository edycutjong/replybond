// Imported first by every api test: throwaway keys, the testnet chain id, no production flag. Nothing here touches the network.
import { privateKeyToAccount } from 'viem/accounts'

export const PROVIDER_KEY = `0x${'11'.repeat(32)}` as const
export const DEMO_BUYER_KEY = `0x${'22'.repeat(32)}` as const
process.env.PROVIDER_KEY = PROVIDER_KEY
process.env.DEMO_BUYER_KEY = DEMO_BUYER_KEY
process.env.VITE_CHAIN_ID = '5042002'
delete process.env.VERCEL_ENV
delete process.env.RPC_URL
delete process.env.CRON_SECRET

export const providerAddress = privateKeyToAccount(PROVIDER_KEY).address
export const demoBuyerAddress = privateKeyToAccount(DEMO_BUYER_KEY).address
export const otherAddress = privateKeyToAccount(`0x${'33'.repeat(32)}`).address
