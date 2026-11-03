import { describe, expect, it } from 'vitest'
import { renderStatusLine } from '../src/main/core/statusline'

const base = { lang: 'zh-CN' as const, timezone: 'UTC', warnAt: 80, criticalAt: 95, plain: true, now: Date.UTC(2026, 10, 3, 8, 0) }

describe('renderStatusLine', () => {
  it('shows both windows', () => {
    const s = renderStatusLine({
      ...base,
      accountName: '主号',
      planLabel: 'Max 5x',
      usage: { at: base.now, source: 'terminal', fiveHour: { pct: 42, resetsAt: Date.UTC(2026, 10, 3, 11, 30) }, sevenDay: { pct: 18 } }
    })
    expect(s).toContain('主号')
    expect(s).toContain('42%')
    expect(s).toContain('11:30')
    expect(s).toContain('周 18%')
  })

  it('suggests another account when running low', () => {
    const s = renderStatusLine({
      ...base,
      accountName: 'A',
      usage: { at: base.now, source: 'terminal', fiveHour: { pct: 91 } },
      suggestion: { name: 'B', remainingPct: 70 }
    })
    expect(s).toContain('建议换到 B')
  })

  it('says when the limit is reached', () => {
    const s = renderStatusLine({ ...base, lang: 'en', accountName: 'A', limited: { resetsAt: Date.UTC(2026, 10, 3, 9, 15) } })
    expect(s).toContain('limit reached · resets 09:15')
  })

  it('handles unknown accounts and missing usage', () => {
    expect(renderStatusLine({ ...base })).toContain('还没加入面板')
    expect(renderStatusLine({ ...base, accountName: 'A' })).toContain('第一条回复后')
  })
})
