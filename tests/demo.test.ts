// The demo ledger must look like a real one on every range, because screenshots and the preview are built from it.
import { describe, expect, it } from 'vitest'
import { DEMO_OLD_ORG, demoSetupStatus, demoState, demoStats, setDemoOrgLabel } from '../src/shared/demo'

describe('demo statistics', () => {
  const now = Date.UTC(2026, 10, 3, 12, 30)
  const ids = demoState('zh-CN', now).accounts.map((a) => a.id)

  for (const range of ['today', '7d', '30d', '90d', 'all'] as const) {
    it(`adds up for ${range}`, () => {
      const s = demoStats('zh-CN', range, undefined, now)
      const days = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 75
      expect(s.days).toHaveLength(days)
      const sum = s.days.reduce((x, d) => x + d.costUsd, 0)
      expect(Math.abs(sum - s.totals.costUsd)).toBeLessThan(0.05 * days)
      expect(s.models.map((m) => m.label).sort()).toEqual(['Fable 5.1', 'Haiku 5.5', 'Opus 5.5', 'Sonnet 5.5'])
      // The old account was only used 35 to 74 days ago, so it only shows on the long ranges.
      const old = s.byAccount.find((a) => a.kind === 'org')
      expect(s.byAccount).toHaveLength(range === '90d' || range === 'all' ? 4 : 3)
      if (old) expect(old).toMatchObject({ accountId: `org:${DEMO_OLD_ORG}`, orgUuid: DEMO_OLD_ORG, label: '旧号' })
      // The total is exactly the sum of the rows.
      expect(Math.round(s.byAccount.reduce((x, a) => x + a.costUsd, 0) * 100) / 100).toBe(s.totals.costUsd)
      expect(s.fixed.todayUsd).toBeLessThanOrEqual(s.fixed.monthUsd)
      expect(s.fixed.monthUsd).toBeLessThanOrEqual(s.fixed.allTimeUsd)
      expect(s.heatmap).toHaveLength(7)
      expect(s.topConversations).toHaveLength(10)
      expect(s.pricing.note).toContain('仅供参考')
      expect(Number.isFinite(s.totals.tokens.cacheWrite1h)).toBe(true)
      if (range === 'today') expect(s.hours).toHaveLength(24)
    })
  }

  it('narrows to one account', () => {
    const one = demoStats('en', '30d', ids[1], now)
    const all = demoStats('en', '30d', 'all', now)
    expect(one.accountId).toBe(ids[1])
    expect(one.byAccount.map((a) => a.accountId)).toEqual([ids[1]])
    expect(one.totals.costUsd).toBeLessThan(all.totals.costUsd)
    expect(one.pricing.note).toContain('reference only')
  })

  it('names the old account, renames it, and filters by it', () => {
    const before = demoStats('zh-CN', 'all', undefined, now)
    const old = before.byAccount.find((a) => a.kind === 'org')!
    expect(old.label).toBe('旧号')
    setDemoOrgLabel(DEMO_OLD_ORG, '被封的主号')
    expect(demoStats('zh-CN', 'all', undefined, now).byAccount.find((a) => a.kind === 'org')?.label).toBe('被封的主号')
    setDemoOrgLabel(DEMO_OLD_ORG, '')
    expect(demoStats('zh-CN', 'all', undefined, now).byAccount.find((a) => a.kind === 'org')?.label).toBe('旧号')
    const only = demoStats('zh-CN', 'all', `org:${DEMO_OLD_ORG}`, now)
    expect(only.byAccount.map((a) => a.accountId)).toEqual([`org:${DEMO_OLD_ORG}`])
    expect(only.totals.costUsd).toBe(old.costUsd)
    // Not used in the last 35 days.
    expect(only.days.slice(-35).every((d) => d.requests === 0)).toBe(true)
  })

  it('has a first-start setup checklist and a finished one', () => {
    expect(demoSetupStatus('zh-CN', true).ready).toBe(false)
    expect(demoSetupStatus('zh-CN', false).ready).toBe(true)
  })
})
