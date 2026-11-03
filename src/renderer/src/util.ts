import { flushSync } from 'react-dom'
import { accountName, formatClock, formatIn } from '@shared/format'
import type { AccountStatus, AccountView, ActivityType, Language, LimitKind, PlanInfo, UsageSnapshot, UsageWindow } from '@shared/types'
import type { T, TKey } from './i18n'

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info' | 'accent'

export function statusTone(status: AccountStatus): Tone {
  switch (status) {
    case 'ok':
      return 'ok'
    case 'warn':
    case 'needs-login':
      return 'warn'
    case 'limited':
      return 'bad'
    default:
      return 'muted'
  }
}

export function statusKey(status: AccountStatus): TKey {
  switch (status) {
    case 'ok':
      return 'statusOk'
    case 'warn':
      return 'statusWarn'
    case 'limited':
      return 'statusLimited'
    case 'needs-login':
      return 'statusNeedsLogin'
    default:
      return 'statusUnknown'
  }
}

export function planText(plan: PlanInfo | undefined, t: T): string {
  if (!plan) return t('planUnknown')
  switch (plan.kind) {
    case 'free':
      return t('planFree')
    case 'team':
      return t('planTeam')
    case 'enterprise':
      return t('planEnterprise')
    case 'unknown':
      return plan.label || t('planUnknown')
    default:
      return plan.label
  }
}

export function limitKindKey(kind: LimitKind | undefined): TKey {
  if (kind === 'session') return 'limitKindSession'
  if (kind === 'weekly') return 'limitKindWeekly'
  return 'limitKindUnknown'
}

export function eventTone(type: ActivityType): Tone {
  switch (type) {
    case 'limit-hit':
    case 'error':
      return 'bad'
    case 'threshold':
      return 'warn'
    case 'reset':
      return 'ok'
    case 'switch':
    case 'login':
      return 'accent'
    case 'merge':
    case 'integration':
      return 'info'
    default:
      return 'muted'
  }
}

export function eventKey(type: ActivityType): TKey {
  const map: Record<ActivityType, TKey> = {
    'limit-hit': 'evLimitHit',
    threshold: 'evThreshold',
    reset: 'evReset',
    switch: 'evSwitch',
    merge: 'evMerge',
    login: 'evLogin',
    integration: 'evIntegration',
    error: 'evError',
    info: 'evInfo'
  }
  return map[type]
}

/** Level of a usage percentage for coloring: ok below warnAt, warn up to 100, bad at 100. */
export function pctLevel(pct: number | undefined, warnAt: number): 'ok' | 'warn' | 'bad' | 'na' {
  if (pct === undefined) return 'na'
  if (pct >= 100) return 'bad'
  if (pct >= warnAt) return 'warn'
  return 'ok'
}

/** Text under a meter: "2小时13分后恢复 · 18:40", or why it is unknown. */
export function resetText(
  w: UsageWindow | undefined,
  limitResetsAt: number | undefined,
  t: T,
  lang: Language,
  tz: string,
  now: number
): string {
  const resetsAt = w?.resetsAt && w.resetsAt > now ? w.resetsAt : limitResetsAt && limitResetsAt > now ? limitResetsAt : undefined
  if (resetsAt) return t('resetsInAt', { in: formatIn(resetsAt, lang, now), clock: formatClock(resetsAt, tz, lang, now) })
  if (!w) return ''
  if (w.pct <= 0) return t('notStarted')
  return t('resetUnknown')
}

export function usageSourceKey(u: UsageSnapshot | undefined): TKey {
  switch (u?.source) {
    case 'desktop':
      return 'sourceDesktop'
    case 'terminal':
      return 'sourceTerminal'
    case 'limit-event':
      return 'sourceLimitEvent'
    default:
      return 'sourceDemo'
  }
}

export function displayName(a: AccountView | undefined): string {
  return a ? accountName(a) : '—'
}

/** First visible character for an avatar. */
export function initial(a: Pick<AccountView, 'nickname' | 'email' | 'displayName' | 'id'>): string {
  const name = a.nickname || a.displayName || a.email || a.id
  const ch = Array.from(name.trim())[0] ?? '?'
  return ch.toUpperCase()
}

export function remaining(w: UsageWindow | undefined): number | undefined {
  return w ? Math.max(0, Math.round(100 - w.pct)) : undefined
}

/**
 * The number to show for a window: the live estimate when it is above the last real record, else the record.
 * Status chips and notifications keep using the record; this is for display only.
 */
export function shownPct(recorded: UsageWindow | undefined, estimate: number | undefined): { pct?: number; estimated: boolean } {
  if (estimate !== undefined && (recorded === undefined || estimate > recorded.pct + 0.5))
    return { pct: Math.min(100, Math.max(0, estimate)), estimated: true }
  return { pct: recorded?.pct, estimated: false }
}

/** Remaining percentage for a window, preferring the estimate as shownPct does. */
export function shownRemaining(recorded: UsageWindow | undefined, estimate: number | undefined): { left?: number; estimated: boolean } {
  const { pct, estimated } = shownPct(recorded, estimate)
  return { left: pct === undefined ? undefined : Math.max(0, Math.round(100 - pct)), estimated }
}

/** True when the OS asks for reduced motion, or motion was switched off with <html data-motion="off"> (screenshots). */
export function prefersReducedMotion(): boolean {
  try {
    return document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

type VT = { ready: Promise<void>; finished: Promise<void> }

/** Run a DOM-changing update inside a View Transition when the browser supports it. */
export function withViewTransition(update: () => void, opts?: { theme?: boolean }): VT | null {
  const start = (document as unknown as { startViewTransition?: (cb: () => void) => VT }).startViewTransition
  if (!start || prefersReducedMotion()) {
    update()
    return null
  }
  const root = document.documentElement
  if (opts?.theme) root.classList.add('vt-theme')
  try {
    const vt = start.call(document, () => flushSync(update))
    vt.finished.finally(() => root.classList.remove('vt-theme')).catch(() => undefined)
    return vt
  } catch {
    root.classList.remove('vt-theme')
    update()
    return null
  }
}

/** Theme reveal: the new theme grows as a circle from the clicked point. */
export function revealTheme(apply: () => void, x: number, y: number): void {
  const vt = withViewTransition(apply, { theme: true })
  if (!vt) return
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
      )
    })
    .catch(() => undefined)
}

export function resolveTheme(theme: 'system' | 'light' | 'dark'): 'light' | 'dark' {
  if (theme !== 'system') return theme
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
