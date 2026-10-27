import { useState } from 'react'
import { useModal } from 'connectkit'
import { Status } from '@/lib/abi'
import { useWalletActions, isUserRejection } from '@/hooks/useWalletActions'
import { api, walletsLowMessage } from '@/lib/api'
import type { DemoRunBody, JobBody } from '@/lib/api'
import { NETWORK_NAME, fmtUsdc } from '@/lib/appConfig'
import { publicClient, readCommittedOutput } from '@/lib/chainReads'
import { BOND, GRACE_WINDOW_S, PRICE, RESPONSE_WINDOW_S } from '@/lib/terms'
import type { TrackedKind } from '@/lib/tracked'
import { BusyNotice } from './BusyNotice'
import { TrackedCard } from './TrackedCard'
import type { CardFallback } from './TrackedCard'
import type { FlowCtx } from './types'

type Phase = 'idle' | 'offering' | 'accepting' | 'calling' | 'waiting' | 'responded' | 'acknowledging' | 'done' | 'missed' | 'error'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const CALL_KINDS: TrackedKind[] = ['normal', 'buyer-silent', 'own']

/** "Call the API": own-wallet flow (Pay & call) and two wallet-free demo runs (answered and acknowledged / buyer stays silent). */
export function CallApiPanel({ ctx }: { ctx: FlowCtx }) {
  const { setOpen } = useModal()
  const wallet = useWalletActions()
  const [phase, setPhase] = useState<Phase>('idle')
  const [active, setActive] = useState<{ id: string; kind: TrackedKind; fallback?: CardFallback } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lowWallets, setLowWallets] = useState(false)
  const [refusal, setRefusal] = useState<JobBody | null>(null)
  const [watch, setWatch] = useState<{ phase: 'idle' | 'running' | 'busy' | 'error'; mode?: 'normal' | 'buyer-silent'; body?: DemoRunBody; message?: string }>({ phase: 'idle' })

  // The job on show: the one just started, else a call-panel job restored from storage.
  const restored = ctx.seen.find((t) => CALL_KINDS.includes(t.kind))
  const shown = active ?? (restored ? { id: restored.id, kind: restored.kind } : null)
  const settlement = shown ? ctx.settlements.byJob[shown.id] : undefined
  const job = shown ? ctx.jobs.find((j) => String(j.id) === shown.id) : undefined

  const fail = (e: unknown) => {
    setError((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message)
    setPhase('error')
  }

  const payAndCall = async () => {
    if (!wallet.address) return setOpen(true)
    setError(null)
    setNotice(null)
    setLowWallets(false)
    setRefusal(null)
    setActive(null)
    // Where the flow is and which offer it made are kept in locals, not state: the catch below must not read stale state.
    let step: 'offer' | 'accept' | 'after' = 'offer'
    let offeredId: string | null = null
    try {
      setPhase('offering')
      const o = await api.offer(wallet.address)
      const low = walletsLowMessage(o.body)
      if (low) {
        setLowWallets(true)
        throw new Error(low)
      }
      if (o.status !== 200 || !o.body.jobId) {
        const wait = o.body.retryInSeconds ? ` Try again in ${o.body.retryInSeconds} s.` : ''
        throw new Error((o.body.error === 'rate_limited' ? 'The demo offer limit is reached.' : (o.body.error ?? 'offer failed')) + wait)
      }
      const id = o.body.jobId
      offeredId = id
      setActive({ id, kind: 'own' })
      ctx.track(id, 'own')
      const fromBlock = (await publicClient.getBlockNumber()) - 5n
      setPhase('accepting')
      step = 'accept'
      const acceptTx = await wallet.accept(BigInt(id))
      step = 'after'
      setActive({ id, kind: 'own', fallback: { txHashes: { 'your accept': acceptTx } } })
      setPhase('calling')
      const jr = await api.job(id)
      if (jr.body.refused) setRefusal(jr.body) // not ours or wrong mode: show the settle path, keep watching the chain
      setPhase('waiting')
      for (let i = 0; i < 40; i++) {
        if (await readCommittedOutput(BigInt(id), fromBlock)) {
          await ctx.refresh()
          return setPhase('responded')
        }
        await sleep(1500)
      }
      setPhase('missed')
    } catch (e) {
      if (step === 'accept' && isUserRejection(e)) {
        // The only wallet prompt in this flow is the accept: cancelling it leaves an open offer and no job to show.
        setActive(null)
        if (offeredId) ctx.forget(offeredId)
        setPhase('idle')
        setNotice('Accept cancelled. The open offer is withdrawn by the next sweep after 10 minutes.')
        return
      }
      fail(e)
    }
  }

  const acknowledge = async () => {
    if (!shown) return
    try {
      setPhase('acknowledging')
      ctx.settlements.remember(shown.id, await wallet.acknowledge(BigInt(shown.id)))
      await ctx.refresh()
      setPhase('done')
    } catch (e) {
      if (isUserRejection(e)) return setPhase('responded') // the wallet was dismissed: the answer is still there to acknowledge
      fail(e)
    }
  }

  const timeoutFromWallet = async () => {
    if (!shown) return
    try {
      ctx.settlements.remember(shown.id, await wallet.timeout(BigInt(shown.id)))
      await ctx.refresh()
      setPhase('done')
    } catch (e) {
      if (isUserRejection(e)) return setPhase('missed')
      fail(e)
    }
  }

  const watchIt = async (mode: 'normal' | 'buyer-silent') => {
    setWatch({ phase: 'running', mode })
    setNotice(null)
    setPhase('idle')
    try {
      const r = await api.demoRun(mode)
      if (r.status === 409 || walletsLowMessage(r.body)) return setWatch({ phase: 'busy', mode, body: r.body })
      const b = r.body
      if (r.status !== 200 || !b.jobId) throw new Error(walletsLowMessage(b) ?? b.error ?? b.message ?? `demo run failed (HTTP ${r.status})`)
      if (mode === 'normal') {
        const ack = b.txHashes?.acknowledge
        if (!ack) throw new Error('the run returned no acknowledge transaction')
        // Classified from the receipt the route returned; the browser's own RPC is only the fallback.
        await ctx.settlements.load(b.jobId, ack, b.receipt)
        setActive({ id: b.jobId, kind: 'normal', fallback: { status: Status.Paid, output: b.output, txHashes: b.txHashes } })
      } else {
        ctx.track(b.jobId, 'buyer-silent', { respondedAt: b.respondedAt ?? undefined, graceWindow: b.graceWindow, output: b.output })
        setActive({
          id: b.jobId,
          kind: 'buyer-silent',
          fallback: { status: Status.Responded, respondedAt: b.respondedAt ?? undefined, graceWindow: b.graceWindow, output: b.output, txHashes: b.txHashes },
        })
      }
      setWatch({ phase: 'idle' })
      await ctx.refresh()
    } catch (e) {
      setWatch({ phase: 'error', mode, message: (e as Error).message })
    }
  }

  const busyFlow = ['offering', 'accepting', 'calling', 'waiting', 'acknowledging'].includes(phase)
  const running = watch.phase === 'running'
  const label: Record<string, string> = { offering: 'Posting the offer', accepting: 'Confirm in your wallet', calling: 'Calling the API', waiting: 'Waiting for the answer onchain', acknowledging: 'Confirm in your wallet' }
  const canAck = shown?.kind === 'own' && job?.status === Status.Responded && !settlement && !!wallet.address && job.buyer.toLowerCase() === wallet.address.toLowerCase()

  return (
    <section aria-labelledby="call-title" className="bg-card p-5" style={{ border: '1px solid var(--rule)' }}>
      <h2 id="call-title" className="panel-title">Call the API</h2>
      <p className="mt-1 data wrap text-[14px]">price {fmtUsdc(PRICE)} · bond {fmtUsdc(BOND)} · window {RESPONSE_WINDOW_S} s · grace {GRACE_WINDOW_S} s</p>
      <p className="mt-2 text-[15px]">Our demo provider is an echo service: it answers with your input in capitals.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={() => void payAndCall()} disabled={busyFlow || running}>
          {busyFlow ? <span className="dots-wait">{label[phase]}</span> : wallet.address ? 'Pay & call' : 'Connect to pay & call'}
        </button>
        <button className="btn" onClick={() => void watchIt('normal')} disabled={running || busyFlow}>
          {running && watch.mode === 'normal' ? <span className="dots-wait">Running</span> : `Watch it on ${NETWORK_NAME}`}
        </button>
        <button className="btn" onClick={() => void watchIt('buyer-silent')} disabled={running || busyFlow}>
          {running && watch.mode === 'buyer-silent' ? <span className="dots-wait">Running</span> : 'Watch: buyer stays silent after the answer'}
        </button>
      </div>
      {phase === 'error' && <p role="alert" className="mt-3" style={{ color: 'var(--after)' }}>{error}{lowWallets ? null : <> <button className="link" onClick={() => void payAndCall()}>Try again</button></>}</p>}
      {notice && (
        <p role="status" className="mt-3 text-[15px]">
          {notice} <button className="link" onClick={() => void payAndCall()}>Try again</button>
        </p>
      )}
      {watch.phase === 'busy' && watch.body && <BusyNotice body={watch.body} now={ctx.now} settle={ctx.settle} />}
      {watch.phase === 'error' && <p role="alert" className="mt-3" style={{ color: 'var(--after)' }}>{watch.message}</p>}

      {shown && (
        <div className="mt-4">
          <TrackedCard
            ctx={ctx}
            id={shown.id}
            kind={shown.kind}
            fallback={active?.id === shown.id ? active.fallback : undefined}
            extra={
              <>
                {refusal && shown.kind === 'own' && (
                  <p className="field text-[15px]" role="status">
                    The job route declined this job: {refusal.reason}. Settle path: {refusal.settle?.note ?? 'the sweep still answers within the deadline'}.
                  </p>
                )}
                {canAck && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button className="btn btn-primary" onClick={() => void acknowledge()} disabled={phase === 'acknowledging'}>Acknowledge &amp; release payment</button>
                    <span className="text-[14px]" style={{ color: 'var(--muted)' }}>If you do not, the provider can claim after the grace window.</span>
                  </div>
                )}
                {phase === 'missed' && shown.kind === 'own' && !settlement && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span>The provider missed the deadline.</span>
                    <button className="btn btn-primary" onClick={() => void timeoutFromWallet()}>Call timeout from your wallet</button>
                  </div>
                )}
              </>
            }
          />
        </div>
      )}
    </section>
  )
}
