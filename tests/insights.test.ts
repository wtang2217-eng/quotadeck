// Cache savings, subscription payback, official status and settings import.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/shared/defaults'
import type { Account } from '../src/shared/types'
import type { LedgerEntry } from '../src/main/core/ledger'
import { parseStatus } from '../src/main/core/serviceStatus'
import { dailyBackup, makeBackup, planImport } from '../src/main/core/settingsBackup'
import { computeStats, type StatsContext } from '../src/main/core/stats'

const M = 1_000_000
const now = Date.UTC(2026, 10, 3, 4, 0)
const entry = (p: Partial<LedgerEntry>): LedgerEntry => ({ h: Date.UTC(2026, 10, 3, 1), a: 'A', s: 's', m: 'claude-opus-5-5', i: 0, o: 0, w5: 0, w1: 0, r: 0, n: 1, c: 0, u: 0, t: now, ...p })
const ctx: Omit<StatsContext, 'range'> = {
  accountId: 'all',
  now,
  timeZone: 'Asia/Shanghai',
  partial: false,
  note: '',
  accountOf: (e) => e.a || (e.g ? `org:${e.g}` : ''),
  accountLabel: (id) => ({ label: id, kind: id.startsWith('org:') ? 'org' : id ? 'account' : 'unknown' }),
  session: () => ({})
}

describe('cache savings', () => {
  it('gives the hit rate, what reads saved and what no caching would have cost', () => {
    // Opus 5.5: $4 input, $0.20 cache read; Sonnet 5.5 (US-only, 1.1x): $2 input, $0.10 read.
    const s = computeStats(
      [entry({ i: M, r: 3 * M, w5: M, c: 7.85 }), entry({ m: 'claude-sonnet-5-5', p: 'u', r: M, o: M, c: 11.11 })],
      { ...ctx, range: '7d' }
    )
    // 4M read of 6M input-side tokens.
    expect(s.totals.cacheHitRate).toBeCloseTo(4 / 6, 4)
    // 3M × (4 − 0.2) + 1.1 × 1M × (2 − 0.1).
    expect(s.totals.cacheSavingsUsd).toBe(11.4 + 2.09)
    // Opus: (1 + 3 + 1)M × $4; Sonnet: 1.1 × (1M × $2 + 1M × $10).
    expect(s.totals.noCacheUsd).toBe(20 + 13.2)
  })
})

describe('subscription payback', () => {
  const entries = [
    entry({ a: 'A', c: 300 }),
    entry({ a: 'B', c: 50 }),
    // Last month: not this month.
    entry({ a: 'A', h: Date.UTC(2026, 9, 20), c: 999 }),
    // An old account (organization row) and a Team account: not compared.
    entry({ a: '', g: 'org1', c: 70 }),
    entry({ a: 'T', c: 40 })
  ]
  const plans = [
    { id: 'A', plan: 'max20x' as const },
    { id: 'B', plan: 'pro' as const },
    { id: 'T', plan: 'team' as const },
    { id: 'U', plan: undefined }
  ]

  it('divides this month by the monthly prices of the accounts in view', () => {
    const s = computeStats(entries, { ...ctx, range: '7d', plans })
    expect(s.subscription).toMatchObject({ monthUsd: 350, planMonthlyUsd: 220, ratio: 1.59, accounts: 2, excluded: 2, asOf: '2026-11-03', source: 'https://claude.com/pricing' })
  })

  it('follows the account filter, and has no ratio when nothing in view is compared', () => {
    expect(computeStats(entries, { ...ctx, range: '30d', plans, accountId: 'B' }).subscription).toMatchObject({ monthUsd: 50, planMonthlyUsd: 20, ratio: 2.5, accounts: 1, excluded: 0 })
    const team = computeStats(entries, { ...ctx, range: '30d', plans, accountId: 'T' }).subscription
    expect(team).toMatchObject({ planMonthlyUsd: 0, accounts: 0, excluded: 1 })
    expect(team.ratio).toBeUndefined()
    expect(computeStats(entries, { ...ctx, range: '30d', plans, accountId: 'org:org1' }).subscription).toMatchObject({ accounts: 0, excluded: 0 })
  })
})

describe('official status', () => {
  const summary = {
    page: { url: 'https://status.claude.com' },
    status: { indicator: 'minor', description: 'Partially Degraded Service' },
    components: [
      { name: 'claude.ai', status: 'operational' },
      { name: 'Claude Console (platform.claude.com)', status: 'operational' },
      { name: 'Claude API (api.anthropic.com)', status: 'partial_outage' },
      { name: 'Claude Code', status: 'degraded_performance' },
      { name: 'A group', status: 'operational', group: true }
    ]
  }

  it('reads the indicator and puts Claude Code, the API and claude.ai first', () => {
    const s = parseStatus(summary, 123)
    expect(s).toMatchObject({ indicator: 'minor', description: 'Partially Degraded Service', checkedAt: 123, url: 'https://status.claude.com' })
    expect(s.components.map((c) => c.name)).toEqual(['Claude Code', 'Claude API (api.anthropic.com)', 'claude.ai', 'Claude Console (platform.claude.com)'])
    expect(s.components[1].status).toBe('partial_outage')
  })

  it('rejects anything that is not a Statuspage summary and never links elsewhere', () => {
    expect(() => parseStatus({ status: { indicator: 'fine' } })).toThrow()
    expect(() => parseStatus('<html>')).toThrow()
    expect(parseStatus({ ...summary, page: { url: 'https://evil.example' } }).url).toBe('https://status.claude.com')
  })
})

describe('settings import', () => {
  const accounts: Account[] = [
    { id: 'A', email: 'a@example.com', color: '#000000', addedAt: 0 },
    { id: 'B', email: 'b@example.com', color: '#111111', addedAt: 0 }
  ]

  it('keeps known settings of the right type, matches accounts by id or email, and drops the rest', () => {
    const file = {
      ...makeBackup({ ...defaultSettings('zh-CN'), warnAt: 70 }, accounts, ['11111111-1111-4111-8111-111111111111'], { '00000000-0000-4000-8000-0000000000aa': '旧号' }),
      extra: 1
    }
    file.settings = { warnAt: 70, theme: 'dark', soundVolume: 'loud' as unknown as number, unknownOption: true } as never
    file.accounts = [
      { id: 'A', nickname: '主号', color: '#7C5CFF' },
      { id: 'other-id', email: 'b@example.com', nickname: '副号', color: 'red' },
      { id: 'C', email: 'c@example.com', nickname: '别人', color: '#123456' }
    ]
    file.favorites = ['11111111-1111-4111-8111-111111111111', 'not-an-id']
    const plan = planImport(file, accounts, 'zh-CN')
    expect(plan.settings).toEqual({ warnAt: 70, theme: 'dark' })
    expect(plan.accounts).toEqual([
      { id: 'A', nickname: '主号', color: '#7C5CFF' },
      { id: 'B', nickname: '副号', color: undefined }
    ])
    expect(plan.favorites).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(plan.orgLabels).toEqual({ '00000000-0000-4000-8000-0000000000aa': '旧号' })
    expect(plan.dropped.sort()).toEqual(['accounts.c@example.com', 'extra', 'settings.soundVolume', 'settings.unknownOption'])
  })

  it('refuses files that are not a QuotaDeck settings export', () => {
    expect(() => planImport({ settings: {} }, accounts)).toThrow('not a QuotaDeck settings file')
    expect(() => planImport(null, accounts)).toThrow()
  })

  it('backs up once a day and keeps the newest ten', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-backup-'))
    try {
      const b = makeBackup(defaultSettings('en'), accounts, [], {})
      for (let d = 1; d <= 12; d++) dailyBackup(dir, b, new Date(2026, 9, d, 12).getTime())
      dailyBackup(dir, b, new Date(2026, 9, 12, 18).getTime())
      const files = fs.readdirSync(dir).sort()
      expect(files).toHaveLength(10)
      expect(files[0]).toBe('settings-20261003.json')
      expect(files.at(-1)).toBe('settings-20261012.json')
      expect(JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')).kind).toBe('quotadeck-settings')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
