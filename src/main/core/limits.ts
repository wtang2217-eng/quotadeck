// Understands the limit messages Claude Code shows, e.g.
//   "You've hit your session limit · resets 11:10pm (America/Chicago)"
//   "You've hit your weekly limit · resets Sep 24, 11am (America/Chicago)"
//   "Claude AI usage limit reached|1760000000"   (older versions: epoch seconds)

import type { LimitKind } from '@shared/types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export interface ParsedLimit {
  kind: LimitKind
  resetsAt?: number
}

export function limitKindOf(text: string): LimitKind {
  if (/weekly|7-day|seven[\s_-]?day/i.test(text)) return 'weekly'
  if (/session|5-hour|five[\s_-]?hour/i.test(text)) return 'session'
  return 'unknown'
}

/** True for messages that mean "this account is out of usage", as opposed to transient rate limiting. */
export function isUsageLimitMessage(text: string): boolean {
  return /hit your (session |weekly |opus |sonnet )?limit|usage limit reached|limit reached\s*[∙·]|out of (extra )?usage/i.test(text)
}

export function parseLimitMessage(text: string, now = Date.now()): ParsedLimit | undefined {
  if (!text) return undefined
  const kind = limitKindOf(text)

  const epoch = /usage limit reached\|(\d{10,13})/i.exec(text)
  if (epoch) {
    const n = Number(epoch[1])
    return { kind, resetsAt: n < 1e12 ? n * 1000 : n }
  }

  const m = /resets\s+(?:at\s+)?(?:(?<mon>[A-Za-z]{3,9})\.?\s+(?<day>\d{1,2}),?\s+(?:at\s+)?)?(?<h>\d{1,2})(?::(?<mi>\d{2}))?\s*(?<ap>am|pm)?\s*(?:\((?<tz>[^)]+)\))?/i.exec(text)
  if (!m?.groups) return isUsageLimitMessage(text) ? { kind } : undefined

  const g = m.groups
  let hour = Number(g.h)
  const minute = g.mi ? Number(g.mi) : 0
  if (g.ap) {
    const pm = g.ap.toLowerCase() === 'pm'
    if (hour === 12) hour = pm ? 12 : 0
    else if (pm) hour += 12
  }
  if (hour > 23 || minute > 59) return { kind }

  const tz = validTimeZone(g.tz?.trim())
  const today = partsIn(now, tz)
  let resetsAt: number
  if (g.mon && g.day) {
    const month = MONTHS.indexOf(g.mon.slice(0, 3).toLowerCase())
    if (month < 0) return { kind }
    resetsAt = zonedToEpoch(today.y, month, Number(g.day), hour, minute, tz)
    // "Jan 2" seen in late December means next year.
    if (resetsAt < now - 180 * 86_400_000) resetsAt = zonedToEpoch(today.y + 1, month, Number(g.day), hour, minute, tz)
  } else {
    resetsAt = zonedToEpoch(today.y, today.mo, today.d, hour, minute, tz)
    if (resetsAt < now - 60_000) resetsAt = zonedToEpoch(today.y, today.mo, today.d + 1, hour, minute, tz)
  }
  return { kind, resetsAt }
}

function validTimeZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return undefined
  }
}

interface WallParts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
}

function partsIn(ts: number, tz: string | undefined): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(ts)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { y: get('year'), mo: get('month') - 1, d: get('day'), h: get('hour') % 24, mi: get('minute') }
}

/** Epoch ms of a wall-clock time in a time zone (system zone when tz is undefined). */
export function zonedToEpoch(y: number, mo: number, d: number, h: number, mi: number, tz: string | undefined): number {
  const target = Date.UTC(y, mo, d, h, mi)
  let guess = target
  for (let i = 0; i < 4; i++) {
    const p = partsIn(guess, tz)
    const diff = Date.UTC(p.y, p.mo, p.d, p.h, p.mi) - target
    if (diff === 0) break
    guess -= diff
  }
  return guess
}
