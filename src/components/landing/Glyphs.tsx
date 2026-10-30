import { ArrowRight } from 'lucide-react'
// Inline SVG glyphs and the hero texture: no image requests, no dependencies.
export const GLYPH = {
  post: (
    <svg className="lp-gl" viewBox="0 0 48 36" aria-hidden="true"><rect x="2" y="4" width="44" height="28" /><path d="M2 4l22 16L46 4" /><circle cx="24" cy="24" r="5" fill="#C2361F" stroke="none" /></svg>
  ),
  accept: (
    <svg className="lp-gl" viewBox="0 0 48 36" aria-hidden="true"><rect x="6" y="2" width="36" height="32" /><path d="M24 8v10l7 5" /><path d="M6 10h-4M6 26h-4M42 10h4M42 26h4" /></svg>
  ),
  respond: (
    <svg className="lp-gl" viewBox="0 0 48 36" aria-hidden="true"><path d="M10 2h22l8 8v24H10z" /><path d="M32 2v8h8M16 16h18M16 22h18M16 28h10" /></svg>
  ),
  timeout: (
    <svg className="lp-gl" viewBox="0 0 48 36" aria-hidden="true"><path d="M12 2h24M12 34h24M14 2c0 10 10 12 10 16S14 24 14 34M34 2c0 10-10 12-10 16s10 6 10 16" /><path d="M4 30l40-24" stroke="#C2361F" /></svg>
  ),
  paid: (
    <svg className="lp-gl" viewBox="0 0 48 36" aria-hidden="true"><path d="M2 8q6-6 12 0t12 0 12 0 8 0M2 16q6-6 12 0t12 0 12 0 8 0" /><path d="M14 26l6 6 14-12" /></svg>
  ),
}

/** The round ink postmark used for the two provider-paid endings. */
export function Postmark({ lines }: { lines: [string, string] }) {
  // Longer lines (BUYER SILENT) get a smaller size so they stay inside the inner ring.
  const size = Math.max(lines[0].length, lines[1].length) > 9 ? 12.5 : 15
  return (
    <svg className="lp-pmk" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="56" />
      <circle cx="60" cy="60" r="40" />
      <text x="60" y="56" textAnchor="middle" fontSize={size} letterSpacing="1">{lines[0]}</text>
      <text x="60" y="76" textAnchor="middle" fontSize={size} letterSpacing="1">{lines[1]}</text>
    </svg>
  )
}

/** A small turn stamp for the Studio timeline. */
export function TurnStamp({ tag, no }: { tag: string; no: string }) {
  return (
    <svg className="lp-pm" viewBox="0 0 92 54" aria-hidden="true">
      <rect x="2" y="2" width="88" height="50" />
      <rect x="7" y="7" width="78" height="40" />
      <text x="46" y="24" textAnchor="middle" fontSize="12" letterSpacing="2">{tag}</text>
      <text x="46" y="42" textAnchor="middle" fontSize="17">{no}</text>
    </svg>
  )
}

/** Faint wave and ring texture behind the hero (the ring text names the configured network). */
export function HeroTexture({ ring }: { ring: string }) {
  return (
    <div className="lp-tex" aria-hidden="true">
      <svg viewBox="0 0 980 520" fill="none">
        <defs>
          <pattern id="lp-wv" width="120" height="24" patternUnits="userSpaceOnUse"><path d="M0 12 Q30 0 60 12 T120 12" stroke="#B8C3D3" strokeWidth="2" /></pattern>
          <path id="lp-ring" d="M690 260 m-150 0 a150 150 0 1 1 300 0 a150 150 0 1 1 -300 0" />
        </defs>
        <rect x="0" y="40" width="980" height="130" fill="url(#lp-wv)" opacity=".8" />
        <circle cx="690" cy="260" r="178" stroke="#B8C3D3" strokeWidth="3" />
        <circle cx="690" cy="260" r="122" stroke="#B8C3D3" strokeWidth="2" />
        <text fontFamily="Antonio" fontSize="26" letterSpacing="9" fill="#B8C3D3"><textPath href="#lp-ring">{ring}</textPath></text>
      </svg>
    </div>
  )
}

/** A tape line with its arrow drawn as an icon: the data font has no arrow glyph, so the text would fall back to another font. */
export function TapeText({ text }: { text: string }) {
  const [a, b] = text.split(' → ')
  if (b === undefined) return <>{text}</>
  return (
    <>
      {a} <ArrowRight size={13} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />
      <span className="lp-sr">to</span> {b}
    </>
  )
}
