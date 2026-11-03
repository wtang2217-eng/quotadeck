import { describe, expect, it } from 'vitest'
import { planFrom, planWeight } from '../src/main/core/plan'

describe('planFrom', () => {
  it('maps the rate limit tier', () => {
    expect(planFrom({ organizationRateLimitTier: 'default_claude_max_5x', organizationType: 'claude_max' })).toMatchObject({ kind: 'max5x', label: 'Max 5x', multiplier: 5 })
    expect(planFrom({ userRateLimitTier: 'default_claude_max_20x' })).toMatchObject({ kind: 'max20x', multiplier: 20 })
    expect(planFrom({ organizationType: 'claude_pro' })).toMatchObject({ kind: 'pro', multiplier: 1 })
    expect(planFrom({ organizationType: 'claude_team' })?.kind).toBe('team')
  })

  it('falls back to the subscription type from `claude auth status`', () => {
    expect(planFrom({}, 'pro')?.kind).toBe('pro')
    expect(planFrom({}, 'max')?.label).toBe('Max')
    expect(planFrom(undefined, undefined)).toBeUndefined()
  })

  it('keeps billing details', () => {
    expect(planFrom({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x', billingType: 'apple_subscription', hasExtraUsageEnabled: false })).toMatchObject({
      billing: 'apple_subscription',
      extraUsage: false
    })
  })

  it('weights plans by size', () => {
    expect(planWeight({ kind: 'max20x', label: 'Max 20x', multiplier: 20 })).toBeGreaterThan(planWeight({ kind: 'pro', label: 'Pro', multiplier: 1 }))
  })
})
