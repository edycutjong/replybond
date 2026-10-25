const KEY = 'replybond.myJobs'

/** Job ids this browser started, kept so a reload can restore pending jobs from chain state. */
export function readMine(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function addMine(id: string): string[] {
  const next = [id, ...readMine().filter((x) => x !== id)].slice(0, 20)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: the page still works for this session */
  }
  return next
}
