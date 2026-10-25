import { useEffect, useState } from 'react'
import { Status } from '@/lib/abi'
import { CONTRACT, fmtUsdc, padId, shortHash } from '@/lib/appConfig'
import { SYSTEM_EMITTER } from '@/lib/classifyReceipt'
import { getReceipt } from '@/lib/chainReads'
import type { JobView, Settlement } from '@/lib/chainReads'
import { TxLink } from './ui'

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** Value of the system-emitter Transfer from `from` into the contract in a deposit receipt, or null. */
async function deposit(hash: `0x${string}` | undefined, from: string): Promise<bigint | null> {
  const contract = CONTRACT
  if (!hash || !contract) return null
  const r = await getReceipt(hash)
  const hit = r?.logs.find(
    (l) =>
      l.address.toLowerCase() === SYSTEM_EMITTER.toLowerCase() &&
      l.topics[0] === TRANSFER &&
      l.topics.length === 3 &&
      `0x${l.topics[1].slice(-40)}` === from.toLowerCase() &&
      `0x${l.topics[2].slice(-40)}` === contract.toLowerCase(),
  )
  return hit ? BigInt(hit.data) : null
}

interface Leg {
  from: string
  to: string
  amount: bigint
  what: string
  tx?: string
  tag: 'Transfer log' | "from the contract's events" | 'PAID' | 'OWED' | 'BOND RETURNED' | 'transfer not confirmed'
}

export function MoneyTrail({ job, settlement }: { job: JobView | undefined; settlement: Settlement | undefined }) {
  const [legs, setLegs] = useState<Leg[]>([])
  const shown = job ? legs : []
  const bondTx = job?.txs.posted
  const priceTx = job?.txs.accepted
  useEffect(() => {
    if (!job) return
    let live = true
    void (async () => {
      const [bond, price] = await Promise.all([deposit(bondTx, job.provider), deposit(priceTx, job.buyer)])
      const out: Leg[] = [
        { from: `provider ${shortHash(job.provider)}`, to: 'ReplyBond', amount: bond ?? job.bond, what: 'postOffer (bond)', tx: bondTx, tag: bond !== null ? 'Transfer log' : "from the contract's events" },
      ]
      if (job.status !== Status.Open && job.status !== Status.Withdrawn) {
        out.push({ from: `buyer ${shortHash(job.buyer)}`, to: 'ReplyBond', amount: price ?? job.price, what: 'acceptOffer', tx: priceTx, tag: price !== null ? 'Transfer log' : "from the contract's events" })
      }
      if (settlement) {
        const c = settlement.classification
        const payee = c.payee ? shortHash(c.payee) : 'payee'
        out.push({
          from: 'ReplyBond',
          to: payee,
          amount: c.amount ?? job.price + job.bond,
          what: `${c.event === 'JobTimedOut' ? 'timeout' : c.event === 'JobClaimed' ? 'claim' : c.event === 'OfferWithdrawn' ? 'withdrawOffer' : 'acknowledge'} · ${c.kind === 'PAID' && c.event === 'OfferWithdrawn' ? 'BOND RETURNED' : c.kind}`,
          tx: settlement.txHash,
          tag: c.kind === 'UNREADABLE' ? 'transfer not confirmed' : c.kind === 'PAID' && c.event === 'OfferWithdrawn' ? 'BOND RETURNED' : c.kind,
        })
      }
      if (live) setLegs(out)
    })()
    return () => {
      live = false
    }
  }, [job, bondTx, priceTx, settlement])

  return (
    <section aria-labelledby="trail-title" className="mt-8">
      <h2 id="trail-title" className="panel-title">Money trail</h2>
      <p className="label mt-1">Arc Transfer logs, or “from the contract's events”{job ? ` · job Nº ${padId(job.id)}` : ''}</p>
      <div className="mt-3 bg-card p-4" style={{ border: '1px solid var(--rule)' }}>
        {shown.length === 0 && <p className="label">Pick a job in the table to see where its money moved.</p>}
        {shown.map((l) => (
          <div key={l.what} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2" style={{ borderBottom: '1px dotted var(--rule)' }}>
            <span className="data text-[14px] min-w-[240px]">{l.from} → {l.to}</span>
            <span className="amount" style={{ color: l.tag === 'PAID' ? 'var(--ink)' : undefined }}>{fmtUsdc(l.amount)}</span>
            <span>{l.what}</span>
            <span className="label">{l.tag}</span>
            {l.tx && <TxLink hash={l.tx} />}
          </div>
        ))}
      </div>
    </section>
  )
}
