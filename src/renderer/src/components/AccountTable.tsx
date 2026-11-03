// The accounts as a table: one row each, usage meters inline, the desktop account marked with an accent rule.

import { formatAgo, formatClock, formatIn } from '@shared/format'
import type { AccountView, Language, UsageEstimate, UsageSnapshot, UsageWindow } from '@shared/types'
import { useApp } from '../context'
import type { T, TKey } from '../i18n'
import { displayName, pctLevel, planText, shownPct, statusKey } from '../util'
import { IconFolder, IconLogin, IconMonitor, IconMore, IconPencil, IconTerminal, IconTrash } from './icons'
import { Menu } from './Menu'

const COLS = 'minmax(180px, 1.45fr) minmax(156px, 1.35fr) minmax(156px, 1.35fr) 70px 90px 128px'

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

const WINDOW_MS = { fh: 5 * 3600_000, sd: 7 * 24 * 3600_000 } as const
/** A record older than this may be out of date (the desktop app writes one about every 15 minutes while in use). */
const STALE_MS = 45 * 60_000

/** Where the shown number comes from, how old it is, and whether it may be out of date. */
export function sourceInfo(a: AccountView, estimated: boolean, t: T, lang: Language, now: number): { text: string; stale: boolean; tip: string } | undefined {
  const at = estimated ? a.estimate?.at : a.usage?.at
  if (!at) return undefined
  const ago = formatAgo(at, lang, now)
  const src = estimated ? t('srcEstimate') : a.usage?.source === 'desktop' ? t('srcDesktop') : a.usage?.source === 'terminal' ? t('srcTerminal') : t('srcEvent')
  const stale = now - at > STALE_MS
  return { text: `${src} · ${ago}`, stale, tip: stale ? t('srcStaleTip', { src, ago }) : `${src} · ${ago}` }
}

/**
 * One window of one account: the percent with its source, a thin bar with a tick at the time already gone in the
 * window, the reset time, and where the current pace leads. `compact` keeps the percent, a source dot and the bar.
 */
export function MeterCell({ account: a, kind, tip, compact, label }: { account: AccountView; kind: 'fh' | 'sd'; tip?: string; compact?: boolean; label?: string }) {
  const { t, lang, tz, now, state } = useApp()
  const w = kind === 'fh' ? a.usage?.fiveHour : a.usage?.sevenDay
  const estimatePct = kind === 'fh' ? a.estimate?.fiveHour : a.estimate?.sevenDay
  const estimateResetsAt = kind === 'fh' ? a.estimate?.fiveHourResetsAt : undefined
  const limitResetsAt = a.limit?.kind === (kind === 'fh' ? 'session' : 'weekly') ? a.limit.resetsAt : undefined
  const etaAt = kind === 'fh' ? a.eta?.fiveHourFullAt : a.eta?.sevenDayFullAt
  const clock = (ts: number) => formatClock(ts, tz, lang, now)

  const recorded = w ? Math.min(100, Math.max(0, w.pct)) : 0
  const shown = shownPct(w, estimatePct)
  const pct = shown.pct
  const realReset = w?.resetsAt && w.resetsAt > now ? w.resetsAt : limitResetsAt && limitResetsAt > now ? limitResetsAt : undefined
  const reset = realReset ?? (estimateResetsAt && estimateResetsAt > now ? estimateResetsAt : undefined)

  // Share of the window already gone, from its reset time.
  const span = WINDOW_MS[kind]
  const start = reset ? reset - span : undefined
  const gone = start !== undefined ? Math.min(1, Math.max(0, (now - start) / span)) : undefined
  const ahead = pct !== undefined && gone !== undefined && pct < 100 && pct - gone * 100 > 10
  const level = pctLevel(w?.pct ?? pct, state.settings.warnAt)
  const cls = level === 'bad' ? ' bad' : level === 'warn' || ahead ? ' warn' : ''
  const extra = shown.estimated && pct !== undefined ? Math.max(0, pct - recorded) : 0

  // Where this pace leads; nothing is concluded in the first tenth of the window.
  let pace: { text: string; warn: boolean } | undefined
  if (pct !== undefined && pct < 100 && gone !== undefined && gone >= 0.1 && start !== undefined && reset) {
    const projected = pct / gone
    const fullAt = etaAt && etaAt < reset ? etaAt : projected >= 100 && pct > 0 ? start + ((now - start) * 100) / pct : undefined
    if (fullAt && fullAt < reset) pace = { text: t('paceFull', { clock: clock(fullAt) }), warn: true }
    else pace = { text: t('paceLeft', { n: Math.min(100, Math.max(0, Math.round(100 - projected))) }), warn: false }
  }

  const resetLabel = reset ? t('resetAt', { clock: clock(reset) }) : w && w.pct <= 0 ? t('notStartedShort') : w ? t('resetUnknownShort') : ''
  const src = sourceInfo(a, shown.estimated, t, lang, now)
  const showTip = shown.estimated && tip && !compact
  return (
    <div className={`meter-cell${showTip ? ' has-tip tip-start' : ''}`} data-tip={showTip ? tip : undefined} tabIndex={showTip ? 0 : undefined}>
      <div className="meter-top">
        {label && <span className="meter-label">{label}</span>}
        <span className={`meter-pct${pct === undefined ? ' na' : level === 'bad' ? ' bad' : level === 'warn' ? ' warn' : ''}`}>
          {pct === undefined ? '—' : `${shown.estimated ? t('approx') : ''}${Math.round(pct)}%`}
        </span>
        {src &&
          (compact ? (
            <span className={`src-dot${src.stale ? ' stale' : ''}`} title={src.tip} />
          ) : (
            <span className={`meter-src${src.stale ? ' stale' : ''}`} title={src.tip}>
              {src.stale ? t('srcStale') : src.text}
            </span>
          ))}
      </div>
      <div className="meter" aria-hidden="true">
        {w && <div className={`meter-fill${cls}`} style={{ width: `${recorded}%` }} />}
        {extra > 0 && <div className={`meter-est${cls}`} style={{ left: `${recorded}%`, width: `${extra}%` }} />}
        {gone !== undefined && gone > 0 && gone < 1 && <span className="meter-tick" style={{ left: `${gone * 100}%` }} />}
      </div>
      {!compact && resetLabel && (
        <span className="meter-reset" title={reset ? formatIn(reset, lang, now) : undefined}>
          {resetLabel}
        </span>
      )}
      {!compact && pace && <span className={`meter-pace${pace.warn ? ' warn' : ''}`}>{pace.text}</span>}
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
              <MeterCell account={a} kind="fh" tip={estimateTip(est, u, u?.fiveHour, t, clock)} />
              <MeterCell account={a} kind="sd" tip={estimateTip(est, u, u?.sevenDay, t, clock)} />
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
