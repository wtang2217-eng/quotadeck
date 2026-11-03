// Appearance pickers: the three styles as small specimens, and the Swiss highlight color as swatches.

import type { MouseEvent } from 'react'
import type { AccentChoice, UiStyle } from '@shared/types'
import type { TKey } from '../i18n'
import { useApp } from '../context'
import { revealTheme } from '../util'

const STYLES: { value: UiStyle; name: TKey; hint: TKey }[] = [
  { value: 'swiss', name: 'styleSwiss', hint: 'styleSwissHint' },
  { value: 'editorial', name: 'styleEditorial', hint: 'styleEditorialHint' },
  { value: 'eclipse', name: 'styleEclipse', hint: 'styleEclipseHint' }
]

export const ACCENTS: { value: AccentChoice; color: string; name: TKey }[] = [
  { value: 'ikb', color: '#002FA7', name: 'accentIkb' },
  { value: 'lemon', color: '#FFD500', name: 'accentLemon' },
  { value: 'green', color: '#C5E803', name: 'accentGreen' },
  { value: 'orange', color: '#FF6B35', name: 'accentOrange' }
]

/** Apply a style change at once (with the circular reveal), then save it. */
function applyLook(e: MouseEvent, attr: 'style' | 'accent', value: string, save: () => void): void {
  revealTheme(
    () => {
      document.documentElement.dataset[attr] = value
    },
    e.clientX,
    e.clientY
  )
  save()
}

export function StylePicker({ value, onChange }: { value: UiStyle; onChange: (v: UiStyle) => void }) {
  const { t } = useApp()
  return (
    <div className="style-picker" role="radiogroup" aria-label={t('setStyle')}>
      {STYLES.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={value === s.value}
          className={`style-opt${value === s.value ? ' on' : ''}`}
          onClick={(e) => value !== s.value && applyLook(e, 'style', s.value, () => onChange(s.value))}
        >
          <span className={`specimen specimen-${s.value}`} aria-hidden="true">
            <span className="specimen-rule" />
            <span className="specimen-label">5H</span>
            <span className="specimen-num">
              27<i>%</i>
            </span>
            <span className="specimen-meter">
              <span />
            </span>
          </span>
          <span className="style-opt-name">{t(s.name)}</span>
          <span className="style-opt-hint">{t(s.hint)}</span>
        </button>
      ))}
    </div>
  )
}

export function AccentPicker({ value, onChange, disabled }: { value: AccentChoice; onChange: (v: AccentChoice) => void; disabled?: boolean }) {
  const { t } = useApp()
  return (
    <div className={`accent-picker${disabled ? ' disabled' : ''}`} role="radiogroup" aria-label={t('setAccent')}>
      {ACCENTS.map((a) => (
        <button
          key={a.value}
          type="button"
          role="radio"
          aria-checked={value === a.value}
          disabled={disabled}
          className={`accent-opt${value === a.value ? ' on' : ''}`}
          onClick={(e) => value !== a.value && applyLook(e, 'accent', a.value, () => onChange(a.value))}
        >
          <span className="accent-chip" style={{ background: a.color }} />
          <span className="accent-name">{t(a.name)}</span>
        </button>
      ))}
    </div>
  )
}
