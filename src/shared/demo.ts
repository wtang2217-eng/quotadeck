// Fake data for `--demo` mode, README screenshots and the renderer's browser-only preview.
// Nothing here comes from a real machine.

import { defaultSettings } from './defaults'
import type {
  AccountView,
  ActivityEvent,
  AppState,
  ConversationItem,
  Language,
  ModelFamily,
  ProjectItem,
  SetupCheck,
  SetupStatus,
  StatsRange,
  TokenTotals,
  UsagePoint,
  UsageStats
} from './types'

const MIN = 60_000
const HOUR = 60 * MIN
/** Version shown in demo mode (screenshots). */
export const DEMO_VERSION = '0.1.0'

/** Deterministic pseudo-random numbers so screenshots are stable. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function history(now: number, seed: number, endFh: number, endSd: number): UsagePoint[] {
  const r = rng(seed)
  const points: UsagePoint[] = []
  const start = now - 7 * 24 * HOUR
  let sd = Math.max(0, endSd - 45)
  let fh = 0
  for (let t = start; t <= now; t += 45 * MIN) {
    const hourOfDay = new Date(t).getUTCHours()
    const busy = hourOfDay >= 1 && hourOfDay <= 14
    if (busy && r() > 0.35) fh += r() * 9
    if (r() > 0.93) fh = 0
    fh = Math.min(100, fh)
    sd = Math.min(endSd, sd + (busy ? r() * 0.5 : 0))
    points.push({ t, fh: Math.round(fh), sd: Math.round(sd) })
  }
  points.push({ t: now, fh: endFh, sd: endSd })
  return points
}

function demoAccounts(lang: Language, now: number): AccountView[] {
  const zh = lang === 'zh-CN'
  return [
    {
      id: 'a1f0c3d2-0000-4000-8000-000000000001',
      accountUuid: 'a1f0c3d2-0000-4000-8000-000000000001',
      orgUuid: 'b2e1d4c3-0000-4000-8000-000000000001',
      email: 'alice.chen@example.com',
      displayName: 'Alice',
      nickname: zh ? '主号' : 'Main',
      color: '#7C5CFF',
      plan: { kind: 'max20x', label: 'Max 20x', multiplier: 20, billing: 'stripe_subscription', extraUsage: false },
      cliConfigDir: 'C:\\Users\\alice\\.claude',
      usesDefaultCliDir: true,
      cliLoggedIn: true,
      addedAt: now - 20 * 24 * HOUR,
      usage: {
        at: now - 11 * MIN,
        source: 'desktop',
        fiveHour: { pct: 23 },
        sevenDay: { pct: 41 }
      },
      estimate: {
        at: now,
        fiveHour: 27,
        sevenDay: 42,
        fiveHourResetsAt: now + 3 * HOUR + 12 * MIN,
        basis: 'own-history',
        fromRecordAt: now - 11 * MIN
      },
      eta: { fiveHourFullAt: now + 2 * HOUR + 42 * MIN, fiveHourPerHour: 27, basis: 'estimate', at: now },
      history: history(now, 7, 23, 41),
      isDesktopCurrent: false,
      desktopSessionCount: 64,
      status: 'ok'
    },
    {
      id: 'a1f0c3d2-0000-4000-8000-000000000002',
      accountUuid: 'a1f0c3d2-0000-4000-8000-000000000002',
      orgUuid: 'b2e1d4c3-0000-4000-8000-000000000002',
      email: 'bob.dev@example.com',
      displayName: 'Bob',
      nickname: zh ? '副号' : 'Second',
      color: '#10B981',
      plan: { kind: 'max5x', label: 'Max 5x', multiplier: 5, billing: 'stripe_subscription', extraUsage: false },
      cliConfigDir: 'C:\\Users\\alice\\.quotadeck\\profiles\\bob',
      cliLoggedIn: true,
      addedAt: now - 9 * 24 * HOUR,
      usage: {
        at: now - 2 * MIN,
        source: 'desktop',
        fiveHour: { pct: 100, resetsAt: now + HOUR + 18 * MIN },
        sevenDay: { pct: 77, resetsAt: now + 5 * 24 * HOUR }
      },
      history: history(now, 21, 100, 77),
      limit: {
        kind: 'session',
        at: now - 38 * MIN,
        resetsAt: now + HOUR + 18 * MIN,
        message: "You've hit your session limit · resets 6:40pm (Asia/Shanghai)"
      },
      isDesktopCurrent: true,
      desktopSessionCount: 64,
      status: 'limited'
    },
    {
      id: 'a1f0c3d2-0000-4000-8000-000000000003',
      accountUuid: 'a1f0c3d2-0000-4000-8000-000000000003',
      orgUuid: 'b2e1d4c3-0000-4000-8000-000000000003',
      email: 'carol.w@example.com',
      displayName: 'Carol',
      nickname: zh ? '备用' : 'Spare',
      color: '#F59E0B',
      plan: { kind: 'pro', label: 'Pro', multiplier: 1, billing: 'stripe_subscription', extraUsage: true },
      cliConfigDir: 'C:\\Users\\alice\\.quotadeck\\profiles\\carol',
      cliLoggedIn: true,
      addedAt: now - 2 * 24 * HOUR,
      usage: {
        at: now - 3 * HOUR,
        source: 'terminal',
        fiveHour: { pct: 0 },
        sevenDay: { pct: 9, resetsAt: now + 6 * 24 * HOUR }
      },
      history: history(now, 3, 0, 9),
      isDesktopCurrent: false,
      desktopSessionCount: 64,
      status: 'ok'
    }
  ]
}

const CONVERSATIONS = [
  ['重构支付回调并补齐单元测试', 'Refactor the payment webhook and add unit tests', 'D:\\projects\\shop-api', 38, 'claude-desktop', 412],
  ['首页改成暗色主题，顺便修移动端布局', 'Dark theme for the landing page, fix mobile layout', 'D:\\projects\\shop-web', 95, 'claude-desktop', 268],
  ['把订单导出改成异步任务', 'Move order export to a background job', 'D:\\projects\\shop-api', 260, 'cli', 133],
  ['排查 Redis 连接偶发超时', 'Investigate intermittent Redis timeouts', 'D:\\projects\\infra', 410, 'claude-desktop', 187],
  ['写一个批量重命名照片的小脚本', 'Write a small script to batch-rename photos', 'D:\\tools\\scripts', 1440, 'cli', 54],
  ['给宣传片加字幕和背景音乐', 'Add subtitles and music to the promo video', 'D:\\video\\promo', 1720, 'claude-desktop', 322],
  ['升级到 React 19 并处理弃用警告', 'Upgrade to React 19 and fix deprecations', 'D:\\projects\\shop-web', 2900, 'cli', 241],
  ['数据库迁移脚本评审', 'Review the database migration scripts', 'D:\\projects\\shop-api', 4320, 'claude-desktop', 97],
  ['整理周报模板', 'Tidy up the weekly report template', 'D:\\docs', 5800, 'claude-desktop', 41],
  ['部署脚本加上回滚', 'Add rollback to the deploy script', 'D:\\projects\\infra', 7300, 'cli', 156]
] as const

export function demoConversations(lang: Language = 'zh-CN', now = Date.now()): ConversationItem[] {
  const zh = lang === 'zh-CN'
  const accountIds = demoAccounts(lang, now).map((a) => a.id)
  return CONVERSATIONS.map(([titleZh, titleEn, cwd, agoMin, entrypoint, lines], i) => ({
    cliSessionId: `5d1c2b3a-${1001 + i}-4abc-9def-0123456789${11 + i}`,
    title: zh ? titleZh : titleEn,
    firstPrompt: zh ? titleZh : titleEn,
    cwd,
    projectDir: cwd.replace(/[:\\/.]/g, '-'),
    lastActivityAt: now - agoMin * MIN,
    createdAt: now - agoMin * MIN - 90 * MIN,
    lines,
    entrypoint,
    desktopAccountIds: entrypoint === 'claude-desktop' ? accountIds : [],
    // The first conversation was started on the second account and finished on the main one after a switch.
    accountIds: i === 0 ? [accountIds[1], accountIds[0]] : [accountIds[i % 3 === 2 ? 2 : i % 2]],
    desktopSessionId: entrypoint === 'claude-desktop' ? `local_7e2f${1001 + i}-5abc-4def-8123-0123456789ab` : undefined,
    favorite: i === 0 || i === 3,
    sizeBytes: lines * 2900
  }))
}

export function demoProjects(lang: Language = 'zh-CN', now = Date.now()): ProjectItem[] {
  const byCwd = new Map<string, ProjectItem>()
  for (const c of demoConversations(lang, now)) {
    const p = byCwd.get(c.cwd!) ?? { cwd: c.cwd, projectDir: c.projectDir, name: c.cwd!.split(/[\\/]/).pop()!, conversations: 0, lastActivityAt: 0 }
    p.conversations++
    p.lastActivityAt = Math.max(p.lastActivityAt, c.lastActivityAt)
    byCwd.set(c.cwd!, p)
  }
  return [...byCwd.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

const DEMO_MODELS: Array<{ model: string; label: string; family: ModelFamily; share: number; price: [number, number] }> = [
  { model: 'claude-opus-5-5', label: 'Opus 5.5', family: 'opus', share: 0.71, price: [4, 20] },
  { model: 'claude-sonnet-5-5', label: 'Sonnet 5.5', family: 'sonnet', share: 0.17, price: [2, 10] },
  { model: 'claude-fable-5-1', label: 'Fable 5.1', family: 'fable', share: 0.09, price: [10, 50] },
  { model: 'claude-haiku-5-5', label: 'Haiku 5.5', family: 'haiku', share: 0.03, price: [0.1, 0.5] }
]

const zeroTokens = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const addTokens = (a: TokenTotals, b: TokenTotals) => {
  a.input += b.input
  a.output += b.output
  a.cacheRead += b.cacheRead
  a.cacheWrite += b.cacheWrite
}
const scaleTokens = (t: TokenTotals, k: number): TokenTotals => ({
  input: Math.round(t.input * k),
  output: Math.round(t.output * k),
  cacheRead: Math.round(t.cacheRead * k),
  cacheWrite: Math.round(t.cacheWrite * k)
})

/** Believable statistics for screenshots: a heavy user, mostly Opus, busiest in the afternoon and evening. */
export function demoStats(lang: Language = 'zh-CN', range: StatsRange = '7d', accountId?: string, now = Date.now()): UsageStats {
  const accounts = demoAccounts(lang, now)
  const shares: Record<string, number> = { [accounts[0].id]: 0.58, [accounts[1].id]: 0.34, [accounts[2].id]: 0.08 }
  const only = accountId ? (shares[accountId] ?? 0) : 1
  const r = rng(range === '7d' ? 11 : 31)
  const n = range === '7d' ? 7 : 30
  const dayMs = 24 * HOUR
  const today = Math.floor((now + 8 * HOUR) / dayMs) * dayMs - 8 * HOUR
  const days: UsageStats['days'] = []
  const totals = { tokens: zeroTokens(), units: 0, costUsd: 0, replies: 0, conversations: 0, activeDays: 0 }
  for (let i = n - 1; i >= 0; i--) {
    const start = today - i * dayMs
    const weekend = [0, 6].includes(new Date(start + 8 * HOUR).getUTCDay())
    const level = i === 0 ? 0.55 : weekend ? 0.25 + r() * 0.3 : 0.6 + r() * 0.7
    const tokens = scaleTokens({ input: 2_100_000, output: 640_000, cacheRead: 96_000_000, cacheWrite: 9_400_000 }, level * only)
    const units = Math.round(158 * level * only * 10) / 10
    const costUsd = Math.round((tokens.input * 4 + tokens.output * 20 + tokens.cacheRead * 0.2 + tokens.cacheWrite * 5) / 1e6 * 1.08 * 100) / 100
    const replies = Math.round(1350 * level * only)
    const byAccount: Record<string, number> = {}
    for (const a of accounts) if (!accountId || a.id === accountId) byAccount[a.id] = Math.round(units * (accountId ? 1 : shares[a.id]) * 10) / 10
    const d = new Date(start + 8 * HOUR)
    days.push({ day: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`, tokens, units, costUsd, replies, byAccount })
    addTokens(totals.tokens, tokens)
    totals.units += units
    totals.costUsd += costUsd
    totals.replies += replies
    if (replies > 0) totals.activeDays++
  }
  totals.units = Math.round(totals.units * 10) / 10
  totals.costUsd = Math.round(totals.costUsd * 100) / 100
  totals.conversations = Math.round((range === '7d' ? 46 : 171) * Math.max(0.15, only))

  const models = DEMO_MODELS.map((m) => {
    const tokens = scaleTokens(totals.tokens, m.share)
    const costUsd = Math.round(((tokens.input * m.price[0] + tokens.output * m.price[1] + tokens.cacheRead * m.price[0] * 0.05 + tokens.cacheWrite * m.price[0] * 1.25) / 1e6) * 100) / 100
    return { model: m.model, label: m.label, family: m.family, tokens, units: Math.round(totals.units * m.share * 10) / 10, costUsd, replies: Math.round(totals.replies * m.share) }
  })
  const projectWeights = [0.38, 0.24, 0.17, 0.11, 0.06, 0.04]
  const projects = demoProjects(lang, now).map((p, i) => {
    const w = projectWeights[i] ?? 0.02
    return { cwd: p.cwd, projectDir: p.projectDir, name: p.name, units: Math.round(totals.units * w * 10) / 10, costUsd: Math.round(totals.costUsd * w * 100) / 100, replies: Math.round(totals.replies * w), conversations: p.conversations * (range === '7d' ? 3 : 9) }
  }).sort((a, b) => b.units - a.units)

  const heatmap: number[][] = []
  for (let wd = 0; wd < 7; wd++) {
    const row: number[] = []
    for (let h = 0; h < 24; h++) {
      const work = h >= 9 && h <= 23 ? 1 : h <= 1 ? 0.5 : 0.04
      const peak = h >= 14 && h <= 17 ? 1.6 : h >= 20 && h <= 22 ? 1.9 : 1
      const weekend = wd >= 5 ? 0.45 : 1
      row.push(Math.round(work * peak * weekend * (0.5 + r()) * 3.4 * only * 10) / 10)
    }
    heatmap.push(row)
  }
  const topConversations = demoConversations(lang, now).slice(0, 10).map((c, i) => {
    const w = [0.19, 0.14, 0.11, 0.09, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02][i]
    return {
      cliSessionId: c.cliSessionId,
      title: c.title,
      cwd: c.cwd,
      accountId: c.accountIds[c.accountIds.length - 1],
      tokens: scaleTokens(totals.tokens, w),
      units: Math.round(totals.units * w * 10) / 10,
      costUsd: Math.round(totals.costUsd * w * 100) / 100,
      replies: Math.round(totals.replies * w),
      lastActivityAt: c.lastActivityAt
    }
  })
  const byAccount = accounts
    .filter((a) => !accountId || a.id === accountId)
    .map((a) => {
      const w = accountId ? 1 : shares[a.id]
      return { accountId: a.id, units: Math.round(totals.units * w * 10) / 10, costUsd: Math.round(totals.costUsd * w * 100) / 100, replies: Math.round(totals.replies * w) }
    })
  return {
    range,
    accountId,
    from: today - (n - 1) * dayMs,
    to: now,
    timeZone: 'Asia/Shanghai',
    totals,
    days,
    models,
    projects,
    heatmap,
    topConversations,
    byAccount,
    pricing: { asOf: '2026-10-06', currency: 'USD' },
    partial: false,
    computedAt: now
  }
}

/** Setup checklist. `fresh` shows a computer where nothing is set up yet. */
export function demoSetupStatus(lang: Language = 'zh-CN', fresh = false): SetupStatus {
  const zh = lang === 'zh-CN'
  const c = (check: SetupCheck) => check
  const checks: SetupCheck[] = [
    c({ id: 'desktop-installed', state: 'ok', optional: false, title: zh ? 'Claude 桌面端' : 'Claude desktop app', detail: zh ? '已安装' : 'Installed' }),
    c({
      id: 'desktop-signed-in',
      state: 'ok',
      optional: false,
      title: zh ? '桌面端已登录' : 'Desktop app signed in',
      detail: zh ? '当前登录的是 副号' : 'Signed in as Second'
    }),
    fresh
      ? c({
          id: 'cli',
          state: 'fixable',
          optional: false,
          action: 'install-cli',
          title: zh ? 'Claude Code 命令行' : 'Claude Code command line',
          detail: zh ? '没找到 claude 命令。会用官方安装脚本装好，加号和在终端接着聊都要用到' : 'The claude command is missing. The official installer will add it; adding accounts and terminal sessions need it'
        })
      : c({ id: 'cli', state: 'ok', optional: false, title: zh ? 'Claude Code 命令行' : 'Claude Code command line', detail: zh ? '版本 2.1.283' : 'Version 2.1.283' }),
    c({
      id: 'git-bash',
      state: fresh ? 'manual' : 'ok',
      optional: true,
      action: fresh ? 'download-git' : undefined,
      url: fresh ? 'https://git-scm.com/downloads/win' : undefined,
      title: 'Git for Windows',
      detail: fresh
        ? zh
          ? '可选。装了以后 Claude Code 能用 Bash 工具，没装就用 PowerShell'
          : 'Optional. With it Claude Code can use its Bash tool; without it, PowerShell'
        : zh
          ? '已安装，Claude Code 可以用 Bash 工具'
          : 'Installed; Claude Code can use its Bash tool'
    }),
    fresh
      ? c({
          id: 'main-account',
          state: 'fixable',
          optional: false,
          action: 'adopt-main',
          title: zh ? '主号' : 'Main account',
          detail: zh ? '找到终端已登录的 alice.chen@example.com，会把它加进面板' : 'Found alice.chen@example.com signed in; it will be added'
        })
      : c({ id: 'main-account', state: 'ok', optional: false, title: zh ? '主号' : 'Main account', detail: zh ? '已加入：主号（Max 20x）' : 'Added: Main (Max 20x)' }),
    fresh
      ? c({
          id: 'integration',
          state: 'fixable',
          optional: false,
          action: 'connect',
          title: zh ? '接入 Claude Code' : 'Connect to Claude Code',
          detail: zh ? '额度用完的那一刻提醒你，换号也能马上认出来' : 'Alerts the moment a limit is hit and spots account switches at once'
        })
      : c({ id: 'integration', state: 'ok', optional: false, title: zh ? '接入 Claude Code' : 'Connect to Claude Code', detail: zh ? '额度提醒和状态栏都已接入' : 'Limit alerts and status line connected' }),
    c({
      id: 'open-at-login',
      state: 'fixable',
      optional: true,
      action: 'open-at-login',
      title: zh ? '开机自动启动' : 'Open at login',
      detail: zh ? '可选。开机后待在托盘里，额度提醒不会漏' : 'Optional. Waits in the tray so no alert is missed'
    })
  ]
  const ready = checks.every((x) => x.optional || x.state === 'ok')
  return { checks, ready, needsSetup: fresh, running: false }
}

export function demoState(lang: Language = 'zh-CN', now = Date.now()): AppState {
  const zh = lang === 'zh-CN'
  const settings = { ...defaultSettings(lang), acceptedOwnershipNotice: true, timezone: 'Asia/Shanghai' }
  const accounts = demoAccounts(lang, now)
  const [alice, bob, carol] = accounts
  const latest = demoConversations(lang, now)[0]

  const ev = (agoMin: number, type: ActivityEvent['type'], accountId: string | undefined, title: string, detail?: string): ActivityEvent => ({
    id: `demo-${type}-${agoMin}`,
    at: now - agoMin * MIN,
    type,
    accountId,
    title,
    detail
  })
  const events: ActivityEvent[] = [
    {
      ...ev(38, 'limit-hit', bob.id, zh ? '副号 的 5 小时额度用完了' : 'Second hit its 5-hour limit', zh ? '18:40 恢复 · 主号 还剩 77%' : 'Resets 18:40 · Main has 77% left'),
      cliSessionId: latest.cliSessionId,
      cwd: latest.cwd
    },
    ev(52, 'threshold', bob.id, zh ? '副号 5 小时额度已用 95%' : 'Second is at 95% of its 5-hour limit'),
    ev(75, 'threshold', bob.id, zh ? '副号 5 小时额度已用 80%' : 'Second is at 80% of its 5-hour limit'),
    ev(130, 'merge', undefined, zh ? '桌面端 Code 对话已合并' : 'Desktop Code conversations merged', zh ? '复制了 2 条到 主号 的列表' : 'Copied 2 into Main’s list'),
    ev(300, 'reset', alice.id, zh ? '主号 的 5 小时额度已恢复' : 'Main’s 5-hour limit has reset'),
    ev(2 * 24 * 60, 'login', carol.id, zh ? '已添加 备用（Pro）' : 'Added Spare (Pro)', 'carol.w@example.com'),
    ev(2 * 24 * 60 + 5, 'integration', undefined, zh ? '已接入 Claude Code（额度提醒 + 状态栏）' : 'Connected to Claude Code (limit alerts + status line)')
  ]

  return {
    appVersion: DEMO_VERSION,
    platform: 'win32',
    demo: true,
    accounts,
    recommendedAccountId: alice.id,
    desktop: {
      found: true,
      dataDir: 'C:\\Users\\alice\\AppData\\Local\\Claude-Data\\claude_demo',
      currentAccountUuid: bob.accountUuid,
      currentOrgUuid: bob.orgUuid,
      currentSince: now - 3 * HOUR,
      knownAccountUuids: accounts.map((a) => a.accountUuid!),
      running: true
    },
    merge: {
      enabled: true,
      lastRunAt: now - 3 * MIN,
      lastCopied: 2,
      totalCopied: 41,
      backupsDir: 'C:\\Users\\alice\\.quotadeck\\backups',
      eligibleAccounts: 3
    },
    integration: {
      hooksInstalled: true,
      statusLineInstalled: true,
      serverPort: 41117,
      serverRunning: true,
      settingsPath: 'C:\\Users\\alice\\.claude\\settings.json'
    },
    settings,
    cli: { found: true, path: 'C:\\Users\\alice\\.local\\bin\\claude.exe', version: '2.1.283' },
    events,
    lastInterrupted: {
      accountId: bob.id,
      cliSessionId: latest.cliSessionId,
      cwd: latest.cwd,
      title: latest.title,
      at: now - 38 * MIN
    },
    needsSetup: false,
    update: { current: DEMO_VERSION, latest: DEMO_VERSION, available: false, url: 'https://github.com/wtang2217-eng/quotadeck/releases/latest', checkedAt: now - 2 * HOUR }
  }
}
