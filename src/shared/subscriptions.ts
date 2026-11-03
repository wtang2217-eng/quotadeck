// Monthly subscription prices from the official pricing page, for "how many times over did the plan pay off".
// Monthly billing; annual billing is cheaper (Pro $17 a month). Team and Enterprise are priced per seat and are left
// out of the comparison.

import type { PlanKind } from './types'

export const SUBSCRIPTION_PRICES = {
  asOf: '2026-11-03',
  source: 'https://claude.com/pricing',
  /** US dollars per month, billed monthly. The page sells Max 20x as "Ultra" ($200, upgrade link plan=max_20x). */
  monthlyUsd: { pro: 20, max5x: 100, max20x: 200, ultra: 200 } as Partial<Record<PlanKind, number>>
}

/** Monthly price of a plan, or undefined when it is not compared (free, Team, Enterprise, unknown). */
export function planMonthlyUsd(kind: PlanKind | undefined): number | undefined {
  return kind ? SUBSCRIPTION_PRICES.monthlyUsd[kind] : undefined
}
