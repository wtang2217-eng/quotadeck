import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '../src/main/core/ledger'
import { costOf, modelInfo, priceOf } from '../src/main/core/pricing'
import { computeStats, ledgerCsv, zonedClock, type StatsContext } from '../src/main/core/stats'

const entry = (p: Partial<LedgerEntry> & { h: number; s: string }): LedgerEntry => ({
  a: 'A',
  m: 'claude-opus-5-5',
  i: 100,
  o: 10,
  w5: 40,
  w1: 10,
  r: 1000,
  n: 1,
  c: 0.5,
  u: 1,
  t: p.h + 10 * 60_000,
  ...p
})

describe('model prices', () => {
  it('reads family and version from current and older model ids', () => {
    expect(modelInfo('claude-opus-5-5').label).toBe('Opus 5.5')
    expect(modelInfo('claude-opus-4-1-20250805').label).toBe('Opus 4.1')
    expect(modelInfo('claude-opus-4-20250514').label).toBe('Opus 4')
    expect(modelInfo('claude-3-5-haiku-20241022')).toMatchObject({ family: 'haiku', label: 'Haiku 3.5' })
    expect(modelInfo('claude-3-haiku-20240307')).toMatchObject({ family: 'haiku', label: 'Haiku 3' })
    expect(modelInfo('claude-fable-5-1')).toMatchObject({ family: 'fable', label: 'Fable 5.1' })
    expect(modelInfo('something-else').family).toBe('other')
  })

  it('uses one row per model of the list', () => {
    expect(priceOf('claude-opus-5-5')).toEqual({ model: 'Opus 5.5', input: 4, output: 20, cacheRead: 0.2, fast: { input: 8, output: 40 } })
    // The official page lists $0.10 for Sonnet 5.5 cache reads.
    expect(priceOf('claude-sonnet-5-5')).toEqual({ model: 'Sonnet 5.5', input: 2, output: 10, cacheRead: 0.1 })
    expect(priceOf('claude-fable-5')).toMatchObject({ model: 'Fable 5', cacheRead: 1 })
    expect(priceOf('claude-fable-5-1')).toMatchObject({ model: 'Fable 5.1', cacheRead: 0.25 })
    expect(priceOf('claude-opus-4-20250514').model).toBe('Opus 4')
    expect(priceOf('claude-sonnet-4-5-20250929').model).toBe('Sonnet 4.5')
    expect(priceOf('claude-haiku-4-5-20251001').model).toBe('Haiku 4.5')
  })

  it('prices cache writes and reads, and the long-context tier', () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, cache writes 1.25× / 2× input.
    expect(costOf({ input_tokens: 1e6 }, 'claude-opus-5-5')).toBeCloseTo(4)
    expect(costOf({ output_tokens: 1e6 }, 'claude-opus-5-5')).toBeCloseTo(20)
    expect(costOf({ cache_read_input_tokens: 1e6 }, 'claude-opus-5-5')).toBeCloseTo(0.2)
    expect(costOf({ cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } }, 'claude-opus-5-5')).toBeCloseTo(8)
    expect(costOf({ cache_creation_input_tokens: 1e6 }, 'claude-sonnet-5-5')).toBeCloseTo(2.5)
    // Cache reads default to 0.1× input when the list gives no price.
    expect(costOf({ cache_read_input_tokens: 1e6 }, 'claude-opus-4-8')).toBeCloseTo(0.5)
    expect(costOf({ output_tokens: 1e6 }, 'claude-opus-4-1-20250805')).toBeCloseTo(75)
    // Haiku 5.5: $0.10 / $0.50 up to 100K prompt tokens, $0.50 / $2.50 above.
    expect(costOf({ input_tokens: 100_000, output_tokens: 1e6 }, 'claude-haiku-5-5')).toBeCloseTo(0.01 + 0.5)
    expect(costOf({ input_tokens: 50_000, cache_read_input_tokens: 60_000, output_tokens: 1e6 }, 'claude-haiku-5-5')).toBeCloseTo(0.025 + 0.003 + 2.5)
  })
})

describe('computeStats', () => {
  // 2026-11-03 12:00 in Shanghai = 04:00 UTC.
  const now = Date.UTC(2026, 10, 3, 4, 0)
  const entries = [
    // Today 09:00 Shanghai (01:00 UTC), account A.
    entry({ h: Date.UTC(2026, 10, 3, 1), s: 's1', c: 1, u: 2 }),
    // Yesterday 23:00 Shanghai (15:00 UTC on Nov 2), account B, Sonnet.
    entry({ h: Date.UTC(2026, 10, 2, 15), s: 's2', a: 'B', m: 'claude-sonnet-5-5', c: 0.25 }),
    // Same conversation later today on B after a switch; recorded as unknown with B's organization.
    entry({ h: Date.UTC(2026, 10, 3, 3), s: 's1', a: '', g: 'orgB', c: 1.5, n: 2 }),
    // Eight days ago (Oct 26): outside 7 days, inside 30.
    entry({ h: Date.UTC(2026, 9, 26, 4), s: 's3', c: 2 }),
    // Fifty days ago, a request nobody can be matched to.
    entry({ h: Date.UTC(2026, 8, 14, 4), s: 's4', a: '', c: 3 })
  ]
  const ctx: Omit<StatsContext, 'range'> = {
    accountId: 'all',
    now,
    timeZone: 'Asia/Shanghai',
    partial: false,
    note: 'note',
    accountOf: (e) => e.a || (e.g === 'orgB' ? 'B' : ''),
    accountLabel: (id) => (id ? { label: id === 'A' ? '主号' : '副号', email: `${id.toLowerCase()}@example.com`, kind: 'account' } : { label: '其他', kind: 'unknown' }),
    session: (id) => ({ s1: { title: '重构支付', cwd: 'D:\\projects\\shop' }, s2: { title: 'Redis', cwd: 'D:\\projects\\infra' }, s3: { cwd: 'D:\\projects\\shop' } })[id] ?? {}
  }

  it('sums per day in the chosen time zone and lists every day of the range', () => {
    const s = computeStats(entries, { ...ctx, range: '7d' })
    expect(s.days).toHaveLength(7)
    expect(s.days[6]).toMatchObject({ day: '2026-11-03', costUsd: 2.5, requests: 3, byAccount: { A: 1, B: 1.5 } })
    expect(s.days[5]).toMatchObject({ day: '2026-11-02', costUsd: 0.25 })
    expect(s.totals).toMatchObject({ costUsd: 2.75, requests: 4, conversations: 2, activeDays: 2 })
    expect(s.totals.tokens).toEqual({ input: 300, output: 30, cacheWrite5m: 120, cacheWrite1h: 30, cacheRead: 3000 })
    // 09:00 and 11:00 on a Tuesday (weekday 1), 23:00 on Monday (weekday 0); in dollars.
    expect(s.heatmap[1][9]).toBe(1)
    expect(s.heatmap[1][11]).toBe(1.5)
    expect(s.heatmap[0][23]).toBe(0.25)
    // The range starts on Oct 28, 00:00 in Shanghai.
    expect(s.from).toBe(Date.UTC(2026, 9, 27, 16))
    expect(s.pricing).toEqual({
      asOf: '2026-11-03',
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      currency: 'USD',
      note: 'note',
      webSearchUsd: 0.01,
      usOnlyMultiplier: 1.1
    })
    expect(s.totals.webSearches).toBe(0)
  })

  it('gives today by the hour and the fixed totals whatever the range', () => {
    const s = computeStats(entries, { ...ctx, range: 'today' })
    expect(s.days).toHaveLength(1)
    expect(s.hours?.[9].costUsd).toBe(1)
    expect(s.hours?.[11]).toMatchObject({ costUsd: 1.5, requests: 2 })
    // Today 2.5; November so far 2.5 + 0.25; everything 2.75 + 2 + 3.
    expect(s.fixed).toEqual({ todayUsd: 2.5, monthUsd: 2.75, allTimeUsd: 7.75 })
    expect(computeStats(entries, { ...ctx, range: '30d' }).fixed).toEqual(s.fixed)
  })

  it('starts "all" on the first recorded day', () => {
    const s = computeStats(entries, { ...ctx, range: 'all' })
    expect(s.firstDay).toBe('2026-09-14')
    expect(s.days[0].day).toBe('2026-09-14')
    expect(s.days.at(-1)?.day).toBe('2026-11-03')
    expect(s.totals.costUsd).toBe(7.75)
  })

  it('groups models, projects, conversations and accounts, keeping a name for unattributed requests', () => {
    const s = computeStats(entries, { ...ctx, range: '30d' })
    expect(s.models.map((m) => [m.label, m.costUsd, m.price.input])).toEqual([
      ['Opus 5.5', 4.5, 4],
      ['Sonnet 5.5', 0.25, 2]
    ])
    expect(s.projects[0]).toMatchObject({ name: 'shop', costUsd: 4.5, conversations: 2 })
    expect(s.topConversations[0]).toMatchObject({ cliSessionId: 's1', title: '重构支付', costUsd: 2.5, accountId: 'B' })
    expect(s.byAccount.map((a) => [a.label, a.costUsd, a.conversations])).toEqual([
      ['主号', 3, 2],
      ['副号', 1.75, 2]
    ])
    const everything = computeStats(entries, { ...ctx, range: 'all' })
    expect(everything.byAccount.find((a) => a.accountId === '')).toMatchObject({ label: '其他', kind: 'unknown', costUsd: 3 })
  })

  it('filters by account, fixed totals included', () => {
    const s = computeStats(entries, { ...ctx, range: '7d', accountId: 'B' })
    expect(s.accountId).toBe('B')
    expect(s.totals.costUsd).toBe(1.75)
    expect(s.byAccount.map((a) => a.accountId)).toEqual(['B'])
    expect(s.fixed).toEqual({ todayUsd: 1.5, monthUsd: 1.75, allTimeUsd: 1.75 })
  })

  it('writes one CSV row per day, account and model', () => {
    const header = ['日期', '账号', '邮箱', '模型', '输入', '输出', '写5分钟', '写1小时', '读取', '请求', '美元']
    const csv = ledgerCsv(entries, { ...ctx, range: '7d' }, header)
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe(header.join(','))
    expect(lines.slice(1)).toEqual([
      '2026-11-02,副号,b@example.com,Sonnet 5.5,100,10,40,10,1000,1,0.25',
      '2026-11-03,主号,a@example.com,Opus 5.5,100,10,40,10,1000,1,1.00',
      '2026-11-03,副号,b@example.com,Opus 5.5,100,10,40,10,1000,2,1.50'
    ])
    expect(ledgerCsv(entries, { ...ctx, range: 'all' }, header).trimEnd().split('\r\n')).toHaveLength(6)
    // Commas and quotes in a name are quoted.
    const odd = ledgerCsv(entries.slice(0, 1), { ...ctx, range: '7d', accountLabel: () => ({ label: 'a, "b"', kind: 'account' }) }, header)
    expect(odd.split('\r\n')[1]).toContain('"a, ""b"""')
  })

  it('reads clock time and weekday in a zone', () => {
    const c = zonedClock('America/Chicago')(Date.UTC(2026, 10, 3, 4))
    // 04:00 UTC = 22:00 the day before in Chicago (UTC−6 in November).
    expect(c).toEqual({ day: '2026-11-02', month: '2026-11', hour: 22, weekday: 0 })
  })
})
