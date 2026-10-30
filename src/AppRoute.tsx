import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { Toaster } from 'sonner'
import { WagmiProvider } from 'wagmi'
import App from './App'
import { config } from './config'

const queryClient = new QueryClient()

/** `/app`: the whole app with its wallet providers. Loaded on demand, so the landing page does not carry any of it. */
export default function AppRoute() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider>
          <App />
          <Toaster position="top-center" />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
