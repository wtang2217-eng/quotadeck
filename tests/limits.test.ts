import { describe, expect, it } from 'vitest'
import { isUsageLimitMessage, limitKindOf, parseLimitMessage, zonedToEpoch } from '../src/main/core/limits'

describe('parseLimitMessage', () => {
  // 2026-11-03 15:00 in Chicago (UTC-6 after DST ends on Nov 1) = 21:00 UTC
  const now = Date.UTC(2026, 10, 3, 21, 0)

  it('reads a session limit with a time later today', () => {
    const r = parseLimitMessage("You've hit your session limit · resets 11:10pm (America/Chicago)", now)
    expect(r?.kind).toBe('session')
    expect(r?.resetsAt).toBe(Date.UTC(2026, 10, 4, 5, 10))
  })

  it('rolls over to tomorrow when the time already passed', () => {
    const r = parseLimitMessage("You've hit your session limit · resets 9am (America/Chicago)", now)
    expect(r?.resetsAt).toBe(Date.UTC(2026, 10, 4, 15, 0))
  })

  it('reads a weekly limit with a date', () => {
    const r = parseLimitMessage("You've hit your weekly limit · resets Nov 7, 11am (America/Chicago)", now)
    expect(r?.kind).toBe('weekly')
    expect(r?.resetsAt).toBe(Date.UTC(2026, 10, 7, 17, 0))
  })

  it('handles other zones and 12am/12pm', () => {
    expect(parseLimitMessage('resets 12am (Asia/Shanghai)', now)?.resetsAt).toBe(Date.UTC(2026, 10, 4, 16, 0))
    expect(parseLimitMessage('resets 12pm (Asia/Shanghai)', now)?.resetsAt).toBe(Date.UTC(2026, 10, 4, 4, 0))
  })

  it('reads the old epoch format', () => {
    expect(parseLimitMessage('Claude AI usage limit reached|1793750400', now)?.resetsAt).toBe(1793750400 * 1000)
  })

  it('keeps the kind when there is no reset time', () => {
    expect(parseLimitMessage("You've hit your weekly limit", now)).toEqual({ kind: 'weekly' })
    expect(parseLimitMessage('API Error: Rate limit reached', now)).toBeUndefined()
  })

  it('tells usage limits from transient rate limiting', () => {
    expect(isUsageLimitMessage("You've hit your session limit · resets 3pm")).toBe(true)
    expect(isUsageLimitMessage('API Error: Rate limit reached')).toBe(false)
    expect(limitKindOf('5-hour limit reached')).toBe('session')
  })

  it('converts wall time in a zone across DST', () => {
    expect(zonedToEpoch(2026, 6, 1, 12, 0, 'America/Chicago')).toBe(Date.UTC(2026, 6, 1, 17, 0))
    expect(zonedToEpoch(2026, 11, 1, 12, 0, 'America/Chicago')).toBe(Date.UTC(2026, 11, 1, 18, 0))
  })
})
