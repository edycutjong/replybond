/**
 * Jobs this visitor started and still has to see settled, kept in localStorage so a reload resumes the countdown or
 * settles at once. Every storage access is in try/catch: the page works with storage blocked.
 */
export type TrackedKind = 'silent' | 'normal' | 'buyer-silent' | 'own'
export interface Tracked {
  id: string
  kind: TrackedKind
  at: number
  /** Known timing, kept so a reload can resume the countdown (or settle) even if chain reads are failing. */
  deadline?: number
  respondedAt?: number
  graceWindow?: number
  output?: string
}
export type TrackedExtra = Pick<Tracked, 'deadline' | 'respondedAt' | 'graceWindow' | 'output'>

const KEY = 'replybond.active'
const MAX_AGE_MS = 6 * 60 * 60 * 1000

export function readTracked(now = Date.now()): Tracked[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    const out: Tracked[] = []
    for (const item of raw as unknown[]) {
      const t = item as Partial<Tracked> | null
      if (t && typeof t.id === 'string' && /^\d+$/.test(t.id) && typeof t.kind === 'string' && typeof t.at === 'number' && now - t.at < MAX_AGE_MS) {
        const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
        out.push({ id: t.id, kind: t.kind, at: t.at, deadline: n(t.deadline), respondedAt: n(t.respondedAt), graceWindow: n(t.graceWindow), output: typeof t.output === 'string' ? t.output : undefined })
      }
    }
    return out
  } catch {
    return []
  }
}

function write(list: Tracked[]): Tracked[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: tracking lives in memory for this page only */
  }
  return list
}

export function addTracked(list: Tracked[], id: string, kind: TrackedKind, extra: TrackedExtra = {}, now = Date.now()): Tracked[] {
  return write([{ id, kind, at: now, ...extra }, ...list.filter((t) => t.id !== id)].slice(0, 10))
}

export function removeTracked(list: Tracked[], id: string): Tracked[] {
  return write(list.filter((t) => t.id !== id))
}
