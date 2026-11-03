import { describe, expect, it } from 'vitest'
import type { UsageBucket } from '../src/main/core/estimate'
import { costOf, modelInfo } from '../src/main/core/pricing'
import { computeStats, zonedClock } from '../src/main/core/stats'

const HOUR = 3_600_000

const bucket = (p: Partial<UsageBucket> & { h: number; s: string }): UsageBucket => ({
  m: 'claude-opus-5-5',
  u: 1,
  n: 1,
  i: 100,
  o: 10,
  r: 1000,
  w: 50,
  c: 0.5,
  t: p.h + 10 * 60_000,
  ...p
})

describe('modelInfo and costOf', () => {
  it('reads family and version from current and older model ids', () => {
    expect(modelInfo('claude-opus-5-5').label).toBe('Opus 5.5')
    expect(modelInfo('claude-opus-4-1-20250805').label).toBe('Opus 4.1')
    expect(modelInfo('claude-opus-4-20250514').label).toBe('Opus 4')
    expect(modelInfo('claude-3-5-haiku-20241022')).toMatchObject({ family: 'haiku', label: 'Haiku 3.5' })
    expect(modelInfo('claude-fable-5-1')).toMatchObject({ family: 'fable', label: 'Fable 5.1' })
    expect(modelInfo('something-else').family).toBe('other')
  })

  it('prices tokens at the list price of the model', () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, cache write 1.25× / 2× input.
    expect(costOf({ input_tokens: 1e6 }, 'claude-opus-5-5')).toBeCloseTo(4)
    expect(costOf({ output_tokens: 1e6 }, 'claude-opus-5-5')).toBeCloseTo(20)
    expect(costOf({ cache_read_input_tokens: 1e6 }, 'claude-opus-5-5')).toBeCloseTo(0.2)
    expect(costOf({ cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } }, 'claude-opus-5-5')).toBeCloseTo(8)
    expect(costOf({ cache_creation_input_tokens: 1e6 }, 'claude-sonnet-5-5')).toBeCloseTo(2.5)
    // Older Opus models cost more.
    expect(costOf({ output_tokens: 1e6 }, 'claude-opus-4-1-20250805')).toBeCloseTo(75)
  })
})

describe('computeStats', () => {
  // 2026-11-03 12:00 in Shanghai = 04:00 UTC.
  const now = Date.UTC(2026, 10, 3, 4, 0)
  const tz = 'Asia/Shanghai'
  const buckets = [
    // Today 09:00 Shanghai (01:00 UTC), account A, project shop.
    bucket({ h: Date.UTC(2026, 10, 3, 1), s: 's1', u: 2, c: 1 }),
    // Yesterday 23:00 Shanghai (15:00 UTC on Nov 2), account B, Sonnet.
    bucket({ h: Date.UTC(2026, 10, 2, 15), s: 's2', m: 'claude-sonnet-5-5', u: 1, c: 0.25 }),
    // Same conversation later today, after a switch to account B.
    bucket({ h: Date.UTC(2026, 10, 3, 3), s: 's1', u: 3, c: 1.5, g: 'orgB' }),
    // Eight days ago: outside the 7-day range, inside 30 days.
    bucket({ h: Date.UTC(2026, 9, 26, 4), s: 's3', u: 4, c: 2 })
  ]
  const ctx = {
    now,
    timeZone: tz,
    partial: false,
    accountOf: (b: UsageBucket) => (b.s === 's2' || b.g === 'orgB' ? 'B' : 'A'),
    session: (id: string) => ({ s1: { title: '重构支付', cwd: 'D:\\projects\\shop' }, s2: { title: 'Redis', cwd: 'D:\\projects\\infra' }, s3: { cwd: 'D:\\projects\\shop' } })[id] ?? {}
  }

  it('sums per day in the chosen time zone and lists every day of the range', () => {
    const s = computeStats(buckets, { ...ctx, range: '7d' })
    expect(s.days).toHaveLength(7)
    expect(s.days[6].day).toBe('2026-11-03')
    expect(s.days[6].units).toBe(5)
    expect(s.days[5]).toMatchObject({ day: '2026-11-02', units: 1 })
    expect(s.totals).toMatchObject({ units: 6, costUsd: 2.75, replies: 3, conversations: 2, activeDays: 2 })
    // 09:00 and 11:00 on a Tuesday (weekday 1), 23:00 on Monday (weekday 0).
    expect(s.heatmap[1][9]).toBe(2)
    expect(s.heatmap[1][11]).toBe(3)
    expect(s.heatmap[0][23]).toBe(1)
    // The range starts on Oct 28, 00:00 in Shanghai.
    expect(s.from).toBe(Date.UTC(2026, 9, 27, 16))
  })

  it('groups models, projects, conversations and accounts', () => {
    const s = computeStats(buckets, { ...ctx, range: '30d' })
    expect(s.models.map((m) => [m.label, m.units])).toEqual([
      ['Opus 5.5', 9],
      ['Sonnet 5.5', 1]
    ])
    expect(s.projects[0]).toMatchObject({ name: 'shop', units: 9, conversations: 2 })
    expect(s.topConversations[0]).toMatchObject({ cliSessionId: 's1', title: '重构支付', units: 5, accountId: 'B' })
    expect(s.byAccount).toEqual([
      { accountId: 'A', units: 6, costUsd: 3, replies: 2 },
      { accountId: 'B', units: 4, costUsd: 1.75, replies: 2 }
    ])
  })

  it('filters by account', () => {
    const s = computeStats(buckets, { ...ctx, range: '7d', accountId: 'B' })
    expect(s.totals.units).toBe(4)
    expect(s.topConversations.map((c) => c.cliSessionId).sort()).toEqual(['s1', 's2'])
  })

  it('reads clock time and weekday in a zone', () => {
    const c = zonedClock('America/Chicago')(Date.UTC(2026, 10, 3, 4))
    // 04:00 UTC = 22:00 the day before in Chicago (UTC−6 in November).
    expect(c).toEqual({ day: '2026-11-02', hour: 22, weekday: 0 })
    expect(zonedClock('Asia/Shanghai')(HOUR * 0)).toMatchObject({ day: '1970-01-01', hour: 8 })
  })
})
