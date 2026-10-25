import { useCallback, useEffect, useRef, useState } from 'react'
import { loadJobs } from '@/lib/chainReads'
import type { JobView } from '@/lib/chainReads'

export function useJobs() {
  const [jobs, setJobs] = useState<JobView[]>([])
  const [head, setHead] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const offset = useRef(0) // chain seconds minus local seconds
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const r = await loadJobs()
      offset.current = r.now - Date.now() / 1000
      setJobs(r.jobs)
      setHead(r.head)
      setError(null)
    } catch (e) {
      setError((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0)
    const t = setInterval(() => {
      if (!document.hidden) void refresh()
    }, 5000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [refresh])

  const chainNow = useCallback(() => Date.now() / 1000 + offset.current, [])
  return { jobs, head, loading, error, refresh, chainNow }
}

/** Re-renders every 500 ms so countdowns stay live. */
export function useTick(ms = 500): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}
