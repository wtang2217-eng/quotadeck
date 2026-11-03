import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatClock } from '@shared/format'
import type { Language, UsagePoint } from '@shared/types'

const DAY = 86_400_000
const H = 46
const PAD_TOP = 4
const PAD_BOTTOM = 3

type P = { x: number; y: number }

/** Monotone cubic interpolation (Fritsch–Carlson) so the curve never overshoots 0–100. */
function smoothPath(pts: P[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  const n = pts.length
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-6
    slope[i] = (pts[i + 1].y - pts[i].y) / dx[i]
  }
  const m: number[] = [slope[0]]
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0
    else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])
    }
  }
  m[n - 1] = slope[n - 2]
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3
    const c1y = pts[i].y + (m[i] * dx[i]) / 3
    const c2x = pts[i + 1].x - dx[i] / 3
    const c2y = pts[i + 1].y - (m[i + 1] * dx[i]) / 3
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`
  }
  return d
}

/** 7-day trend: the 5-hour window as a filled curve, the weekly window as a dashed line. */
export function Sparkline({
  points,
  color,
  now,
  lang,
  tz,
  labels
}: {
  points: UsagePoint[]
  color: string
  now: number
  lang: Language
  tz: string
  labels: { fh: string; sd: string; empty: string }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(300)
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setW(Math.max(80, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    const start = now - 7 * DAY
    const inRange = points.filter((p) => p.t >= start && p.t <= now + 60_000)
    const buckets = Math.max(12, Math.min(90, Math.floor(w / 4)))
    const size = (now - start) / buckets
    const out: { t: number; fh?: number; sd?: number }[] = []
    for (let b = 0; b < buckets; b++) {
      const from = start + b * size
      const to = from + size
      const slice = inRange.filter((p) => p.t >= from && (b === buckets - 1 ? p.t <= to + 60_000 : p.t < to))
      if (!slice.length) continue
      const fhVals = slice.map((p) => p.fh).filter((v): v is number => typeof v === 'number')
      const sdVals = slice.map((p) => p.sd).filter((v): v is number => typeof v === 'number')
      out.push({
        t: slice[slice.length - 1].t,
        fh: fhVals.length ? Math.max(...fhVals) : undefined,
        sd: sdVals.length ? sdVals[sdVals.length - 1] : undefined
      })
    }
    const x = (t: number) => ((t - start) / (now - start)) * (w - 6) + 3
    const y = (v: number) => PAD_TOP + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - PAD_TOP - PAD_BOTTOM)
    const fh = out.filter((p) => p.fh !== undefined).map((p) => ({ x: x(p.t), y: y(p.fh!), t: p.t, v: p.fh!, sd: p.sd }))
    const sd = out.filter((p) => p.sd !== undefined).map((p) => ({ x: x(p.t), y: y(p.sd!) }))
    return { fh, sd, y }
  }, [points, now, w])

  if (data.fh.length < 2 && data.sd.length < 2) {
    return (
      <div ref={ref}>
        <div className="spark-empty">{labels.empty}</div>
      </div>
    )
  }

  const line = smoothPath(data.fh)
  const area = data.fh.length > 1 ? `${line} L${data.fh[data.fh.length - 1].x.toFixed(1)},${H} L${data.fh[0].x.toFixed(1)},${H} Z` : ''
  const weekly = smoothPath(data.sd)
  const last = data.fh[data.fh.length - 1]
  const hovered = hover !== null ? data.fh[hover] : undefined

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        className="spark"
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = e.clientX - rect.left
          let best = 0
          for (let i = 1; i < data.fh.length; i++) if (Math.abs(data.fh[i].x - px) < Math.abs(data.fh[best].x - px)) best = i
          setHover(best)
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
      >
        <defs>
          <linearGradient id={`area-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.32" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={w} y1={data.y(100)} y2={data.y(100)} stroke="var(--border)" strokeDasharray="2 4" />
        <line x1="0" x2={w} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} stroke="var(--border)" />
        {area && <path className="spark-area" d={area} fill={`url(#area-${gid})`} />}
        {weekly && (
          <path
            d={weekly}
            fill="none"
            stroke="var(--text-3)"
            strokeWidth="1.4"
            strokeDasharray="3 3"
            opacity="0.8"
            strokeLinecap="round"
          />
        )}
        {line && (
          <path
            className="spark-line"
            d={line}
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {last && (
          <g>
            <circle className="spark-halo" cx={last.x} cy={last.y} r="3.5" fill={color} />
            <circle className="spark-dot" cx={last.x} cy={last.y} r="3.2" fill={color} stroke="var(--panel)" strokeWidth="1.6" />
          </g>
        )}
        {hovered && (
          <g>
            <line x1={hovered.x} x2={hovered.x} y1={0} y2={H} stroke="var(--text-3)" strokeWidth="1" opacity="0.5" />
            <circle cx={hovered.x} cy={hovered.y} r="3" fill={color} stroke="var(--panel)" strokeWidth="1.5" />
          </g>
        )}
      </svg>
      {hovered && (
        <div
          style={{
            position: 'absolute',
            bottom: H + 4,
            left: Math.min(Math.max(0, hovered.x - 70), w - 150),
            width: 150,
            padding: '5px 8px',
            borderRadius: 8,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow)',
            fontSize: 11.5,
            color: 'var(--text-2)',
            pointerEvents: 'none',
            textAlign: 'center',
            zIndex: 2
          }}
        >
          <div style={{ color: 'var(--text-3)' }}>{formatClock(hovered.t, tz, lang, now + 7 * DAY)}</div>
          <div>
            <b style={{ color: 'var(--text)' }}>{labels.fh}</b> {Math.round(hovered.v)}%
            {hovered.sd !== undefined && (
              <>
                {' · '}
                <b style={{ color: 'var(--text)' }}>{labels.sd}</b> {Math.round(hovered.sd)}%
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
