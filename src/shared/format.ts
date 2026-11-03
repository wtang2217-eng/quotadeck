// Formatting helpers shared by the main process (tray, notifications, status line) and the renderer.

import type { Account, Language, UsageSnapshot } from './types'

export const DEFAULT_COLORS = ['#7C5CFF', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#EC4899', '#14B8A6', '#8B5CF6']

export function resolveTimeZone(tz: string | undefined): string | undefined {
  if (!tz || tz === 'system') return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return undefined
  }
}

/** "14:05" for today, "11/04 14:05" for other days, in the chosen time zone. */
export function formatClock(ts: number, tz: string | undefined, lang: Language, now = Date.now()): string {
  const timeZone = resolveTimeZone(tz)
  const day = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t)
  const time = new Intl.DateTimeFormat(lang === 'zh-CN' ? 'zh-CN' : 'en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(ts)
  if (day(ts) === day(now)) return time
  const date = new Intl.DateTimeFormat(lang === 'zh-CN' ? 'zh-CN' : 'en-US', { timeZone, month: '2-digit', day: '2-digit' }).format(ts)
  return `${date} ${time}`
}

/** Full date and time, for tooltips and the activity log. */
export function formatDateTime(ts: number, tz: string | undefined, lang: Language): string {
  return new Intl.DateTimeFormat(lang === 'zh-CN' ? 'zh-CN' : 'en-US', {
    timeZone: resolveTimeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(ts)
}

/** "2h 13m" / "2小时13分" for a duration in ms. */
export function formatDuration(ms: number, lang: Language): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (lang === 'zh-CN') {
    if (d > 0) return h > 0 ? `${d}天${h}小时` : `${d}天`
    if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`
    return `${m}分钟`
  }
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

/** "3 minutes ago" / "3分钟前". */
export function formatAgo(ts: number, lang: Language, now = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return lang === 'zh-CN' ? '刚刚' : 'just now'
  const text = formatDuration(diff, lang)
  return lang === 'zh-CN' ? `${text}前` : `${text} ago`
}

/** "in 2h 13m" / "2小时13分后". */
export function formatIn(ts: number, lang: Language, now = Date.now()): string {
  const text = formatDuration(ts - now, lang)
  return lang === 'zh-CN' ? `${text}后` : `in ${text}`
}

export function maskEmail(email: string | undefined): string {
  if (!email) return ''
  const at = email.indexOf('@')
  if (at <= 0) return email
  const name = email.slice(0, at)
  const shown = name.length <= 3 ? name.slice(0, 1) : name.slice(0, 3)
  return `${shown}***${email.slice(at)}`
}

/** Short name for an account: nickname, then email, then a short id. */
export function accountName(a: Pick<Account, 'nickname' | 'email' | 'displayName' | 'id'>): string {
  return a.nickname || a.email || a.displayName || a.id.slice(0, 8)
}

/** Highest of the two windows, i.e. how close the account is to being blocked. */
export function peakPct(u: UsageSnapshot | undefined): number | undefined {
  if (!u) return undefined
  const values = [u.fiveHour?.pct, u.sevenDay?.pct].filter((v): v is number => typeof v === 'number')
  return values.length ? Math.max(...values) : undefined
}

export function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.min(100, Math.max(0, p))
}
