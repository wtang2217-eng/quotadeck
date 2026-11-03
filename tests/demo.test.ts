// The demo ledger must look like a real one on every range, because screenshots and the preview are built from it.
import { describe, expect, it } from 'vitest'
import { demoSetupStatus, demoState, demoStats } from '../src/shared/demo'

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
      expect(s.byAccount).toHaveLength(3)
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

  it('has a first-start setup checklist and a finished one', () => {
    expect(demoSetupStatus('zh-CN', true).ready).toBe(false)
    expect(demoSetupStatus('zh-CN', false).ready).toBe(true)
  })
})
