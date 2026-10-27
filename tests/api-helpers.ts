import type { Address, Hex } from 'viem'
import { demoBuyerAddress, providerAddress } from './api-env'
import { offers } from '../src/lib/offers'
import { GRACE_WINDOW_S, POOL_GRACE_WINDOW_S } from '../src/lib/terms'
import { Status } from '../src/lib/abi'
import type { Job, Snapshot } from '../api/_lib/state'

export const NOW = 1_800_000_000
export const silentHash = offers.find((o) => o.mode === 'silent')!.requestHash as Hex
export const normalHash = offers.find((o) => o.mode === 'normal')!.requestHash as Hex

let nextId = 1n
/** A job of ours: pool stock by default (silent fixture, offered to and accepted by the demo buyer, pool marker). */
export function job(over: Partial<Job> = {}): Job {
  return {
    id: nextId++,
    provider: providerAddress as Address,
    designated: demoBuyerAddress as Address,
    buyer: demoBuyerAddress as Address,
    requestHash: silentHash,
    price: 10n ** 16n,
    bond: 5n * 10n ** 15n,
    graceWindow: POOL_GRACE_WINDOW_S,
    status: Status.Accepted,
    postedAt: NOW - 100,
    deadline: NOW - 10,
    respondedAt: 0,
    responseHash: null,
    txs: {},
    ...over,
  }
}
export const watchJob = (over: Partial<Job> = {}) => job({ graceWindow: GRACE_WINDOW_S, ...over })

export function snap(jobs: Job[], now = NOW): Snapshot {
  return { now, head: 1000n, fromBlock: 1n, jobs }
}
