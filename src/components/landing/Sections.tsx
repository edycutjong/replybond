import { ArrowUpRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { TapeText, TurnStamp, GLYPH } from './Glyphs'
import { Band } from './Chrome'
import { useReducedMotion } from '@/hooks/useReplay'
import { CHAIN_ID, STUDIO_PROJECT_URL, TURNS_TABLE_URL, fmtUsdc, txUrl } from '@/lib/appConfig'
import { HONEST_QUOTES, faqItems, receiptStats, shortTx, tapeFor } from '@/lib/landingModel'
import type { ReceiptStat, TapeLine } from '@/lib/landingModel'
import { MAINNET_PROOF, REPO_URL, STUDIO_TURNS } from '@/lib/proof'
import { BOND, GRACE_WINDOW_S, MAX_OUTPUT_BYTES, PRICE, RESPONSE_WINDOW_S } from '@/lib/terms'
import { NETWORK_NAME } from '@/lib/appConfig'

/** A number that counts up the first time it is seen, but only if it starts below the fold: a visible number never resets. */
function Count({ stat }: { stat: ReceiptStat }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const final = stat.value.toFixed(stat.decimals)
  useEffect(() => {
    const el = ref.current
    if (!el || reduced || el.getBoundingClientRect().top <= window.innerHeight) return
    el.textContent = (0).toFixed(stat.decimals)
    let raf = 0
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        const t0 = performance.now()
        const step = (now: number) => {
          const p = Math.min(1, (now - t0) / 1100)
          el.textContent = (stat.value * (1 - Math.pow(1 - p, 3))).toFixed(stat.decimals)
          if (p < 1) raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
      el.textContent = final
    }
  }, [stat.value, stat.decimals, reduced, final])
  // Assistive tech reads the final value; the digits that animate are hidden from it.
  return (
    <b role="img" aria-label={final} className={stat.red ? 'lp-red' : undefined}>
      <span ref={ref} aria-hidden="true">{final}</span>
    </b>
  )
}

/** Four receipts: every number comes from the job terms, the proof config or the test counts. */
export function Receipts() {
  return (
    <div className="lp-receipts">
      {receiptStats(fmtUsdc).map((s) => (
        <div className="lp-rc" key={s.source + s.label}>
          <Count stat={s} />
          <span>{s.label}</span>
          <code>{s.source}</code>
        </div>
      ))}
    </div>
  )
}

function Tape({ lines }: { lines: TapeLine[] }) {
  return (
    <div className="lp-ftape lp-data">
      {lines.map((l) => (
        <div key={l.kind} className={l.kind === 'transfer' ? 'lp-red' : undefined}>
          <TapeText text={l.text} />
          {l.status && <span className="lp-ok"> · {l.status}</span>}
          {l.hash && (
            <>
              {' '}
              <a href={txUrl(l.hash)} target="_blank" rel="noopener noreferrer">
                {l.hashShort} <ArrowUpRight size={13} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

/** "One job, three endings": five tiles, the timeout one carries the real receipt tape. */
export function Endings({ liveTape }: { liveTape: TapeLine[] | null }) {
  const total = fmtUsdc(PRICE + BOND)
  const mainnet = CHAIN_ID === MAINNET_PROOF.chainId
  const proofTape = tapeFor({ jobId: MAINNET_PROOF.jobs.timeout, amount: total, payeeShort: MAINNET_PROOF.timeoutPayeeShort, hash: MAINNET_PROOF.txs.timeout, hashShort: shortTx(MAINNET_PROOF.txs.timeout) })
  const tape = mainnet ? proofTape : liveTape
  return (
    <Band id="how" docket="Form RB-1" title="One job, three endings" lead={`Every call is a job with a price, a bond and a deadline. The contract decides who gets the ${total} USDC, and the chain shows the Transfer.`}>
      <div className="lp-bento">
        <div className="lp-f lp-f1">{GLYPH.post}<p className="lp-cap">01 · Provider</p><h3>Posts an offer, bonded</h3><p>The provider locks {fmtUsdc(BOND)} USDC behind its promise to answer.</p><span className="lp-fn">postOffer</span></div>
        <div className="lp-f lp-f2">{GLYPH.accept}<p className="lp-cap">02 · Buyer</p><h3>Pays, the clock starts</h3><p>The buyer pays {fmtUsdc(PRICE)} USDC. From here the provider has {RESPONSE_WINDOW_S} s.</p><span className="lp-fn">acceptOffer</span></div>
        <div className="lp-f lp-f3">{GLYPH.respond}<p className="lp-cap">03 · Provider</p><h3>Answers onchain</h3><p>Up to {MAX_OUTPUT_BYTES.toLocaleString('en-US')} bytes, written to the chain with its hash.</p><span className="lp-fn">respond</span></div>
        <div className="lp-f lp-f4">
          <div>
            {GLYPH.timeout}
            <p className="lp-cap">04 · Missed the deadline</p>
            <h3>Anyone can settle it</h3>
            <p>After {RESPONSE_WINDOW_S} s with no answer, one call sends price and bond to the buyer: {fmtUsdc(PRICE)} refund + {fmtUsdc(BOND)} penalty.</p>
            <span className="lp-fn">timeout</span>
          </div>
          {tape && <Tape lines={tape} />}
        </div>
        <div className="lp-f lp-f5">{GLYPH.paid}<p className="lp-cap">05 · Answered in time</p><h3>The provider is paid</h3><p>The buyer acknowledges, or stays silent past the {GRACE_WINDOW_S} s grace: anyone can trigger the claim and the provider is paid.</p><span className="lp-fn">acknowledge · claim</span></div>
      </div>
    </Band>
  )
}

/** Selected Studio turns with links to their commits. */
export function Studio() {
  const mainnet = CHAIN_ID === MAINNET_PROOF.chainId
  return (
    <Band
      id="studio"
      docket="Arc Studio"
      title="Built at the Studio counter"
      lead={
        <>
          The contract, its tests, the API routes, the app and this page were built in Arc Studio turns{mainnet ? <>; only the mainnet deploy ran outside it, with <code className="lp-data">forge create</code> on the unchanged source</> : null}. Selected turns, oldest first:
        </>
      }
    >
      <div className="lp-turns">
        {STUDIO_TURNS.map((t) => (
          <div className="lp-t" key={t.commit}>
            <TurnStamp tag={t.tag} no={t.no} />
            <h3>{t.title}</h3>
            <p>{t.blurb}</p>
            <a className="lp-data" href={`${REPO_URL}/commit/${t.commit}`} target="_blank" rel="noopener noreferrer">{t.commit}</a>
          </div>
        ))}
      </div>
      <p className="lp-more">
        <a href={TURNS_TABLE_URL} target="_blank" rel="noopener noreferrer">How it was built: the turn-by-turn table <ArrowUpRight size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} /></a>
        {' · '}
        <a href={STUDIO_PROJECT_URL} target="_blank" rel="noopener noreferrer">The Arc Studio project</a> (opens with an Arc Studio login)
      </p>
    </Band>
  )
}

/** Three lines lifted from the README's Honest limits. */
export function Honest() {
  return (
    <Band docket="Small print" title="Honest by design" lead="Lifted from the README's limits, not written for this page." className="lp-honest">
      <div className="lp-quotes">
        {HONEST_QUOTES.map((q) => (
          <blockquote className="lp-q" key={q}>
            <p>{q}</p>
            <cite>README · Honest limits</cite>
          </blockquote>
        ))}
      </div>
    </Band>
  )
}

/** Six native disclosure questions. */
export function Faq() {
  const items = faqItems({ network: NETWORK_NAME, chainId: CHAIN_ID, isMainnet: CHAIN_ID === MAINNET_PROOF.chainId, fmt: fmtUsdc, windowS: RESPONSE_WINDOW_S })
  return (
    <Band id="faq" docket="Enquiries" title="Questions a judge would ask" className="lp-faq">
      <div>
        {items.map((it, i) => (
          <details key={it.q} open={i === 0}>
            <summary>{it.q}</summary>
            <p>{it.a}</p>
          </details>
        ))}
      </div>
    </Band>
  )
}

