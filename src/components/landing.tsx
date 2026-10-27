import type { ReactNode } from 'react'
import { CHAIN_ID, CONTRACT, STUDIO_PROJECT_URL, addressUrl, fmtUsdc, shortHash } from '@/lib/appConfig'
import { MAINNET_PROOF, sourcifyUrl } from '@/lib/proof'
import { BOND, GRACE_WINDOW_S, MAX_OUTPUT_BYTES, PRICE, RESPONSE_WINDOW_S } from '@/lib/terms'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { NavLink } from './NavLink'
import { TxLink } from './ui'

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10 pt-6" style={{ borderTop: '1px solid var(--rule)' }}>
      <h2 id={id} className="panel-title">
        {title}
      </h2>
      <div className="mt-3 grid gap-3 text-[17px] max-w-[760px]">{children}</div>
    </section>
  )
}

export function OpenAppButton({ primary = false }: { primary?: boolean }) {
  return (
    <NavLink to="/app" className={`btn inline-flex items-center gap-2${primary ? ' btn-primary' : ''}`}>
      Open the app <ArrowRight size={18} aria-hidden />
    </NavLink>
  )
}

const STEPS = [
  ['You pay, and the provider posts a bond.', 'The buyer pays the price into the contract. The provider has already locked a bond next to it.'],
  ['The provider answers onchain before the deadline and is paid.', 'The answer is written to the chain with a hash of its bytes. The buyer can acknowledge it; if the buyer stays silent, the provider claims after a grace window.'],
  ['No answer means refund plus penalty.', 'Once the deadline has passed, anyone can call timeout. The buyer gets the price back plus the provider\'s bond.'],
] as const

const STATES = [
  ['Open', 'The provider posted an offer and locked the bond.', 'The bond is held. The provider can withdraw it.'],
  ['Accepted', 'The buyer paid. The response clock is running.', 'Price and bond are held.'],
  ['Responded', 'The answer is onchain. The grace window is running.', 'Price and bond are held.'],
  ['Paid', 'The buyer acknowledged the answer.', 'The provider gets price plus bond.'],
  ['Claimed', 'The buyer stayed silent past the grace window.', 'The provider gets price plus bond.'],
  ['TimedOut', 'The deadline passed with no answer.', 'The buyer gets price plus bond.'],
  ['Withdrawn', 'The offer was withdrawn before anyone accepted it.', 'The provider gets the bond back.'],
] as const

export function HowItWorks() {
  return (
    <Section id="how" title="How it works">
      <ol className="grid gap-3 list-none p-0">
        {STEPS.map(([head, body], i) => (
          <li key={head} className="bg-card p-4 grid grid-cols-[auto_1fr] gap-x-4" style={{ border: '1px solid var(--rule)' }}>
            <span className="data text-[22px] font-semibold" aria-hidden style={{ color: 'var(--before)' }}>
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{head}</p>
              <p className="text-[16px]" style={{ color: 'var(--muted)' }}>{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="max-w-none">
        <p className="label mb-2">States of one job. Each job ends in exactly one of the last four.</p>
        <table className="states w-full text-left text-[16px]">
          <thead>
            <tr>
              <th>State</th>
              <th>What it means</th>
              <th>Who gets the money</th>
            </tr>
          </thead>
          <tbody>
            {STATES.map(([state, means, money]) => (
              <tr key={state}>
                <td data-label="State" className="font-semibold">{state}</td>
                <td data-label="What it means">{means}</td>
                <td data-label="Who gets the money">{money}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

const PROOF_LABELS = ['postOffer', 'acceptOffer', 'respond', 'acknowledge', 'timeout', 'claim'] as const

/** The verified mainnet deployment and its proof transactions, only on Arc mainnet; any other chain shows its configured contract. */
export function LiveContract() {
  if (CHAIN_ID === MAINNET_PROOF.chainId) {
    const address = MAINNET_PROOF.contract
    return (
      <Section id="live" title="Live on Arc mainnet">
        <p>
          Contract{' '}
          <a className="link data text-[15px]" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }} href={addressUrl(address)} target="_blank" rel="noopener noreferrer" title={address}>
            {address} <ExternalLink size={13} className="inline -mt-1" aria-hidden />
          </a>
        </p>
        <p>
          Source verified on Sourcify as an exact match:{' '}
          <a className="link" href={sourcifyUrl(address)} target="_blank" rel="noopener noreferrer">
            Sourcify <ExternalLink size={13} className="inline -mt-1" aria-hidden />
          </a>
        </p>
        <div>
          <p className="label mb-2">Proof transactions, one per step</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 list-none p-0">
            {PROOF_LABELS.map((name) => (
              <li key={name}>
                <TxLink hash={MAINNET_PROOF.txs[name]} label={name} />
              </li>
            ))}
          </ul>
        </div>
      </Section>
    )
  }
  if (!CONTRACT) return null
  return (
    <Section id="live" title="The contract">
      <p>
        Contract{' '}
        <a className="link data text-[15px]" href={addressUrl(CONTRACT)} target="_blank" rel="noopener noreferrer" title={CONTRACT}>
          {shortHash(CONTRACT)} <ExternalLink size={13} className="inline -mt-1" aria-hidden />
        </a>
      </p>
    </Section>
  )
}

export function BuiltWithStudio() {
  return (
    <Section id="studio" title="Built with Arc Studio">
      <p>
        ReplyBond was built with Arc Studio, the contract, its tests and this app.{' '}
        <a className="link" href={STUDIO_PROJECT_URL} target="_blank" rel="noopener noreferrer">
          Open the project <ExternalLink size={13} className="inline -mt-1" aria-hidden />
        </a>
      </p>
      {CHAIN_ID === MAINNET_PROOF.chainId && (
        <p style={{ color: 'var(--muted)' }}>
          One honest note: the mainnet contract was deployed with <span className="data text-[15px]">forge create</span> on the unchanged Studio source, because Studio deploys to testnet only.
        </p>
      )}
    </Section>
  )
}

export function LimitsAndNext() {
  return (
    <Section id="limits" title="Honest limits">
      <ul className="grid gap-2 list-disc pl-5">
        <li>It proves the answer was delivered onchain on time. It does not prove the answer is correct.</li>
        <li>Outputs are public, and limited to {MAX_OUTPUT_BYTES} bytes.</li>
        <li>
          The demo uses a price of <span className="data text-[15px]">{fmtUsdc(PRICE)}</span> USDC, a bond of <span className="data text-[15px]">{fmtUsdc(BOND)}</span> USDC, a{' '}
          {RESPONSE_WINDOW_S} s response window and a {GRACE_WINDOW_S} s grace window.
        </li>
        <li>The demo provider is an echo service, and it answers only while some request runs the sweep.</li>
      </ul>
      <h3 className="panel-title mt-4" style={{ fontSize: 22 }}>What's next</h3>
      <ul className="grid gap-2 list-disc pl-5">
        <li>Let the buyer choose the deadline and the bond per call. The demo fixes them.</li>
        <li>Add a way to check answers, so correctness can back a payout and not only delivery.</li>
        <li>Open the provider side beyond the demo echo service.</li>
      </ul>
      <div className="mt-2">
        <OpenAppButton primary />
      </div>
    </Section>
  )
}
