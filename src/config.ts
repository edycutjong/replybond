/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { appChain } from './lib/appConfig'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(appChain.id, appChain.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [appChain, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [appChain.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
