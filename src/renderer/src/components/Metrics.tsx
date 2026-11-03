// Metric strip and the rolling number used in it.

import type { ReactNode } from 'react'

/** Digits roll to their new value; other characters ($ , . K M) stay put. Motion settings are respected by CSS. */
export function Rolling({ text }: { text: string }) {
  return (
    <span className="roll" aria-label={text}>
      {Array.from(text).map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={`${i}-${text.length}`} className="roll-digit" aria-hidden="true">
            <span className="roll-strip" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
              {DIGITS}
            </span>
          </span>
        ) : (
          <span key={`${i}-${text.length}`} aria-hidden="true">
            {ch}
          </span>
        )
      )}
    </span>
  )
}

const DIGITS = Array.from({ length: 10 }, (_, d) => <span key={d}>{d}</span>)

export interface MetricItem {
  label: ReactNode
  /** Formatted value, rolled digit by digit. */
  value: string
  unit?: string
  sub?: ReactNode
  tip?: string
}

export function MetricStrip({ items }: { items: MetricItem[] }) {
  return (
    <div className="metrics">
      {items.map((m, i) => (
        <div key={i} className="metric">
          <span className="metric-label">{m.label}</span>
          <span className="metric-value" title={m.tip}>
            <Rolling text={m.value} />
            {m.unit && <small>{m.unit}</small>}
          </span>
          {m.sub && <span className="metric-sub">{m.sub}</span>}
        </div>
      ))}
    </div>
  )
}
