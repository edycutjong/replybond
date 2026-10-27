import type { Address, Hex, Log } from 'viem'
import type { PageCache } from './scanPages'

/** The parts of a contract log the page needs, in a JSON-safe shape. */
export interface StoredLog {
  topics: string[]
  data: string
  blockNumber: string
  logIndex: number
  transactionHash: string
  blockHash?: string
  transactionIndex?: number
  blockTimestamp?: string
}

export function toStored(l: Log): StoredLog {
  const ts = (l as { blockTimestamp?: bigint | string | null }).blockTimestamp
  return {
    topics: [...l.topics],
    data: l.data,
    blockNumber: String(l.blockNumber),
    logIndex: Number(l.logIndex),
    transactionHash: String(l.transactionHash),
    blockHash: l.blockHash ? String(l.blockHash) : undefined,
    transactionIndex: l.transactionIndex === null || l.transactionIndex === undefined ? undefined : Number(l.transactionIndex),
    blockTimestamp: ts === undefined || ts === null ? undefined : String(ts),
  }
}

export function fromStored(s: StoredLog, address: Address): Log {
  return {
    address,
    topics: s.topics as [Hex, ...Hex[]],
    data: s.data as Hex,
    blockNumber: BigInt(s.blockNumber),
    logIndex: s.logIndex,
    transactionHash: s.transactionHash as Hex,
    blockHash: (s.blockHash ?? null) as Hex,
    transactionIndex: s.transactionIndex ?? 0,
    removed: false,
    ...(s.blockTimestamp !== undefined ? { blockTimestamp: s.blockTimestamp } : {}),
  } as unknown as Log
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Completed log pages, kept in memory and in sessionStorage under `<prefix>:<from>-<to>` (the prefix carries the chain
 * and the contract). Every storage access is in a try/catch: without storage the page just rescans.
 */
export function storedPageCache(prefix: string, storage: () => StorageLike | null = () => (typeof sessionStorage === 'undefined' ? null : sessionStorage)): PageCache<StoredLog> {
  const memory = new Map<string, StoredLog[]>()
  const key = (from: bigint, to: bigint) => `${prefix}:${from}-${to}`
  return {
    get(from, to) {
      const k = key(from, to)
      const hit = memory.get(k)
      if (hit) return hit
      try {
        const raw = storage()?.getItem(k)
        if (!raw) return null
        const items = JSON.parse(raw) as StoredLog[]
        if (!Array.isArray(items)) return null
        memory.set(k, items)
        return items
      } catch {
        return null
      }
    },
    set(from, to, items) {
      const k = key(from, to)
      memory.set(k, items)
      try {
        storage()?.setItem(k, JSON.stringify(items))
      } catch {
        /* storage unavailable or full: the in-memory copy still serves this visit */
      }
    },
  }
}

export const pageCacheKey = (chainId: number, contract: Address) => `replybond:logs:${chainId}:${contract.toLowerCase()}`
