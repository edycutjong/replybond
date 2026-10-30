import { ArrowUpRight } from 'lucide-react'
import { Postmark } from './Glyphs'
import { Band } from './Chrome'
import { CHAIN_ID, CONTRACT, NETWORK_NAME, STUDIO_PROJECT_URL, addressUrl, fmtUsdc, padId, shortHash, txUrl } from '@/lib/appConfig'
import { endingsStrip } from '@/lib/landingModel'
import { MAINNET_PROOF, proofSteps, sourcifyUrl } from '@/lib/proof'
import { RESPONSE_WINDOW_S } from '@/lib/terms'

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const
const Out = () => <ArrowUpRight size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />

/**
 * The proof block. On Arc mainnet (chain 5042): the three endings (jobs 5, 6 and 7), the six-line ledger and the contract.
 * On any other chain only the configured contract is shown.
 */
export function Proof() {
  const mainnet = CHAIN_ID === MAINNET_PROOF.chainId
  const address = mainnet ? MAINNET_PROOF.contract : CONTRACT
  if (!address) return null
  const j = MAINNET_PROOF.jobs
  return (
    <Band
      id="proof"
      docket="Ledger"
      title={mainnet ? 'Mainnet proof, line by line' : 'The contract'}
      className="lp-paper"
      lead={mainnet ? `One run through the live app on ${NETWORK_NAME}, covering all three endings (jobs ${j.acknowledge}, ${j.timeout} and ${j.claim}). Open any line on the explorer.` : `This deployment runs on ${NETWORK_NAME}.`}
    >
      {mainnet && (
        <>
          <div className="lp-ends" role="list" aria-label="The three endings, one real job each">
            {endingsStrip(fmtUsdc, RESPONSE_WINDOW_S).map((e) => (
              <div className="lp-end" role="listitem" key={e.key}>
                <p className="lp-cap">Job Nº</p>
                <p className="lp-no">{padId(String(e.jobId))}</p>
                <p className="lp-what">{e.text}</p>
                {e.mark === 'postmark' ? (
                  <Postmark lines={e.markLines} />
                ) : (
                  <div className="lp-rs" aria-hidden="true">{e.markLines[0]}<small>{e.markLines[1]}</small></div>
                )}
              </div>
            ))}
          </div>
          <div className="lp-ledger">
            {proofSteps(fmtUsdc).map((s) => (
              <div className={`lp-lr${s.name === 'timeout' ? ' lp-hot' : ''}`} key={s.name}>
                <span className="lp-m">{s.name}</span>
                <span className="lp-r">{s.result}</span>
                <a className="lp-data" href={txUrl(s.hash)} {...ext} title={s.hash}>{s.hash.slice(0, 10)}…{s.hash.slice(-4)} <Out /></a>
                <span className="lp-ok lp-data">status 1</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="lp-contract">
        <span>Contract <a className="lp-data" href={addressUrl(address)} {...ext} title={address}>{shortHash(address)} <Out /></a></span>
        {mainnet && <span><a href={sourcifyUrl(address)} {...ext}>Sourcify exact match <Out /></a></span>}
        {mainnet && (
          <span>
            Built in <a href={STUDIO_PROJECT_URL} {...ext}>Arc Studio</a> (opens with an Arc Studio login); mainnet deploy with <code className="lp-data">forge create</code> on the unchanged source
          </span>
        )}
      </div>
      <div className="lp-addr lp-data" tabIndex={0} aria-label="Full contract address">{address}</div>
    </Band>
  )
}
