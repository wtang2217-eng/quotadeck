// Usage of organizations that are not in the panel (old accounts) gets its own rows in the statistics: default
// names "旧号", "旧号 2" by first use, names the user gives, and a filter for one organization. Unknown usage is "其他".
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, UsageStats } from '../src/shared/types'
import type { LedgerEntry } from '../src/main/core/ledger'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const A: Account = { id: 'A', accountUuid: 'ua', orgUuid: '00000000-0000-4000-8000-00000000000a', email: 'a@example.com', nickname: '主号', color: '#000000', addedAt: 0 }
const OX = '00000000-0000-4000-8000-0000000000aa'
const OY = '00000000-0000-4000-8000-0000000000bb'

interface EngineInternals {
  s: { accounts: Account[]; orgLabels: Record<string, string>; settings: { language: string; timezone: string } }
  ledger: { setHour(h: number, entries: LedgerEntry[]): boolean }
  getStats(q: { range: 'all' | '7d'; accountId?: string }): Promise<UsageStats>
  ledgerCsv(q: { range: 'all'; accountId?: string }): Promise<{ csv: string }>
  setOrgLabel(org: string, label: string): void
  on(ev: string, cb: () => void): void
  stop(): Promise<void>
}

const entry = (h: number, p: Partial<LedgerEntry>): LedgerEntry => ({ h, a: '', s: 's', m: 'claude-opus-5-5', i: 1, o: 1, w5: 0, w1: 0, r: 0, n: 1, c: 1.25, u: 1, t: h, ...p })

describe('organization rows', () => {
  let dir: string
  let e: EngineInternals
  const now = Date.now()
  const hour = (ago: number) => Math.floor((now - ago) / HOUR) * HOUR

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-orgs-'))
    process.env.QUOTADECK_HOME = path.join(dir, 'home')
    process.env.QUOTADECK_CLAUDE_DIR = path.join(dir, 'claude')
    fs.mkdirSync(path.join(dir, 'claude', 'projects'), { recursive: true })
    const { Engine } = await import('../src/main/core/engine')
    e = new Engine({ appVersion: 'test', locale: 'zh-CN', notify: () => {}, trash: async () => {}, openDesktop: async () => true }) as unknown as EngineInternals
    e.s.accounts = [A]
    e.s.settings.language = 'zh-CN'
    e.s.settings.timezone = 'Asia/Shanghai'
    // A's own usage, A's usage known only by its organization, two old organizations (OX used first), and usage
    // whose organization is unknown.
    e.ledger.setHour(hour(HOUR), [entry(hour(HOUR), { a: 'A', c: 2 })])
    e.ledger.setHour(hour(10 * DAY), [entry(hour(10 * DAY), { g: A.orgUuid, c: 3, s: 't' })])
    e.ledger.setHour(hour(60 * DAY), [entry(hour(60 * DAY), { g: OX, c: 4, s: 'x' })])
    e.ledger.setHour(hour(50 * DAY), [entry(hour(50 * DAY), { g: OY, c: 5, n: 2, s: 'y' })])
    e.ledger.setHour(hour(70 * DAY), [entry(hour(70 * DAY), { c: 0.5, s: 'z' })])
  })

  afterEach(async () => {
    await e.stop()
    vi.clearAllTimers()
    vi.useRealTimers()
    delete process.env.QUOTADECK_HOME
    delete process.env.QUOTADECK_CLAUDE_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('gives organizations default names by first use, and unknown usage "其他"; the total is the sum of the rows', async () => {
    const s = await e.getStats({ range: 'all' })
    const rows = Object.fromEntries(s.byAccount.map((a) => [a.accountId, a]))
    expect(rows.A).toMatchObject({ kind: 'account', label: '主号', costUsd: 5 })
    expect(rows[`org:${OX}`]).toMatchObject({ kind: 'org', orgUuid: OX, label: '旧号', costUsd: 4 })
    expect(rows[`org:${OY}`]).toMatchObject({ kind: 'org', orgUuid: OY, label: '旧号 2', costUsd: 5, requests: 2 })
    expect(rows['']).toMatchObject({ kind: 'unknown', label: '其他', costUsd: 0.5 })
    expect(s.byAccount).toHaveLength(4)
    const sum = (k: 'costUsd' | 'requests') => s.byAccount.reduce((x, a) => x + a[k], 0)
    expect(Math.round(sum('costUsd') * 100) / 100).toBe(s.totals.costUsd)
    expect(sum('requests')).toBe(s.totals.requests)
    expect(s.fixed.allTimeUsd).toBe(14.5)
    expect(s.totals.costUsd).toBe(14.5)
  })

  it('renames an organization, keeps the name, caps it at 40 characters, and restores the default with ""', async () => {
    let pushed = 0
    e.on('state', () => pushed++)
    e.setOrgLabel(OY, '  被封的主号  ')
    expect(pushed).toBe(1)
    expect(e.s.orgLabels).toEqual({ [OY]: '被封的主号' })
    let s = await e.getStats({ range: 'all' })
    expect(s.byAccount.find((a) => a.orgUuid === OY)?.label).toBe('被封的主号')
    // The other organization keeps its own default name.
    expect(s.byAccount.find((a) => a.orgUuid === OX)?.label).toBe('旧号')
    e.setOrgLabel(OY, '号'.repeat(60))
    expect(Array.from(e.s.orgLabels[OY])).toHaveLength(40)
    e.setOrgLabel(OY, '')
    expect(e.s.orgLabels[OY]).toBeUndefined()
    s = await e.getStats({ range: 'all' })
    expect(s.byAccount.find((a) => a.orgUuid === OY)?.label).toBe('旧号 2')
  })

  it('filters statistics and the CSV by one organization', async () => {
    e.setOrgLabel(OX, 'Le 旧主号')
    const s = await e.getStats({ range: 'all', accountId: `org:${OX}` })
    expect(s.accountId).toBe(`org:${OX}`)
    expect(s.byAccount.map((a) => a.label)).toEqual(['Le 旧主号'])
    expect(s.totals.costUsd).toBe(4)
    expect(s.fixed).toMatchObject({ allTimeUsd: 4, todayUsd: 0 })
    const csv = (await e.ledgerCsv({ range: 'all', accountId: `org:${OX}` })).csv.trimEnd().split('\r\n')
    expect(csv).toHaveLength(2)
    expect(csv[1].split(',').slice(1, 4)).toEqual(['Le 旧主号', '', 'Opus 5.5'])
    // "" shows only the usage of unknown accounts.
    const unknown = await e.getStats({ range: 'all', accountId: '' })
    expect(unknown.byAccount.map((a) => a.kind)).toEqual(['unknown'])
    expect(unknown.totals.costUsd).toBe(0.5)
  })
})
