// "At this pace the 5-hour window is full at 21:40." Only offered while an account is actually being used, and
// only when it would run out before the window resets.

import type { UsageEta } from '@shared/types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export interface EtaInput {
  now: number
  /** Current 5-hour and weekly percent: the live estimate when there is one, else the latest record. */
  fiveHour?: number
  sevenDay?: number
  fiveHourResetsAt?: number
  sevenDayResetsAt?: number
  /** Recorded readings (desktop samples, terminal status line), any order. */
  points: Array<{ t: number; fh?: number; sd?: number }>
  /** Percent per usage unit learned by the estimate, when known. */
  rate?: { fh?: number; sd?: number }
  /** This account's replies (time, units) of the last hours. */
  events?: Array<{ t: number; u: number }>
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Replies within the last 15 minutes count as "in use"; a pace measured over less than 15 minutes is stretched to 15. */
const ACTIVE = 15 * MIN

function fiveHour(i: EtaInput): { at: number; perHour: number; basis: UsageEta['basis'] } | undefined {
  const cur = i.fiveHour
  if (cur === undefined || cur >= 100) return undefined
  let perMs: number | undefined
  let basis: UsageEta['basis'] = 'estimate'
  if (i.rate?.fh && i.events) {
    let units = 0
    let first = Infinity
    let last = -Infinity
    for (const e of i.events) {
      if (e.t <= i.now - 45 * MIN || e.t > i.now) continue
      units += e.u
      first = Math.min(first, e.t)
      last = Math.max(last, e.t)
    }
    // Known rate but no recent replies: the account is idle, so there is nothing to forecast.
    if (units <= 0 || last < i.now - ACTIVE) return undefined
    perMs = (i.rate.fh * units) / Math.max(ACTIVE, i.now - first)
  } else {
    basis = 'records'
    const pts = i.points.filter((p) => p.fh !== undefined && p.t > i.now - HOUR && p.t <= i.now).sort((a, b) => a.t - b.t)
    if (pts.length === 0) return undefined
    const newest = pts[pts.length - 1]
    if (newest.t < i.now - 20 * MIN) return undefined
    // Only readings after the last drop belong to the current window.
    let from = 0
    for (let k = 1; k < pts.length; k++) if (pts[k].fh! < pts[k - 1].fh!) from = k
    const anchor = pts[from]
    const span = i.now - anchor.t
    if (span < ACTIVE) return undefined
    perMs = (cur - anchor.fh!) / span
  }
  if (!perMs || perMs <= 0) return undefined
  const perHour = perMs * HOUR
  if (perHour < 1) return undefined
  const at = i.now + (100 - cur) / perMs
  if (i.fiveHourResetsAt ? at >= i.fiveHourResetsAt : at > i.now + 5 * HOUR) return undefined
  return { at: Math.round(at), perHour: round1(perHour), basis }
}

function sevenDay(i: EtaInput): { at: number; perHour: number } | undefined {
  const cur = i.sevenDay
  if (cur === undefined || cur >= 100) return undefined
  // A day of readings gives a pace that includes nights and breaks, which is what matters for a week.
  const pts = i.points.filter((p) => p.sd !== undefined && p.t > i.now - DAY && p.t <= i.now).sort((a, b) => a.t - b.t)
  if (pts.length < 2) return undefined
  let from = 0
  for (let k = 1; k < pts.length; k++) if (pts[k].sd! < pts[k - 1].sd! - 1) from = k
  const anchor = pts[from]
  const span = i.now - anchor.t
  if (span < 6 * HOUR) return undefined
  const perMs = (cur - anchor.sd!) / span
  if (perMs <= 0) return undefined
  const at = i.now + (100 - cur) / perMs
  // Without a known reset, only forecast what is close enough to be useful.
  if (i.sevenDayResetsAt ? at >= i.sevenDayResetsAt : at > i.now + 3 * DAY) return undefined
  return { at: Math.round(at), perHour: round1(perMs * HOUR) }
}

export function computeEta(i: EtaInput): UsageEta | undefined {
  const fh = fiveHour(i)
  const sd = sevenDay(i)
  if (!fh && !sd) return undefined
  return {
    fiveHourFullAt: fh?.at,
    fiveHourPerHour: fh?.perHour,
    sevenDayFullAt: sd?.at,
    sevenDayPerHour: sd?.perHour,
    basis: fh?.basis ?? 'records',
    at: i.now
  }
}
