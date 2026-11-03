// Demo ledger for screenshots and the browser preview: 75 days of a heavy user with three accounts and four
// models, busiest in the afternoon and evening (Shanghai time). Deterministic, and free of Node-only imports.

import type {
  Language,
  ModelFamily,
  ModelPrice,
  StatsAccount,
  StatsConversation,
  StatsDay,
  StatsModel,
  StatsProject,
  StatsRange,
  TokenTotals,
  UsageStats
} from './types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const TZ_OFFSET = 8 * HOUR
const HISTORY_DAYS = 75

export interface DemoAccountRef {
  /** Account id, or "org:<uuid>" for an organization row. */
  id: string
  label: string
  email?: string
  /** Share of the usage. */
  share: number
  kind?: 'account' | 'org'
  orgUuid?: string
  /** Only used between these many days ago (inclusive), e.g. an account that stopped being used. */
  activeAgo?: [number, number]
}

const MODELS: Array<{ model: string; label: string; family: ModelFamily; share: number; price: ModelPrice }> = [
  { model: 'claude-opus-5-5', label: 'Opus 5.5', family: 'opus', share: 0.66, price: { model: 'Opus 5.5', input: 4, output: 20, cacheRead: 0.2 } },
  { model: 'claude-sonnet-5-5', label: 'Sonnet 5.5', family: 'sonnet', share: 0.19, price: { model: 'Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2 } },
  { model: 'claude-fable-5-1', label: 'Fable 5.1', family: 'fable', share: 0.11, price: { model: 'Fable 5.1', input: 10, output: 50, cacheRead: 0.25 } },
  { model: 'claude-haiku-5-5', label: 'Haiku 5.5', family: 'haiku', share: 0.04, price: { model: 'Haiku 5.5', input: 0.1, output: 0.5, longContext: { above: 100_000, input: 0.5, output: 2.5 } } }
]

/** Share of a day's work in each hour of the day (local time). */
const HOUR_CURVE = (() => {
  const raw = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 23 ? 1 : h <= 1 ? 0.45 : 0.03) * (h >= 14 && h <= 17 ? 1.6 : h >= 20 && h <= 22 ? 1.9 : 1))
  const sum = raw.reduce((a, b) => a + b, 0)
  return raw.map((v) => v / sum)
})()

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const zero = (): TokenTotals => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 })
const scale = (t: TokenTotals, k: number): TokenTotals => ({
  input: Math.round(t.input * k),
  output: Math.round(t.output * k),
  cacheWrite5m: Math.round(t.cacheWrite5m * k),
  cacheWrite1h: Math.round(t.cacheWrite1h * k),
  cacheRead: Math.round(t.cacheRead * k)
})
const plus = (a: TokenTotals, b: TokenTotals) => {
  a.input += b.input
  a.output += b.output
  a.cacheWrite5m += b.cacheWrite5m
  a.cacheWrite1h += b.cacheWrite1h
  a.cacheRead += b.cacheRead
}
const costOf = (t: TokenTotals, p: ModelPrice) =>
  (t.input * p.input + t.output * p.output + t.cacheRead * (p.cacheRead ?? p.input * 0.1) + t.cacheWrite5m * p.input * 1.25 + t.cacheWrite1h * p.input * 2) / 1e6
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

const dayName = (start: number) => {
  const d = new Date(start + TZ_OFFSET)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

interface Cell {
  day: number
  account: string
  model: number
  tokens: TokenTotals
  costUsd: number
  requests: number
  units: number
}

/** Every day × account × model of the demo history; `day` is days ago (0 = today). */
function cells(accounts: DemoAccountRef[], now: number): Cell[] {
  const r = rng(42)
  const out: Cell[] = []
  const todayStart = Math.floor((now + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET
  const hourNow = new Date(now + TZ_OFFSET).getUTCHours()
  const doneToday = HOUR_CURVE.slice(0, hourNow + 1).reduce((a, b) => a + b, 0)
  for (let ago = HISTORY_DAYS - 1; ago >= 0; ago--) {
    const weekday = new Date(todayStart - ago * DAY + TZ_OFFSET).getUTCDay()
    const weekend = weekday === 0 || weekday === 6
    // Usage grew over the weeks; a quiet stretch three weeks ago; today only counts the hours so far.
    let level = (weekend ? 0.3 + r() * 0.35 : 0.65 + r() * 0.75) * (0.55 + 0.45 * (1 - ago / HISTORY_DAYS))
    if (ago >= 19 && ago <= 21) level *= 0.12
    if (ago === 0) level = 0.95 * doneToday
    const base: TokenTotals = { input: 2_300_000, output: 690_000, cacheWrite5m: 6_900_000, cacheWrite1h: 2_700_000, cacheRead: 104_000_000 }
    for (const a of accounts) {
      if (a.activeAgo && (ago < a.activeAgo[0] || ago > a.activeAgo[1])) continue
      for (let m = 0; m < MODELS.length; m++) {
        const k = level * a.share * MODELS[m].share * (0.85 + r() * 0.3)
        const tokens = scale(base, k)
        out.push({ day: ago, account: a.id, model: m, tokens, costUsd: costOf(tokens, MODELS[m].price), requests: Math.round(1420 * k), units: 172 * k * (MODELS[m].family === 'haiku' ? 0.07 : MODELS[m].family === 'sonnet' ? 0.2 : 1) })
      }
    }
  }
  return out
}

const PROJECTS = [
  { name: 'shop-api', cwd: 'D:\\projects\\shop-api', w: 0.34 },
  { name: 'shop-web', cwd: 'D:\\projects\\shop-web', w: 0.23 },
  { name: 'infra', cwd: 'D:\\projects\\infra', w: 0.17 },
  { name: 'promo', cwd: 'D:\\video\\promo', w: 0.12 },
  { name: 'scripts', cwd: 'D:\\tools\\scripts', w: 0.08 },
  { name: 'docs', cwd: 'D:\\docs', w: 0.06 }
]

export function demoLedgerStats(
  lang: Language,
  range: StatsRange,
  accountId: string | undefined,
  accounts: DemoAccountRef[],
  conversations: Array<{ cliSessionId: string; title: string; cwd?: string; lastActivityAt: number; accountIds: string[] }>,
  now = Date.now()
): UsageStats {
  const all = !accountId || accountId === 'all'
  const mine = cells(accounts, now).filter((c) => all || c.account === accountId)
  const todayStart = Math.floor((now + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET
  const today = dayName(todayStart)
  const month = today.slice(0, 7)
  const span = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : HISTORY_DAYS
  const shown = mine.filter((c) => c.day < span)

  const days: StatsDay[] = []
  for (let ago = span - 1; ago >= 0; ago--) {
    const row: StatsDay = { day: dayName(todayStart - ago * DAY), tokens: zero(), costUsd: 0, requests: 0, units: 0, byAccount: {} }
    for (const c of shown) {
      if (c.day !== ago) continue
      plus(row.tokens, c.tokens)
      row.costUsd += c.costUsd
      row.requests += c.requests
      row.units += c.units
      row.byAccount[c.account] = (row.byAccount[c.account] ?? 0) + c.costUsd
    }
    days.push({ ...row, costUsd: r2(row.costUsd), units: r1(row.units), byAccount: Object.fromEntries(Object.entries(row.byAccount).map(([k, v]) => [k, r2(v)])) })
  }

  const totals = { tokens: zero(), costUsd: 0, requests: 0, units: 0, conversations: 0, activeDays: days.filter((d) => d.requests > 0).length }
  for (const c of shown) {
    plus(totals.tokens, c.tokens)
    totals.costUsd += c.costUsd
    totals.requests += c.requests
    totals.units += c.units
  }
  totals.costUsd = r2(totals.costUsd)
  totals.units = r1(totals.units)
  totals.conversations = Math.max(1, Math.round((range === 'today' ? 9 : 6.2 * Math.min(span, HISTORY_DAYS)) * (all ? 1 : (accounts.find((a) => a.id === accountId)?.share ?? 0) + 0.15)))

  const fixed = {
    todayUsd: r2(mine.filter((c) => c.day === 0).reduce((s, c) => s + c.costUsd, 0)),
    monthUsd: r2(mine.filter((c) => dayName(todayStart - c.day * DAY).startsWith(month)).reduce((s, c) => s + c.costUsd, 0)),
    allTimeUsd: r2(mine.reduce((s, c) => s + c.costUsd, 0))
  }

  const models: StatsModel[] = MODELS.map((m, i) => {
    const sel = shown.filter((c) => c.model === i)
    const tokens = zero()
    for (const c of sel) plus(tokens, c.tokens)
    return {
      model: m.model,
      label: m.label,
      family: m.family,
      tokens,
      costUsd: r2(sel.reduce((s, c) => s + c.costUsd, 0)),
      requests: sel.reduce((s, c) => s + c.requests, 0),
      units: r1(sel.reduce((s, c) => s + c.units, 0)),
      price: m.price
    }
  }).sort((a, b) => b.costUsd - a.costUsd)

  const projects: StatsProject[] = PROJECTS.map((p, i) => ({
    cwd: p.cwd,
    projectDir: p.cwd.replace(/[:\\/.]/g, '-'),
    name: p.name,
    tokens: scale(totals.tokens, p.w),
    costUsd: r2(totals.costUsd * p.w),
    requests: Math.round(totals.requests * p.w),
    units: r1(totals.units * p.w),
    conversations: Math.max(1, Math.round(totals.conversations * p.w * (1 + i * 0.1)))
  }))

  const weights = [0.16, 0.12, 0.1, 0.08, 0.07, 0.06, 0.05, 0.04, 0.035, 0.03]
  const topConversations: StatsConversation[] = conversations.slice(0, 10).map((c, i) => ({
    cliSessionId: c.cliSessionId,
    title: c.title,
    cwd: c.cwd,
    accountId: all ? c.accountIds[c.accountIds.length - 1] : accountId,
    tokens: scale(totals.tokens, weights[i] ?? 0.02),
    costUsd: r2(totals.costUsd * (weights[i] ?? 0.02)),
    requests: Math.round(totals.requests * (weights[i] ?? 0.02)),
    units: r1(totals.units * (weights[i] ?? 0.02)),
    lastActivityAt: c.lastActivityAt
  }))

  const heatRng = rng(range.length * 7 + 3)
  const heatmap = Array.from({ length: 7 }, (_, wd) =>
    Array.from({ length: 24 }, (_, h) => r2((totals.costUsd / 7) * HOUR_CURVE[h] * (wd >= 5 ? 0.5 : 1.12) * (0.75 + heatRng() * 0.5)))
  )

  const hours =
    range === 'today'
      ? Array.from({ length: 24 }, (_, hour) => {
          const hourNow = new Date(now + TZ_OFFSET).getUTCHours()
          const doneToday = HOUR_CURVE.slice(0, hourNow + 1).reduce((a, b) => a + b, 0) || 1
          const k = hour <= hourNow ? HOUR_CURVE[hour] / doneToday : 0
          return { hour, tokens: scale(totals.tokens, k), costUsd: r2(totals.costUsd * k), requests: Math.round(totals.requests * k) }
        })
      : undefined

  const byAccount: StatsAccount[] = accounts
    .filter((a) => all || a.id === accountId)
    .map((a) => {
      const sel = shown.filter((c) => c.account === a.id)
      const tokens = zero()
      for (const c of sel) plus(tokens, c.tokens)
      return {
        accountId: a.id,
        kind: a.kind ?? 'account',
        orgUuid: a.orgUuid,
        label: a.label,
        email: a.email,
        tokens,
        costUsd: r2(sel.reduce((s, c) => s + c.costUsd, 0)),
        requests: sel.reduce((s, c) => s + c.requests, 0),
        units: r1(sel.reduce((s, c) => s + c.units, 0)),
        conversations: sel.length ? Math.max(1, Math.round(totals.conversations * (all ? a.share + 0.1 : 1))) : 0
      }
    })
    .filter((a) => a.requests > 0)
    .sort((x, y) => y.costUsd - x.costUsd)
  // The total is the sum of the rows as shown, as in the real statistics.
  totals.costUsd = r2(byAccount.reduce((s, a) => s + a.costUsd, 0))
  totals.units = r1(byAccount.reduce((s, a) => s + a.units, 0))

  return {
    range,
    accountId: all ? 'all' : accountId!,
    from: todayStart - (span - 1) * DAY,
    to: now,
    timeZone: 'Asia/Shanghai',
    firstDay: dayName(todayStart - (HISTORY_DAYS - 1) * DAY),
    totals,
    fixed,
    days,
    hours,
    models,
    projects,
    heatmap,
    topConversations,
    byAccount,
    pricing: {
      asOf: '2026-10-06',
      currency: 'USD',
      note: lang === 'zh-CN' ? '按 API 标价折算，仅供参考，订阅不按这个扣费' : 'At API list prices, for reference only; subscriptions are not billed this way'
    },
    partial: false,
    computedAt: now
  }
}
