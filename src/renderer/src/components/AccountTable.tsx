// The accounts as a table: one row each, usage meters inline, the desktop account marked with an accent rule.

import { formatClock, formatIn } from '@shared/format'
import type { AccountView, UsageEstimate, UsageSnapshot, UsageWindow } from '@shared/types'
import { useApp } from '../context'
import type { T, TKey } from '../i18n'
import { displayName, pctLevel, planText, shownPct, statusKey } from '../util'
import { IconFolder, IconLogin, IconMonitor, IconMore, IconPencil, IconTerminal, IconTrash } from './icons'
import { Menu } from './Menu'

const COLS = 'minmax(200px, 1.8fr) minmax(132px, 1.2fr) minmax(132px, 1.2fr) 76px 92px 128px'

function estimateTip(est: UsageEstimate | undefined, usage: UsageSnapshot | undefined, recorded: UsageWindow | undefined, t: T, clock: (ts: number) => string): string | undefined {
  if (!est) return undefined
  const recordAt = est.fromRecordAt ?? usage?.at
  const parts = [
    recordAt !== undefined && recorded
      ? t(usage?.source === 'desktop' ? 'estTipDesktop' : 'estTipGeneric', { pct: Math.round(recorded.pct), clock: clock(recordAt) })
      : t('estTipNoRecord')
  ]
  if (est.basis === 'plan-ratio') parts.push(t('estTipPlanRatio'))
  return parts.join('\n')
}

/** Percent, reset time and a thin bar. The estimate above the last record draws lighter. */
export function MeterCell({
  w,
  estimatePct,
  estimateResetsAt,
  limitResetsAt,
  tip,
  compact,
  label
}: {
  w: UsageWindow | undefined
  estimatePct?: number
  estimateResetsAt?: number
  limitResetsAt?: number
  tip?: string
  /** Percent and bar only, for narrow places. */
  compact?: boolean
  /** Small name of the window before the percent (compact rows). */
  label?: string
}) {
  const { t, lang, tz, now, state } = useApp()
  const recorded = w ? Math.min(100, Math.max(0, w.pct)) : 0
  const shown = shownPct(w, estimatePct)
  const level = pctLevel(w?.pct ?? shown.pct, state.settings.warnAt)
  const cls = level === 'warn' ? ' warn' : level === 'bad' ? ' bad' : ''
  const extra = shown.estimated && shown.pct !== undefined ? Math.max(0, shown.pct - recorded) : 0
  const realReset = w?.resetsAt && w.resetsAt > now ? w.resetsAt : limitResetsAt && limitResetsAt > now ? limitResetsAt : undefined
  const reset = realReset ?? (estimateResetsAt && estimateResetsAt > now ? estimateResetsAt : undefined)
  const resetLabel = compact
    ? ''
    : reset
      ? t('resetAt', { clock: formatClock(reset, tz, lang, now) })
      : w && w.pct <= 0
        ? t('notStartedShort')
        : w
          ? t('resetUnknownShort')
          : ''
  const showTip = shown.estimated && tip
  return (
    <div className={`meter-cell${showTip ? ' has-tip tip-start' : ''}`} data-tip={showTip ? tip : undefined} tabIndex={showTip ? 0 : undefined}>
      <div className="meter-top">
        {label && <span className="meter-label">{label}</span>}
        <span className={`meter-pct${shown.pct === undefined ? ' na' : cls}`}>
          {shown.pct === undefined ? '—' : `${shown.estimated ? t('approx') : ''}${Math.round(shown.pct)}%`}
        </span>
        {resetLabel && (
          <span className="meter-reset has-tip-anchor" title={reset ? formatIn(reset, lang, now) : undefined}>
            {resetLabel}
          </span>
        )}
      </div>
      <div className="meter" aria-hidden="true">
        {w && <div className={`meter-fill${cls}`} style={{ width: `${recorded}%` }} />}
        {extra > 0 && <div className={`meter-est${cls}`} style={{ left: `${recorded}%`, width: `${extra}%` }} />}
      </div>
    </div>
  )
}

export function statusView(a: AccountView, t: T, clock: (ts: number) => string): { text: string; tone: '' | 'warn' | 'bad'; sub?: string } {
  if (a.status === 'limited') return { text: t('statusLimited'), tone: 'bad', sub: a.limit?.resetsAt ? t('resetAt', { clock: clock(a.limit.resetsAt) }) : undefined }
  if (a.status === 'warn') return { text: t('statusWarn'), tone: 'warn' }
  if (a.status === 'needs-login') return { text: t('statusNeedsLogin'), tone: 'warn' }
  return { text: t(statusKey(a.status) as TKey), tone: '' }
}

export function AccountTable({ accounts, onScope }: { accounts: AccountView[]; onScope?: (id: string) => void }) {
  const { t, lang, tz, now, openDialog, api, toast } = useApp()
  const clock = (ts: number) => formatClock(ts, tz, lang, now)
  return (
    <div className="dt" role="table" style={{ ['--cols' as string]: COLS }}>
      <div className="dt-row dt-head" role="row">
        <span>{t('colAccount')}</span>
        <span>{t('fiveHour')}</span>
        <span>{t('sevenDay')}</span>
        <span>{t('colEta')}</span>
        <span>{t('colStatus')}</span>
        <span className="r" />
      </div>
      <div className="dt-body">
        {accounts.map((a) => {
          const u = a.usage
          const est = a.estimate
          const st = statusView(a, t, clock)
          const eta = a.eta?.fiveHourFullAt ?? a.eta?.sevenDayFullAt
          const menu = [
            { label: t('actContinueTerminal'), icon: <IconTerminal />, disabled: !a.cliConfigDir, onSelect: () => openDialog({ type: 'switch', mode: 'terminal', toAccountId: a.id }) },
            { label: t('menuEdit'), icon: <IconPencil />, onSelect: () => openDialog({ type: 'edit', accountId: a.id }) },
            { label: t('menuReLogin'), icon: <IconLogin />, onSelect: () => openDialog({ type: 'add', reLoginAccountId: a.id }) },
            ...(a.cliConfigDir
              ? [{ label: t('menuOpenProfile'), icon: <IconFolder />, onSelect: () => void api.openPath(a.cliConfigDir!).catch((e) => toast(String(e), 'bad')) }]
              : []),
            'sep' as const,
            { label: t('menuRemove'), icon: <IconTrash />, danger: true, onSelect: () => openDialog({ type: 'remove', accountId: a.id }) }
          ]
          return (
            <div key={a.id} className={`dt-row${a.isDesktopCurrent ? ' is-current' : ''}`} role="row">
              <div className="dt-cell">
                <div className="dt-name">
                  {onScope ? (
                    <button type="button" className="dt-name-btn ellipsis" onClick={() => onScope(a.id)}>
                      {displayName(a)}
                    </button>
                  ) : (
                    <span className="ellipsis">{displayName(a)}</span>
                  )}
                </div>
                <div className="dt-sub dt-sub-row">
                  <span className="ellipsis">{a.nickname && a.email ? `${planText(a.plan, t)} · ${a.email}` : planText(a.plan, t)}</span>
                  {a.isDesktopCurrent && (
                    <span className="tag tag-accent">
                      <IconMonitor size={12} />
                      {t('tagDesktop')}
                    </span>
                  )}
                </div>
              </div>
              <MeterCell
                w={u?.fiveHour}
                estimatePct={est?.fiveHour}
                estimateResetsAt={est?.fiveHourResetsAt}
                limitResetsAt={a.limit?.kind === 'session' ? a.limit.resetsAt : undefined}
                tip={estimateTip(est, u, u?.fiveHour, t, clock)}
              />
              <MeterCell
                w={u?.sevenDay}
                estimatePct={est?.sevenDay}
                limitResetsAt={a.limit?.kind === 'weekly' ? a.limit.resetsAt : undefined}
                tip={estimateTip(est, u, u?.sevenDay, t, clock)}
              />
              <span className={`dt-num${eta ? '' : ' dim'}`} title={a.eta?.fiveHourPerHour ? `${Math.round(a.eta.fiveHourPerHour)}%/h` : undefined}>
                {eta ? clock(eta) : '—'}
              </span>
              <div className="dt-cell">
                <span className={`status${st.tone ? ` ${st.tone}` : ''}`}>
                  {st.tone && <span className={`dot ${st.tone}`} />}
                  {st.text}
                </span>
                {st.sub && <div className="dt-sub">{st.sub}</div>}
              </div>
              <div className="dt-actions">
                {a.status === 'needs-login' ? (
                  <button type="button" className="btn btn-sm" onClick={() => openDialog({ type: 'add', reLoginAccountId: a.id })}>
                    {t('actReLogin')}
                  </button>
                ) : a.isDesktopCurrent ? (
                  <span className="dt-num dim" style={{ fontSize: 12.5 }}>
                    {t('actInUse')}
                  </span>
                ) : (
                  <button type="button" className="btn btn-sm" data-sound="none" onClick={() => openDialog({ type: 'switch', mode: 'desktop', toAccountId: a.id })}>
                    {t('actSwitchDesktop')}
                  </button>
                )}
                <Menu
                  label={t('more')}
                  items={menu}
                  trigger={({ toggle }) => (
                    <button type="button" className="icon-btn" aria-label={t('more')} onClick={toggle}>
                      <IconMore />
                    </button>
                  )}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
