import { fmtUsdc } from '@/lib/appConfig'
import { BOND_CHOICES, WINDOW_CHOICES_S, bondOf, payoutLine } from '@/lib/terms'
import type { BondChoice, WindowChoice } from '@/lib/terms'

/** Two compact segmented controls (deadline and bond) and the payout they imply. */
export function TermsPicker({ windowS, bond, onChange, disabled, idPrefix }: { windowS: WindowChoice; bond: BondChoice; onChange: (t: { windowS: WindowChoice; bond: BondChoice }) => void; disabled?: boolean; idPrefix: string }) {
  const seg = <T extends string | number>(label: string, name: string, options: readonly T[], value: T, show: (v: T) => string, set: (v: T) => void) => (
    <div role="radiogroup" aria-labelledby={`${idPrefix}-${name}`} className="flex flex-wrap items-center gap-2">
      <span id={`${idPrefix}-${name}`} className="label">{label}</span>
      <span className="inline-flex" style={{ border: '1px solid var(--rule)' }}>
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            role="radio"
            aria-checked={o === value}
            disabled={disabled}
            onClick={() => set(o)}
            className="data text-[13px]"
            style={{ minHeight: 44, minWidth: 52, padding: '0 10px', background: o === value ? 'var(--ink)' : 'transparent', color: o === value ? 'var(--card)' : 'var(--ink)', cursor: disabled ? 'not-allowed' : 'pointer' }}
          >
            {show(o)}
          </button>
        ))}
      </span>
    </div>
  )
  return (
    <div className="mt-3 grid gap-2">
      {seg('Deadline', 'window', WINDOW_CHOICES_S, windowS, (v) => `${v} s`, (v) => onChange({ windowS: v, bond }))}
      {seg('Bond', 'bond', BOND_CHOICES, bond, (v) => v, (v) => onChange({ windowS, bond: v }))}
      <p className="data wrap text-[14px]" role="status" aria-live="polite">{payoutLine(fmtUsdc, bondOf(bond))}</p>
    </div>
  )
}
