import { useState } from 'react'
import { useModal } from 'connectkit'
import { Status } from '@/lib/abi'
import { useWalletActions, isUserRejection } from '@/hooks/useWalletActions'
import { api } from '@/lib/api'
import type { DemoRunBody, JobBody } from '@/lib/api'
import { NETWORK_NAME, fmtUsdc } from '@/lib/appConfig'
import { publicClient, readCommittedOutput } from '@/lib/chainReads'
import { addMine } from '@/lib/mine'
import { BOND, GRACE_WINDOW_S, PRICE, RESPONSE_WINDOW_S } from '@/lib/terms'
import { BusyNotice } from './BusyNotice'
import type { FlowCtx } from './types'
import { Counterfoil, STATUS_FOR_EVENT, TxLink, blockTime } from './ui'

type Phase = 'idle' | 'offering' | 'accepting' | 'calling' | 'waiting' | 'responded' | 'acknowledging' | 'done' | 'missed' | 'error'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** "Call the API": own-wallet flow (Pay & call) and the wallet-free demo run (Watch it). */
export function CallApiPanel({ ctx }: { ctx: FlowCtx }) {
  const { setOpen } = useModal()
  const wallet = useWalletActions()
  const [phase, setPhase] = useState<Phase>('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<JobBody | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [acceptTx, setAcceptTx] = useState<string | null>(null)
  const [watch, setWatch] = useState<{ phase: 'idle' | 'running' | 'done' | 'busy' | 'error'; body?: DemoRunBody; message?: string }>({ phase: 'idle' })

  const job = jobId ? ctx.jobs.find((j) => String(j.id) === jobId) : undefined
  const settlement = jobId ? ctx.settlements.byJob[jobId] : undefined
  const claimable = job && job.status === Status.Responded && ctx.settlements.byJob[String(job.id)] === undefined && ctx.sweep?.providerAddress?.toLowerCase() === job.provider.toLowerCase() && ctx.now > job.respondedAt + job.graceWindow

  const fail = (e: unknown) => {
    if (isUserRejection(e)) {
      setPhase(jobId ? 'responded' : 'idle')
      return
    }
    setError((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message)
    setPhase('error')
  }

  const payAndCall = async () => {
    if (!wallet.address) return setOpen(true)
    setError(null)
    setRefusal(null)
    setOutput(null)
    setJobId(null)
    try {
      setPhase('offering')
      const o = await api.offer(wallet.address)
      if (o.status !== 200 || !o.body.jobId) {
        const wait = o.body.retryInSeconds ? ` Try again in ${o.body.retryInSeconds} s.` : ''
        throw new Error((o.body.error === 'rate_limited' ? 'The demo offer limit is reached.' : (o.body.error ?? 'offer failed')) + wait)
      }
      const id = o.body.jobId
      setJobId(id)
      addMine(id)
      const fromBlock = (await publicClient.getBlockNumber()) - 5n
      setPhase('accepting')
      setAcceptTx(await wallet.accept(BigInt(id)))
      setPhase('calling')
      const jr = await api.job(id)
      if (jr.body.refused) setRefusal(jr.body) // not ours or wrong mode: show the settle path, keep watching the chain
      setPhase('waiting')
      for (let i = 0; i < 40; i++) {
        const out = await readCommittedOutput(BigInt(id), fromBlock)
        if (out) {
          setOutput(out.output)
          await ctx.refresh()
          return setPhase('responded')
        }
        await sleep(1500)
      }
      setPhase('missed')
    } catch (e) {
      fail(e)
    }
  }

  const acknowledge = async () => {
    if (!jobId) return
    try {
      setPhase('acknowledging')
      ctx.settlements.remember(jobId, await wallet.acknowledge(BigInt(jobId)))
      await ctx.refresh()
      setPhase('done')
    } catch (e) {
      fail(e)
    }
  }

  const timeoutFromWallet = async () => {
    if (!jobId) return
    try {
      ctx.settlements.remember(jobId, await wallet.timeout(BigInt(jobId)))
      await ctx.refresh()
      setPhase('done')
    } catch (e) {
      fail(e)
    }
  }

  const watchIt = async () => {
    setWatch({ phase: 'running' })
    try {
      const r = await api.demoRun('normal')
      if (r.status === 409) return setWatch({ phase: 'busy', body: r.body })
      const ack = r.body.txHashes?.acknowledge
      if (r.status !== 200 || !r.body.jobId || !ack) throw new Error(r.body.error ?? `demo run failed (HTTP ${r.status})`)
      await ctx.settlements.load(r.body.jobId, ack)
      setWatch({ phase: 'done', body: r.body })
      await ctx.refresh()
    } catch (e) {
      setWatch({ phase: 'error', message: (e as Error).message })
    }
  }

  const busyFlow = ['offering', 'accepting', 'calling', 'waiting', 'acknowledging'].includes(phase)
  const label: Record<string, string> = { offering: 'Posting the offer', accepting: 'Confirm in your wallet', calling: 'Calling the API', waiting: 'Waiting for the answer onchain', acknowledging: 'Confirm in your wallet' }

  return (
    <section aria-labelledby="call-title" className="bg-card p-5" style={{ border: '1px solid var(--rule)' }}>
      <h2 id="call-title" className="panel-title">Call the API</h2>
      <p className="mt-1 data text-[14px]">price {fmtUsdc(PRICE)} · bond {fmtUsdc(BOND)} · window {RESPONSE_WINDOW_S} s · grace {GRACE_WINDOW_S} s</p>
      <p className="mt-2 text-[15px]">Our demo provider is an echo service: it answers with your input in capitals.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={() => void payAndCall()} disabled={busyFlow}>
          {busyFlow ? <span className="dots-wait">{label[phase]}</span> : wallet.address ? 'Pay & call' : 'Connect to pay & call'}
        </button>
        <button className="btn" onClick={() => void watchIt()} disabled={watch.phase === 'running'}>
          {watch.phase === 'running' ? <span className="dots-wait">Running</span> : `Watch it on ${NETWORK_NAME}`}
        </button>
      </div>
      {phase === 'error' && <p role="alert" className="mt-3" style={{ color: 'var(--after)' }}>{error} <button className="link" onClick={() => void payAndCall()}>Try again</button></p>}

      {jobId && phase !== 'idle' && phase !== 'error' && (
        <div className="mt-4">
          <Counterfoil id={jobId} price={job?.price ?? PRICE} bond={job?.bond ?? BOND} status={settlement?.classification.event ? STATUS_FOR_EVENT[settlement.classification.event] : (job?.status ?? Status.Accepted)} deadline={job?.deadline} respondedAt={job?.respondedAt} graceWindow={job?.graceWindow ?? GRACE_WINDOW_S} now={ctx.now} output={output ?? job?.output} settlement={settlement}>
            {acceptTx && <p className="text-[14px]">your accept: <TxLink hash={acceptTx} /></p>}
            {refusal && (
              <p className="field text-[15px]" role="status">
                The job route declined this job: {refusal.reason}. Settle path: {refusal.settle?.note ?? 'the sweep still answers within the deadline'}.
              </p>
            )}
            {phase === 'responded' && !settlement && (
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn btn-primary" onClick={() => void acknowledge()}>Acknowledge &amp; release payment</button>
                <span className="text-[14px]" style={{ color: 'var(--muted)' }}>If you do not, the provider can claim after the grace window.</span>
              </div>
            )}
            {claimable && (
              <button className="btn" onClick={() => void ctx.settlements.settleJob(jobId)} disabled={ctx.settlements.settling[jobId]}>
                {ctx.settlements.settling[jobId] ? <span className="dots-wait">Claiming</span> : 'Claim'}
              </button>
            )}
            {phase === 'missed' && (
              <div className="flex flex-wrap items-center gap-3">
                <span>The provider missed the deadline.</span>
                <button className="btn btn-primary" onClick={() => void timeoutFromWallet()}>Call timeout from your wallet</button>
              </div>
            )}
          </Counterfoil>
        </div>
      )}

      {watch.phase === 'busy' && watch.body && <BusyNotice body={watch.body} now={ctx.now} settle={ctx.settle} />}
      {watch.phase === 'error' && <p role="alert" className="mt-3" style={{ color: 'var(--after)' }}>{watch.message}</p>}
      {watch.phase === 'done' && watch.body?.jobId && (
        <div className="mt-4">
          <Counterfoil id={watch.body.jobId} price={PRICE} bond={BOND} status={Status.Paid} now={ctx.now} output={watch.body.output} settlement={ctx.settlements.byJob[watch.body.jobId]}>
            <p className="text-[14px]" style={{ color: 'var(--muted)' }}>
              {Object.entries(watch.body.txHashes ?? {}).map(([k, h]) => (h ? <span key={k} className="mr-3">{k} <TxLink hash={h} /></span> : null))}
            </p>
            {watch.body.deadline ? <p className="text-[14px]">answered before the deadline at <span className="data">{blockTime(watch.body.deadline)}</span></p> : null}
          </Counterfoil>
        </div>
      )}
    </section>
  )
}
