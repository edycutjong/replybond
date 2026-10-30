import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const compact = css.replace(/\s+/g, ' ')

describe('landing styles', () => {
  it('sizes the receipt numerals, not their wrapper, by scoping the label rule to the label', () => {
    assert.ok(compact.includes('.lp-rc > span{display:block;font-size:15px'), 'label rule must target the direct child span only')
    assert.ok(!/\.lp-rc span\{/.test(compact), 'a descendant span rule would also match the digits inside <b>')
    assert.ok(/\.lp-rc b\{display:block;font:700 72px/.test(compact))
  })
  it('hides the clock digits once the stamp has landed, and puts the stamp on clean paper', () => {
    assert.ok(compact.includes('.lp-foil.lp-paid .lp-clock{opacity:0}'))
    const stamp = /\.lp-stamp\{[^}]*\}/.exec(compact)?.[0] ?? ''
    assert.ok(stamp.length > 0)
    assert.ok(!stamp.includes('mix-blend-mode'))
    assert.ok(/\.lp-stamp small\{[^}]*margin-top:5px/.test(compact))
  })
  it('keeps the torn stub inside the card and the stamp inside the clock area on a phone', () => {
    assert.ok(compact.includes('.lp-foil.lp-paid .lp-stub{transform:translate(-6px,10px) rotate(-2deg)'))
    assert.ok(compact.includes('.lp-foil.lp-paid .lp-stub{align-self:start;height:calc(100% - 34px)}'))
    assert.ok(/\.lp-clockarea\{min-height:84px/.test(compact))
  })
  it('gives every landing link and FAQ row a hover treatment, and none under reduced motion', () => {
    assert.ok(/\.lp a:not\(\.lp-btn\):not\(\.lp-nl\):not\(\.lp-mark\):hover\{color:var\(--after\)/.test(compact))
    assert.ok(/\.lp footer a:not\(\.lp-btn\):not\(\.lp-nl\):not\(\.lp-mark\):hover[^{]*\{color:#ff8a73\}/.test(compact), 'links on the dark bands turn to a light tint of the stamp colour')
    assert.ok(compact.includes('.lp-faq summary:hover{color:var(--before);background-color:rgba(45,82,160,.06)}'))
    assert.ok(compact.includes('transition:color .15s ease-out'))
    assert.ok(/@media \(prefers-reduced-motion:reduce\)\{\.lp \*\{animation:none!important;transition:none!important\}/.test(compact))
  })
})
