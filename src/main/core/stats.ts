// The statistics page: the scanner's hourly buckets summed per day, model, project, conversation and account,
// with days and hours in the time zone the user chose.

import path from 'node:path'
import { resolveTimeZone } from '@shared/format'
import type { StatsConversation, StatsModel, StatsProject, StatsRange, TokenTotals, UsageStats } from '@shared/types'
import type { UsageBucket } from './estimate'
import { modelInfo, PRICE_LIST_DATE } from './pricing'

const HOUR = 3_600_000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export interface SessionInfo {
  title?: string
  cwd?: string
  projectDir?: string
  lastActivityAt?: number
}

export interface StatsContext {
  range: StatsRange
  accountId?: string
  now: number
  /** IANA zone, or "system". */
  timeZone: string
  /** Account a bucket's replies belong to ("" when unknown). */
  accountOf: (b: UsageBucket) => string
  session: (id: string) => SessionInfo
  partial: boolean
}

interface LocalTime {
  day: string
  hour: number
  /** 0 = Monday. */
  weekday: number
}

/** Calendar day, hour and weekday of a time in a zone; memoized per hour because buckets are hourly. */
export function zonedClock(timeZone: string | undefined): (t: number) => LocalTime {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short'
  })
  const memo = new Map<number, LocalTime>()
  return (t: number) => {
    const hit = memo.get(t)
    if (hit) return hit
    const p: Record<string, string> = {}
    for (const part of fmt.formatToParts(t)) p[part.type] = part.value
    const v = { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: Math.max(0, WEEKDAYS.indexOf(p.weekday)) }
    if (memo.size < 5000) memo.set(t, v)
    return v
  }
}

/** Milliseconds the zone is ahead of UTC at a time. */
function zoneOffset(t: number, timeZone: string | undefined): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(t)) p[part.type] = part.value
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second))
  return asUtc - Math.floor(t / 1000) * 1000
}

const zero = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const add = (t: TokenTotals, b: UsageBucket) => {
  t.input += b.i
  t.output += b.o
  t.cacheRead += b.r
  t.cacheWrite += b.w
}
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

export function computeStats(buckets: Iterable<UsageBucket>, ctx: StatsContext): UsageStats {
  const tz = resolveTimeZone(ctx.timeZone)
  const clock = zonedClock(tz)
  const n = ctx.range === '30d' ? 30 : 7

  // The days of the range, as calendar dates in the zone, oldest first.
  const today = clock(ctx.now).day
  const [y, m, d] = today.split('-').map(Number)
  const dayList: string[] = []
  for (let k = n - 1; k >= 0; k--) {
    const dt = new Date(Date.UTC(y, m - 1, d - k))
    dayList.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`)
  }
  const dayIndex = new Map(dayList.map((day, i) => [day, i]))
  const [fy, fm, fd] = dayList[0].split('-').map(Number)
  const from = Date.UTC(fy, fm - 1, fd) - zoneOffset(ctx.now, tz)

  const days = dayList.map((day) => ({ day, tokens: zero(), units: 0, costUsd: 0, replies: 0, byAccount: {} as Record<string, number> }))
  const totals = { tokens: zero(), units: 0, costUsd: 0, replies: 0, conversations: 0, activeDays: 0 }
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const models = new Map<string, StatsModel>()
  const sessions = new Map<string, { tokens: TokenTotals; units: number; costUsd: number; replies: number; last: number; accounts: Map<string, number> }>()
  const accounts = new Map<string, { units: number; costUsd: number; replies: number }>()

  for (const b of buckets) {
    if (b.h < from - 2 * HOUR) continue
    const local = clock(b.h)
    const di = dayIndex.get(local.day)
    if (di === undefined) continue
    const acct = ctx.accountOf(b)
    if (ctx.accountId && acct !== ctx.accountId) continue

    const day = days[di]
    add(day.tokens, b)
    day.units += b.u
    day.costUsd += b.c
    day.replies += b.n
    day.byAccount[acct] = (day.byAccount[acct] ?? 0) + b.u
    add(totals.tokens, b)
    totals.units += b.u
    totals.costUsd += b.c
    totals.replies += b.n
    heatmap[local.weekday][local.hour] += b.u

    const info = modelInfo(b.m)
    const mm = models.get(info.label) ?? { model: b.m, label: info.label, family: info.family, tokens: zero(), units: 0, costUsd: 0, replies: 0 }
    add(mm.tokens, b)
    mm.units += b.u
    mm.costUsd += b.c
    mm.replies += b.n
    models.set(info.label, mm)

    const s = sessions.get(b.s) ?? { tokens: zero(), units: 0, costUsd: 0, replies: 0, last: 0, accounts: new Map<string, number>() }
    add(s.tokens, b)
    s.units += b.u
    s.costUsd += b.c
    s.replies += b.n
    s.last = Math.max(s.last, b.t)
    s.accounts.set(acct, (s.accounts.get(acct) ?? 0) + b.u)
    sessions.set(b.s, s)

    const a = accounts.get(acct) ?? { units: 0, costUsd: 0, replies: 0 }
    a.units += b.u
    a.costUsd += b.c
    a.replies += b.n
    accounts.set(acct, a)
  }

  const projects = new Map<string, StatsProject>()
  const top: StatsConversation[] = []
  for (const [id, s] of sessions) {
    const info = ctx.session(id)
    const projectDir = info.projectDir ?? ''
    const key = (info.cwd ?? projectDir).toLowerCase()
    const name = info.cwd ? path.basename(info.cwd.replace(/[\\/]+$/, '')) || info.cwd : projectDir || '?'
    const p = projects.get(key) ?? { cwd: info.cwd, projectDir, name, units: 0, costUsd: 0, replies: 0, conversations: 0 }
    p.units += s.units
    p.costUsd += s.costUsd
    p.replies += s.replies
    p.conversations++
    projects.set(key, p)
    const mainAccount = [...s.accounts].sort((x, y) => y[1] - x[1])[0]?.[0]
    top.push({
      cliSessionId: id,
      title: info.title || id.slice(0, 8),
      cwd: info.cwd,
      accountId: mainAccount || undefined,
      tokens: s.tokens,
      units: r1(s.units),
      costUsd: r2(s.costUsd),
      replies: s.replies,
      lastActivityAt: Math.max(s.last, info.lastActivityAt ?? 0)
    })
  }

  totals.conversations = sessions.size
  totals.activeDays = days.filter((x) => x.replies > 0).length
  for (const day of days) {
    day.units = r1(day.units)
    day.costUsd = r2(day.costUsd)
    for (const k of Object.keys(day.byAccount)) day.byAccount[k] = r1(day.byAccount[k])
  }
  totals.units = r1(totals.units)
  totals.costUsd = r2(totals.costUsd)

  return {
    range: ctx.range,
    accountId: ctx.accountId,
    from,
    to: ctx.now,
    timeZone: tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    totals,
    days,
    models: [...models.values()].map((x) => ({ ...x, units: r1(x.units), costUsd: r2(x.costUsd) })).sort((a, b) => b.units - a.units),
    projects: [...projects.values()]
      .map((x) => ({ ...x, units: r1(x.units), costUsd: r2(x.costUsd) }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 12),
    heatmap: heatmap.map((row) => row.map(r1)),
    topConversations: top.sort((a, b) => b.units - a.units).slice(0, 10),
    byAccount: [...accounts].map(([accountId, v]) => ({ accountId, units: r1(v.units), costUsd: r2(v.costUsd), replies: v.replies })).sort((a, b) => b.units - a.units),
    pricing: { asOf: PRICE_LIST_DATE, currency: 'USD' },
    partial: ctx.partial,
    computedAt: ctx.now
  }
}
