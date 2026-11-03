// Stacked bar chart drawn as SVG: one column per day (or hour), one segment per series, hover for the breakdown.

import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface Series {
  id: string
  label: string
  /** CSS color, usually a token such as var(--accent). */
  color: string
}

export interface Column {
  key: string
  /** Axis label under the column; empty to skip. */
  label: string
  /** Title of the hover card. */
  title: string
  values: Record<string, number>
}

const PAD_LEFT = 46
const PAD_BOTTOM = 22
const PAD_TOP = 8

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * p
}

export function StackedBars({
  series,
  columns,
  height = 190,
  format,
  axis = format,
  empty
}: {
  series: Series[]
  columns: Column[]
  height?: number
  /** Values in the hover card. */
  format: (v: number) => string
  /** Values on the axis; defaults to `format`. */
  axis?: (v: number) => string
  empty?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const totals = columns.map((c) => series.reduce((s, x) => s + (c.values[x.id] ?? 0), 0))
  const max = niceMax(Math.max(0, ...totals))
  const innerW = w - PAD_LEFT
  const innerH = height - PAD_BOTTOM - PAD_TOP
  const slot = innerW / Math.max(1, columns.length)
  const barW = Math.max(4, Math.min(28, slot * 0.56))
  const y = (v: number) => PAD_TOP + innerH - (v / max) * innerH
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const hasData = totals.some((v) => v > 0)

  return (
    <div className={`chart${hover !== null ? ' dim' : ''}`} ref={ref}>
      <svg width={w} height={height} role="img" onMouseLeave={() => setHover(null)}>
        {ticks.map((tv, i) => (
          <g key={i}>
            <line className={i === 0 ? 'chart-base' : 'chart-grid'} x1={PAD_LEFT} x2={w} y1={y(tv)} y2={y(tv)} />
            <text className="chart-axis" x={PAD_LEFT - 10} y={y(tv) + 4} textAnchor="end">
              {axis(tv)}
            </text>
          </g>
        ))}
        {columns.map((c, i) => {
          const x = PAD_LEFT + i * slot
          let acc = 0
          const segs = series
            .map((s) => ({ s, v: c.values[s.id] ?? 0 }))
            .filter((p) => p.v > 0)
          return (
            <g key={c.key} onMouseEnter={() => setHover(i)}>
              <rect className={`chart-col${hover === i ? ' on' : ''}`} x={x} y={PAD_TOP} width={slot} height={innerH} rx={4} />
              {segs.map((p, j) => {
                const y0 = y(acc)
                acc += p.v
                const y1 = y(acc)
                const top = j === segs.length - 1
                const h = Math.max(0, y0 - y1)
                return (
                  <path
                    key={p.s.id}
                    className={`chart-bar${hover === i ? ' on' : ''}`}
                    d={top && h > 2 ? roundTop(x + (slot - barW) / 2, y1, barW, h, 2) : `M${x + (slot - barW) / 2},${y1}h${barW}v${h}h${-barW}z`}
                    fill={p.s.color}
                  />
                )
              })}
              {c.label && (
                <text className="chart-axis" x={x + slot / 2} y={height - 6} textAnchor="middle">
                  {c.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {!hasData && empty && <div className="chart-empty">{empty}</div>}
      {hover !== null && columns[hover] && hasData && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(0, PAD_LEFT + hover * slot + slot / 2 - 100), w - 200),
            top: 4
          }}
        >
          <div className="chart-tip-head">
            <span>{columns[hover].title}</span>
            <b>{format(totals[hover])}</b>
          </div>
          {series
            .filter((s) => (columns[hover].values[s.id] ?? 0) > 0)
            .map((s) => (
              <div key={s.id} className="chart-tip-row">
                <span className="legend-swatch" style={{ background: s.color }} />
                <span className="ellipsis">{s.label}</span>
                <span>{format(columns[hover].values[s.id] ?? 0)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function roundTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.id} className="legend-item">
          <span className="legend-swatch" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

/** Neutral steps for series; the first color can be the accent (the desktop account). */
export const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
