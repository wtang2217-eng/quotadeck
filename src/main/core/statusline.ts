// The one-line status Claude Code shows at the bottom of terminal sessions.

import { formatClock } from '@shared/format'
import type { Language, UsageSnapshot } from '@shared/types'

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
}

export interface StatusLineInput {
  lang: Language
  timezone: string
  warnAt: number
  criticalAt: number
  /** Undefined when the session's account is not in QuotaDeck. */
  accountName?: string
  planLabel?: string
  usage?: UsageSnapshot
  limited?: { resetsAt?: number }
  /** Suggested account when this one is running low. */
  suggestion?: { name: string; remainingPct?: number }
  now?: number
  /** Disable colors (tests). */
  plain?: boolean
}

function bar(pct: number, cells = 8): string {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export function renderStatusLine(i: StatusLineInput): string {
  const zh = i.lang === 'zh-CN'
  const now = i.now ?? Date.now()
  const paint = (color: string, s: string) => (i.plain ? s : `${color}${s}${C.reset}`)
  const level = (pct: number) => (pct >= i.criticalAt ? C.red : pct >= i.warnAt ? C.yellow : C.green)
  const sep = paint(C.dim, ' │ ')

  if (!i.accountName) {
    return `${paint(C.magenta, '◆')} QuotaDeck${sep}${zh ? '这个账号还没加入面板' : 'this account is not in QuotaDeck yet'}`
  }
  const head = `${paint(C.magenta, '◆')} ${paint(C.bold, i.accountName)}${i.planLabel ? ' ' + paint(C.dim, i.planLabel) : ''}`

  if (i.limited) {
    const when = i.limited.resetsAt ? formatClock(i.limited.resetsAt, i.timezone, i.lang, now) : zh ? '时间未知' : 'unknown'
    const tip = i.suggestion ? `${sep}${zh ? '可换到' : 'switch to'} ${paint(C.cyan, i.suggestion.name)}` : ''
    return `${head}${sep}${paint(C.red, zh ? `额度已用完 · ${when} 恢复` : `limit reached · resets ${when}`)}${tip}`
  }

  const parts: string[] = []
  const fh = i.usage?.fiveHour
  const sd = i.usage?.sevenDay
  if (fh) {
    const when = fh.resetsAt ? ` · ${formatClock(fh.resetsAt, i.timezone, i.lang, now)}` : ''
    parts.push(`5h ${paint(level(fh.pct), `${bar(fh.pct)} ${Math.round(fh.pct)}%`)}${paint(C.dim, when)}`)
  }
  if (sd) parts.push(`${zh ? '周' : 'wk'} ${paint(level(sd.pct), `${Math.round(sd.pct)}%`)}`)
  if (!parts.length) return `${head}${sep}${paint(C.dim, zh ? '第一条回复后显示额度' : 'usage appears after the first reply')}`

  const peak = Math.max(fh?.pct ?? 0, sd?.pct ?? 0)
  const tip =
    i.suggestion && peak >= i.warnAt
      ? `${sep}${zh ? '建议换到' : 'next:'} ${paint(C.cyan, i.suggestion.name)}${i.suggestion.remainingPct !== undefined ? paint(C.dim, ` ${zh ? '剩' : ''}${Math.round(i.suggestion.remainingPct)}%`) : ''}`
      : ''
  return `${head}${sep}${parts.join(sep)}${tip}`
}
