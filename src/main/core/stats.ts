// The statistics page and the CSV export: the ledger summed per day, hour, model, project, conversation and
// account, with days and hours in the time zone the user chose.

import { resolveTimeZone } from '@shared/format'
import type { StatsAccount, StatsConversation, StatsModel, StatsProject, StatsRange, TokenTotals, UsageStats } from '@shared/types'
import type { LedgerEntry } from './ledger'
import { modelInfo, priceOf, PRICE_LIST_DATE, PRICE_SOURCE, US_ONLY_MULTIPLIER, WEB_SEARCH_USD } from './pricing'

const HOUR = 3_600_000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export interface SessionInfo {
  title?: string
  cwd?: string
  projectDir?: string
  lastActivityAt?: number
}

export interface AccountLabel {
  label: string
  email?: string
  kind: StatsAccount['kind']
  orgUuid?: string
}

export interface StatsContext {
  range: StatsRange
  /** "all", one account id, "org:<uuid>", or "" (unknown accounts). */
  accountId: string
  now: number
  /** IANA zone, or "system". */
  timeZone: string
  /** Row an entry belongs to: an account id, "org:<uuid>", or "" when unknown. */
  accountOf: (e: LedgerEntry) => string
  accountLabel: (id: string) => AccountLabel
  session: (id: string) => SessionInfo
  partial: boolean
  /** The "list prices, for reference only" sentence in the UI language. */
  note: string
}

interface LocalTime {
  day: string
  month: string
  hour: number
  /** 0 = Monday. */
  weekday: number
}

/** Calendar day, hour and weekday of a time in a zone; memoized because entries are hourly. */
export function zonedClock(timeZone: string | undefined): (t: number) => LocalTime {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const memo = new Map<number, LocalTime>()
  return (t: number) => {
    const hit = memo.get(t)
    if (hit) return hit
    const p: Record<string, string> = {}
    for (const part of fmt.formatToParts(t)) p[part.type] = part.value
    const v = { day: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, hour: Number(p.hour) % 24, weekday: Math.max(0, WEEKDAYS.indexOf(p.weekday)) }
    if (memo.size < 100_000) memo.set(t, v)
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

/** Calendar days from `first` to `last` (both YYYY-MM-DD), inclusive. */
function dayRange(first: string, last: string): string[] {
  const [y, m, d] = first.split('-').map(Number)
  const out: string[] = []
  for (let k = 0; out.length < 20_000; k++) {
    const dt = new Date(Date.UTC(y, m - 1, d + k))
    const day = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
    out.push(day)
    if (day >= last) break
  }
  return out
}

function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + by))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export const zeroTokens = (): TokenTotals => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 })
export function addTokens(t: TokenTotals, e: Pick<LedgerEntry, 'i' | 'o' | 'w5' | 'w1' | 'r'>): void {
  t.input += e.i
  t.output += e.o
  t.cacheWrite5m += e.w5
  t.cacheWrite1h += e.w1
  t.cacheRead += e.r
}
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

interface Acc {
  tokens: TokenTotals
  costUsd: number
  requests: number
  units: number
}
const acc = (): Acc => ({ tokens: zeroTokens(), costUsd: 0, requests: 0, units: 0 })
const add = (x: Acc, e: LedgerEntry) => {
  addTokens(x.tokens, e)
  x.costUsd += e.c
  x.requests += e.n
  x.units += e.u
}
const done = <T extends Acc>(x: T): T => ({ ...x, costUsd: r2(x.costUsd), units: r1(x.units) })

export function computeStats(entries: Iterable<LedgerEntry>, ctx: StatsContext): UsageStats {
  const tz = resolveTimeZone(ctx.timeZone)
  const clock = zonedClock(tz)
  const all = ctx.accountId === 'all' || ctx.accountId === undefined
  const nowLocal = clock(ctx.now)
  const today = nowLocal.day

  // Entries of the chosen account, and the first day anything was recorded.
  const mine: LedgerEntry[] = []
  let firstDay: string | undefined
  const fixed = { todayUsd: 0, monthUsd: 0, allTimeUsd: 0 }
  for (const e of entries) {
    const a = ctx.accountOf(e)
    if (!all && a !== ctx.accountId) continue
    mine.push(e)
    const local = clock(e.h)
    if (!firstDay || local.day < firstDay) firstDay = local.day
    fixed.allTimeUsd += e.c
    if (local.month === nowLocal.month) fixed.monthUsd += e.c
    if (local.day === today) fixed.todayUsd += e.c
  }

  const span = ctx.range === 'today' ? 1 : ctx.range === '7d' ? 7 : ctx.range === '30d' ? 30 : ctx.range === '90d' ? 90 : undefined
  const firstShown = span ? shiftDay(today, -(span - 1)) : (firstDay && firstDay < today ? firstDay : today)
  const dayList = dayRange(firstShown, today)
  const dayIndex = new Map(dayList.map((d, i) => [d, i]))
  const [fy, fm, fd] = dayList[0].split('-').map(Number)
  const from = Date.UTC(fy, fm - 1, fd) - zoneOffset(ctx.now, tz)

  const days = dayList.map((day) => ({ day, ...acc(), byAccount: {} as Record<string, number> }))
  const hours = ctx.range === 'today' ? Array.from({ length: 24 }, (_, hour) => ({ hour, tokens: zeroTokens(), costUsd: 0, requests: 0 })) : undefined
  const totals = acc()
  let webSearches = 0
  const background = { tokens: zeroTokens(), costUsd: 0, webSearches: 0 }
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const models = new Map<string, StatsModel>()
  const sessions = new Map<string, Acc & { last: number; accounts: Map<string, number> }>()
  const accounts = new Map<string, Acc & { sessions: Set<string> }>()

  for (const e of mine) {
    if (e.h < from - 2 * HOUR) continue
    const local = clock(e.h)
    const di = dayIndex.get(local.day)
    if (di === undefined) continue
    const a = ctx.accountOf(e)
    const day = days[di]
    add(day, e)
    day.byAccount[a] = (day.byAccount[a] ?? 0) + e.c
    if (hours && local.day === today) {
      const h = hours[local.hour]
      addTokens(h.tokens, e)
      h.costUsd += e.c
      h.requests += e.n
    }
    add(totals, e)
    webSearches += e.ws ?? 0
    if (e.k === 'b') {
      addTokens(background.tokens, e)
      background.costUsd += e.c
      background.webSearches += e.ws ?? 0
    }
    heatmap[local.weekday][local.hour] += e.c

    const info = modelInfo(e.m)
    const mm = models.get(info.label) ?? { model: e.m, label: info.label, family: info.family, ...acc(), price: priceOf(e.m) }
    add(mm, e)
    models.set(info.label, mm)

    const s = sessions.get(e.s) ?? { ...acc(), last: 0, accounts: new Map<string, number>() }
    add(s, e)
    s.last = Math.max(s.last, e.t)
    s.accounts.set(a, (s.accounts.get(a) ?? 0) + e.c)
    sessions.set(e.s, s)

    const ac = accounts.get(a) ?? { ...acc(), sessions: new Set<string>() }
    add(ac, e)
    ac.sessions.add(e.s)
    accounts.set(a, ac)
  }

  const projects = new Map<string, StatsProject>()
  const top: StatsConversation[] = []
  for (const [id, s] of sessions) {
    const info = ctx.session(id)
    const projectDir = info.projectDir ?? ''
    const key = (info.cwd ?? projectDir).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
    const name = info.cwd ? folderName(info.cwd) : projectDir || '?'
    const p = projects.get(key) ?? { cwd: info.cwd, projectDir, name, ...acc(), conversations: 0 }
    addTokens(p.tokens, { i: s.tokens.input, o: s.tokens.output, w5: s.tokens.cacheWrite5m, w1: s.tokens.cacheWrite1h, r: s.tokens.cacheRead })
    p.costUsd += s.costUsd
    p.requests += s.requests
    p.units += s.units
    p.conversations++
    projects.set(key, p)
    const main = [...s.accounts].sort((x, y) => y[1] - x[1])[0]?.[0]
    top.push({
      cliSessionId: id,
      title: info.title || id.slice(0, 8),
      cwd: info.cwd,
      accountId: main || undefined,
      tokens: s.tokens,
      costUsd: r2(s.costUsd),
      requests: s.requests,
      units: r1(s.units),
      lastActivityAt: Math.max(s.last, info.lastActivityAt ?? 0)
    })
  }

  const byAccount: StatsAccount[] = [...accounts]
    .map(([accountId, v]) => ({ accountId, ...ctx.accountLabel(accountId), tokens: v.tokens, costUsd: r2(v.costUsd), requests: v.requests, units: r1(v.units), conversations: v.sessions.size }))
    .sort((x, y) => y.costUsd - x.costUsd)
  // The total is the sum of the rows as shown, so they always add up to the cent.
  const sumOf = (k: 'costUsd' | 'units') => byAccount.reduce((s, a) => s + a[k], 0)

  return {
    range: ctx.range,
    accountId: all ? 'all' : ctx.accountId,
    from,
    to: ctx.now,
    timeZone: tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    firstDay,
    totals: {
      ...done(totals),
      costUsd: r2(sumOf('costUsd')),
      units: r1(sumOf('units')),
      conversations: sessions.size,
      activeDays: days.filter((d) => d.requests > 0).length,
      webSearches,
      background: { ...background, costUsd: r2(background.costUsd) }
    },
    fixed: { todayUsd: r2(fixed.todayUsd), monthUsd: r2(fixed.monthUsd), allTimeUsd: r2(fixed.allTimeUsd) },
    days: days.map((d) => ({ ...done(d), byAccount: Object.fromEntries(Object.entries(d.byAccount).map(([k, v]) => [k, r2(v)])) })),
    hours: hours?.map((h) => ({ ...h, costUsd: r2(h.costUsd) })),
    models: [...models.values()].map(done).sort((x, y) => y.costUsd - x.costUsd),
    projects: [...projects.values()].map(done).sort((x, y) => y.costUsd - x.costUsd).slice(0, 12),
    heatmap: heatmap.map((row) => row.map(r2)),
    topConversations: top.sort((x, y) => y.costUsd - x.costUsd).slice(0, 10),
    byAccount,
    pricing: { asOf: PRICE_LIST_DATE, source: PRICE_SOURCE, currency: 'USD', note: ctx.note, webSearchUsd: WEB_SEARCH_USD, usOnlyMultiplier: US_ONLY_MULTIPLIER },
    partial: ctx.partial,
    computedAt: ctx.now
  }
}

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * One row per day × account × model × type (transcript requests or Claude Code's background requests) of the range,
 * oldest first; days in the chosen zone. `kinds` names the two types in the UI language.
 */
export function ledgerCsv(
  entries: Iterable<LedgerEntry>,
  ctx: Omit<StatsContext, 'session' | 'partial' | 'note'>,
  header: string[],
  kinds: { request: string; background: string } = { request: 'request', background: 'background' }
): string {
  const stats = computeStats([], { ...ctx, session: () => ({}), partial: false, note: '' })
  const firstShown = stats.days[0]?.day ?? ''
  const tz = resolveTimeZone(ctx.timeZone)
  const clock = zonedClock(tz)
  const all = ctx.accountId === 'all' || ctx.accountId === undefined
  const rows = new Map<string, { day: string; account: string; model: string; background: boolean; v: Acc }>()
  for (const e of entries) {
    const a = ctx.accountOf(e)
    if (!all && a !== ctx.accountId) continue
    const day = clock(e.h).day
    if (ctx.range !== 'all' && day < firstShown) continue
    const model = modelInfo(e.m).label
    const background = e.k === 'b'
    const k = `${day}|${a}|${model}|${background ? 'b' : ''}`
    const row = rows.get(k) ?? { day, account: a, model, background, v: acc() }
    add(row.v, e)
    rows.set(k, row)
  }
  const lines = [header.map(csvCell).join(',')]
  const sorted = [...rows.values()].sort(
    (x, y) => x.day.localeCompare(y.day) || x.account.localeCompare(y.account) || x.model.localeCompare(y.model) || Number(x.background) - Number(y.background)
  )
  for (const r of sorted) {
    const who = ctx.accountLabel(r.account)
    const t = r.v.tokens
    const type = r.background ? kinds.background : kinds.request
    lines.push([r.day, who.label, who.email ?? '', r.model, type, t.input, t.output, t.cacheWrite5m, t.cacheWrite1h, t.cacheRead, r.v.requests, r2(r.v.costUsd).toFixed(2)].map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/** Last folder of a path written on any system: "D:\work\shop" and "/home/me/shop" both give "shop". */
export function folderName(cwd: string): string {
  return cwd.split(/[\\/]+/).filter(Boolean).pop() || cwd
}
