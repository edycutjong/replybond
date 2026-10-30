import { ArrowRight, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from '@/components/NavLink'
import { CHAIN_ID, NETWORK_NAME, STUDIO_PROJECT_URL, addressUrl, CONTRACT } from '@/lib/appConfig'
import { REPO_URL } from '@/lib/proof'

/** Top bar: the mark, the configured network, in-page links and the way into the app. */
export function LandingNav() {
  return (
    <nav aria-label="Main">
      <a className="lp-mark" href="/" aria-label="ReplyBond, home">REPLYBOND</a>
      <span className="lp-cap lp-tag">{NETWORK_NAME} · chain {CHAIN_ID}</span>
      <span className="lp-sp" />
      <a className="lp-nl" href="#how">How it works</a>
      <a className="lp-nl" href="#proof">Mainnet proof</a>
      <a className="lp-nl" href="#faq">FAQ</a>
      <a className="lp-nl" href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
      <NavLink to="/app" className="lp-btn lp-sm">
        Open the app <ArrowRight size={16} aria-hidden />
      </NavLink>
    </nav>
  )
}

/** The closing bar. */
export function LandingFooter() {
  return (
    <footer>
      <div className="lp-w">
        <span className="lp-mark">REPLYBOND</span>
        <NavLink to="/app">Open the app</NavLink>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        {CONTRACT && (
          <a href={addressUrl(CONTRACT)} target="_blank" rel="noopener noreferrer">
            Contract on the explorer <ArrowUpRight size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />
          </a>
        )}
        <a href={STUDIO_PROJECT_URL} target="_blank" rel="noopener noreferrer">Arc Studio project</a>
      </div>
    </footer>
  )
}

/** A band with the docket tag and the big heading, as in the comp. */
export function Band({ id, docket, title, lead, className = '', children }: { id?: string; docket: string; title: string; lead?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`lp-band ${className}`} id={id}>
      <div className="lp-w">
        <div className="lp-sh">
          <p className="lp-docket">{docket}</p>
          <div>
            <h2>{title}</h2>
            {lead && <p>{lead}</p>}
          </div>
        </div>
        {children}
      </div>
    </section>
  )
}
