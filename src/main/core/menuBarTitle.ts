// The text macOS shows next to the menu bar icon.

import { clampPct, formatClock } from '@shared/format'
import type { AccountView, AppState } from '@shared/types'

/** The menu bar title on macOS: the desktop account's 5-hour usage, or when it is back if it hit the limit. */
export function menuBarTitle(state: AppState, a: AccountView | undefined): string {
  if (!a || !state.settings.trayShowPercent) return ''
  if (a.status === 'limited' && a.limit?.resetsAt) return `↻${formatClock(a.limit.resetsAt, state.settings.timezone, state.settings.language)}`
  const recorded = a.usage?.fiveHour?.pct
  const est = a.estimate?.fiveHour
  // Same rule as the account card: the estimate counts only when it is above the recorded value.
  const estimated = est !== undefined && (recorded === undefined || est > recorded + 0.5)
  const pct = estimated ? est : recorded
  if (pct === undefined) return a.status === 'limited' ? '100%' : ''
  return `${estimated ? '~' : ''}${Math.round(clampPct(pct))}%`
}
