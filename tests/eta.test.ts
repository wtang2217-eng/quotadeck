import { describe, expect, it } from 'vitest'
import { computeEta } from '../src/main/core/eta'

const MIN = 60_000
const HOUR = 60 * MIN
const now = Date.UTC(2026, 10, 3, 12, 0)

describe('computeEta', () => {
  it('forecasts from the tokens of the last 45 minutes and the learned rate', () => {
    // 2 points per unit, 0.25 unit every 5 minutes for 40 minutes = 2 units in 40 min = 4 points / 40 min = 6 %/h.
    const events = Array.from({ length: 9 }, (_, i) => ({ t: now - 40 * MIN + i * 5 * MIN, u: 0.25 }))
    const eta = computeEta({ now, fiveHour: 70, fiveHourResetsAt: now + 6 * HOUR, points: [], rate: { fh: 2 }, events })!
    // 9 replies × 0.25 = 2.25 units × 2 = 4.5 points over 40 minutes.
    expect(eta.basis).toBe('estimate')
    expect(eta.fiveHourPerHour).toBeCloseTo(6.8, 1)
    expect(eta.fiveHourFullAt).toBeGreaterThan(now + 4 * HOUR)
    expect(eta.fiveHourFullAt).toBeLessThan(now + 5 * HOUR)
  })

  it('says nothing while the account is idle', () => {
    const events = [{ t: now - 30 * MIN, u: 5 }]
    expect(computeEta({ now, fiveHour: 90, points: [], rate: { fh: 2 }, events })).toBeUndefined()
  })

  it('says nothing when the window resets before it would fill', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({ t: now - 20 * MIN + i * 5 * MIN, u: 1 }))
    // 5 units × 1 point in 20 min = 15 %/h; 50 points left = 3.3 h, but the window resets in 1 h.
    expect(computeEta({ now, fiveHour: 50, fiveHourResetsAt: now + HOUR, points: [], rate: { fh: 1 }, events })).toBeUndefined()
  })

  it('falls back to recorded percentages and ignores readings before a reset', () => {
    const points = [
      { t: now - 50 * MIN, fh: 80 },
      { t: now - 40 * MIN, fh: 2 },
      { t: now - 25 * MIN, fh: 20 },
      { t: now - 10 * MIN, fh: 38 }
    ]
    const eta = computeEta({ now, fiveHour: 50, points })!
    // From 2% 40 minutes ago to 50% now: 72 %/h, 50 points left ≈ 42 minutes.
    expect(eta.basis).toBe('records')
    expect(eta.fiveHourPerHour).toBeCloseTo(72, 0)
    expect(Math.round((eta.fiveHourFullAt! - now) / MIN)).toBe(42)
  })

  it('forecasts the weekly window from a day of records', () => {
    const points = [
      { t: now - 20 * HOUR, sd: 40 },
      { t: now - 10 * HOUR, sd: 50 },
      { t: now - HOUR, sd: 59 }
    ]
    // 20 points in 20 hours: 40 points left = 40 hours.
    const eta = computeEta({ now, sevenDay: 60, sevenDayResetsAt: now + 4 * 24 * HOUR, points })!
    expect(Math.round((eta.sevenDayFullAt! - now) / HOUR)).toBe(40)
    expect(eta.fiveHourFullAt).toBeUndefined()
    // Not before the reset: no forecast.
    expect(computeEta({ now, sevenDay: 60, sevenDayResetsAt: now + 30 * HOUR, points })).toBeUndefined()
  })
})
