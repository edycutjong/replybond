import { useCallback } from 'react'
import type { Hex } from 'viem'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import { replyBondAbi } from '@/lib/abi'
import { CHAIN_ID, CONTRACT } from '@/lib/appConfig'
import { publicClient, resolveSettlement } from '@/lib/chainReads'
import type { Settlement } from '@/lib/chainReads'
import { PRICE } from '@/lib/terms'

/** Transactions signed by the connected wallet: always on the configured chain, always waited for. */
export function useWalletActions() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const send = useCallback(
    async (functionName: 'acceptOffer' | 'acknowledge' | 'timeout', jobId: bigint, value?: bigint): Promise<Hex> => {
      if (!CONTRACT) throw new Error('contract address is not configured')
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
      const hash =
        functionName === 'acceptOffer'
          ? await writeContractAsync({ address: CONTRACT, abi: replyBondAbi, functionName, args: [jobId], value: value ?? PRICE, chainId: CHAIN_ID })
          : await writeContractAsync({ address: CONTRACT, abi: replyBondAbi, functionName, args: [jobId], chainId: CHAIN_ID })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error(`${functionName} failed onchain`)
      return hash
    },
    [chainId, switchChainAsync, writeContractAsync],
  )

  const accept = useCallback((jobId: bigint) => send('acceptOffer', jobId, PRICE), [send])
  const settleTx = useCallback(
    async (fn: 'acknowledge' | 'timeout', jobId: bigint): Promise<Settlement> => resolveSettlement(await send(fn, jobId), jobId),
    [send],
  )
  return { address, accept, acknowledge: (id: bigint) => settleTx('acknowledge', id), timeout: (id: bigint) => settleTx('timeout', id) }
}
export type WalletActions = ReturnType<typeof useWalletActions>

export const isUserRejection = (e: unknown) => /user rejected|denied|4001/i.test((e as { message?: string }).message ?? '')
