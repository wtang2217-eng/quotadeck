import type { PlanInfo, PlanKind } from '@shared/types'

/** The fields of Claude Code's `oauthAccount` (in .claude.json) that describe the plan. */
export interface OauthAccountLike {
  accountUuid?: string
  emailAddress?: string
  organizationUuid?: string
  displayName?: string
  userRateLimitTier?: string | null
  organizationRateLimitTier?: string | null
  organizationType?: string | null
  billingType?: string | null
  hasExtraUsageEnabled?: boolean | null
}

const LABELS: Record<PlanKind, string> = {
  free: 'Free',
  pro: 'Pro',
  max5x: 'Max 5x',
  max20x: 'Max 20x',
  ultra: 'Ultra',
  team: 'Team',
  enterprise: 'Enterprise',
  unknown: 'Unknown'
}

/**
 * Work out the plan from what Claude Code stores about the signed-in account, optionally helped by
 * `subscriptionType` from `claude auth status --json` ("pro", "max", ...).
 */
export function planFrom(o: OauthAccountLike | undefined, subscriptionType?: string): PlanInfo | undefined {
  const tier = `${o?.userRateLimitTier ?? ''} ${o?.organizationRateLimitTier ?? ''}`.toLowerCase()
  const kindText = `${o?.organizationType ?? ''} ${subscriptionType ?? ''}`.toLowerCase()
  if (!tier.trim() && !kindText.trim()) return undefined

  let kind: PlanKind = 'unknown'
  let multiplier: number | undefined
  let label: string | undefined
  if (/max_?20x|\b20x\b/.test(tier)) {
    kind = 'max20x'
    multiplier = 20
  } else if (/max_?5x|\b5x\b/.test(tier)) {
    kind = 'max5x'
    multiplier = 5
  } else if (/ultra/.test(tier + kindText)) {
    kind = 'ultra'
  } else if (/enterprise/.test(kindText)) {
    kind = 'enterprise'
  } else if (/team/.test(kindText)) {
    kind = 'team'
  } else if (/max/.test(kindText + tier)) {
    label = 'Max'
  } else if (/\bpro\b|claude_pro|default_claude_ai/.test(kindText + ' ' + tier)) {
    kind = 'pro'
    multiplier = 1
  } else if (/free/.test(kindText)) {
    kind = 'free'
  }

  return {
    kind,
    label: label ?? LABELS[kind],
    multiplier,
    billing: o?.billingType ?? undefined,
    extraUsage: o?.hasExtraUsageEnabled ?? undefined
  }
}

/** Relative size of a plan's allowance, used to rank accounts when recommending one. */
export function planWeight(plan: PlanInfo | undefined): number {
  if (!plan) return 1
  if (plan.multiplier) return plan.multiplier
  switch (plan.kind) {
    case 'ultra':
      return 40
    case 'team':
    case 'enterprise':
      return 5
    case 'free':
      return 0.2
    default:
      return plan.label === 'Max' ? 5 : 1
  }
}
