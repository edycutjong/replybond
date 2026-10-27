import { ConnectKitButton } from 'connectkit'
import { ExternalLink } from 'lucide-react'
import { CONTRACT, NETWORK_NAME, STUDIO_PROJECT_URL, addressUrl, shortHash } from '@/lib/appConfig'

export function Header() {
  return (
    <header className="pt-5 sm:pt-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(34px, 6vw, 44px)', fontWeight: 600, letterSpacing: '0.02em', lineHeight: 1 }}>REPLYBOND</h1>
          <p className="mt-1 text-[15px] sm:text-[17px]" style={{ color: 'var(--muted)' }}>Pay an API, get paid back if it misses its deadline.</p>
        </div>
        <ConnectKitButton.Custom>
          {({ isConnected, show, truncatedAddress }) => (
            <button className="btn" onClick={show}>
              {isConnected ? truncatedAddress : 'Connect wallet'}
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
        <span>
          Contract{' '}
          {CONTRACT ? (
            <a className="link data" href={addressUrl(CONTRACT)} target="_blank" rel="noopener noreferrer" title={CONTRACT}>
              {shortHash(CONTRACT)} <ExternalLink size={13} className="inline -mt-1" aria-hidden />
            </a>
          ) : (
            <span style={{ color: 'var(--after)' }}>not configured (set VITE_REPLYBOND_ADDRESS)</span>
          )}
        </span>
        <span className="label" style={{ border: '1px solid var(--rule)', padding: '2px 8px', background: 'var(--card)' }}>
          {NETWORK_NAME}
        </span>
        <a className="link" href={STUDIO_PROJECT_URL} target="_blank" rel="noopener noreferrer">
          Arc Studio project <ExternalLink size={13} className="inline -mt-1" aria-hidden />
        </a>
      </p>
    </header>
  )
}
