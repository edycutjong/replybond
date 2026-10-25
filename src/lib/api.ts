import type { Address, Hex } from 'viem'

export interface ApiReply<T> {
  status: number
  body: T
}

async function call<T>(path: string, method: 'GET' | 'POST', payload?: unknown): Promise<ApiReply<T>> {
  const res = await fetch(path, {
    method,
    headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await res.text()
  let body: unknown = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { error: text.slice(0, 200) || `HTTP ${res.status}` }
  }
  return { status: res.status, body: body as T }
}

export interface PoolStatus {
  target: number
  size: number
  ready: string[]
  waiting: string[]
  nextReadyInSeconds: number | null
}

export interface ReceiptSummary {
  txHash: Hex
  status: string
  blockNumber: string
  logs: { logIndex: number; address: string; topics: string[]; data: string }[]
}

export interface SweepBody {
  error?: string
  contract?: Address
  chainId?: number
  providerAddress?: Address
  demoBuyerAddress?: Address
  responded?: { jobId: string; txHash: Hex }[]
  claimed?: { jobId: string; txHash: Hex }[]
  withdrawn?: { jobId: string; txHash: Hex }[]
  errors?: { jobId: string; action: string; error: string }[]
}

export interface SettleBody {
  error?: string
  refused?: boolean
  reason?: string
  settled?: boolean
  alreadySettled?: boolean
  action?: string
  actionLabel?: string
  by?: string
  jobId?: string
  txHash?: Hex | null
  receipt?: ReceiptSummary | null
  note?: string
  readyInSeconds?: number
  nextReadyInSeconds?: number | null
  latestSettledTimeout?: { jobId: string; receipt: ReceiptSummary } | null
  pool?: PoolStatus
}

export interface DemoRunBody {
  error?: string
  message?: string
  mode?: 'normal' | 'silent'
  jobId?: string
  deadline?: number
  output?: string
  responseHash?: Hex
  finalStatus?: string
  txHashes?: Record<string, Hex | null>
  retryAt?: number | null
  retryInSeconds?: number | null
  busy?: { reasons: { kind: string; detail: string; until: number }[] }
  rate?: { hour: { count: number; max: number }; day: { count: number; max: number } }
  pool?: PoolStatus
}

export interface OfferBody {
  error?: string
  jobId?: string
  txHash?: Hex
  retryAt?: number | null
  retryInSeconds?: number | null
}

export interface JobBody {
  error?: string
  refused?: boolean
  reason?: string
  accepted?: boolean
  output?: string
  responseHash?: Hex
  txHash?: Hex | null
  settle?: { action: string; note?: string; readyInSeconds?: number; via?: string }
}

export const api = {
  sweep: () => call<SweepBody>('/api/sweep', 'GET'),
  settle: (jobId?: string) => call<SettleBody>('/api/settle', 'POST', jobId === undefined ? {} : { jobId }),
  refill: () => call<Record<string, unknown>>('/api/demo-refill', 'GET'),
  demoRun: (mode: 'normal' | 'silent') => call<DemoRunBody>('/api/demo-run', 'POST', { mode }),
  offer: (buyer: Address) => call<OfferBody>('/api/offer', 'POST', { buyer }),
  job: (jobId: string) => call<JobBody>('/api/job', 'POST', { jobId }),
}
