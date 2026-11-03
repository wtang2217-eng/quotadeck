// The accounts as a table: one row each, usage meters inline, the desktop account marked with an accent rule.

import { formatAgo, formatClock, formatIn } from '@shared/format'
import type { AccountView, Language, UsageEstimate, UsageSnapshot, UsageWindow } from '@shared/types'
import { useApp } from '../context'
import type { T, TKey } from '../i18n'
import { displayName, pctLevel, planText, shownPct, statusKey } from '../util'
import { IconFolder, IconLogin, IconMonitor, IconMore, IconPencil, IconTerminal, IconTrash } from './icons'
import { Menu } from './Menu'

const COLS = 'minmax(176px, 1.4fr) minmax(146px, 1.25fr) minmax(146px, 1.25fr) 108px 88px 128px'

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

type Kind = 'fh' | 'sd'

/** Everything one window of one account shows: the number, the bar, the reset, the time gone and where the pace leads. */
function meterModel(a: AccountView, kind: Kind, t: T, lang: Language, tz: string, now: number, warnAt: number) {
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
  const level = pctLevel(w?.pct ?? pct, warnAt)
  const cls = level === 'bad' ? ' bad' : level === 'warn' || ahead ? ' warn' : ''
  const extra = shown.estimated && pct !== undefined ? Math.max(0, pct - recorded) : 0

  // Where this pace leads; nothing is concluded in the first tenth of the window.
  let fullAt: number | undefined
  let left: number | undefined
  if (pct !== undefined && pct < 100 && gone !== undefined && gone >= 0.1 && start !== undefined && reset) {
    const projected = pct / gone
    const at = etaAt && etaAt < reset ? etaAt : projected >= 100 && pct > 0 ? start + ((now - start) * 100) / pct : undefined
    if (at && at < reset) fullAt = at
    else left = Math.min(100, Math.max(0, Math.round(100 - projected)))
  }
  const pace = fullAt ? { text: t('paceFull', { clock: clock(fullAt) }), warn: true } : left !== undefined ? { text: t('paceLeft', { n: left }), warn: false } : undefined
  const resetLabel = reset ? t('resetAt', { clock: clock(reset) }) : w && w.pct <= 0 ? t('notStartedShort') : w ? t('resetUnknownShort') : ''
  return { w, shown, pct, recorded, extra, reset, gone, level, cls, fullAt, left, pace, resetLabel, src: sourceInfo(a, shown.estimated, t, lang, now) }
}

/**
 * One window of one account. "table": percent with a source dot, the bar with a tick at the time gone, the reset.
 * "detail" adds the source text and the pace sentence; "compact" keeps the percent, the dot and the bar.
 */
export function MeterCell({ account: a, kind, tip, mode = 'table', label }: { account: AccountView; kind: Kind; tip?: string; mode?: 'table' | 'detail' | 'compact'; label?: string }) {
  const { t, lang, tz, now, state } = useApp()
  const m = meterModel(a, kind, t, lang, tz, now, state.settings.warnAt)
  // In the table the dot carries every explanation (source, age, how the estimate is made); one tooltip at a time.
  const showTip = m.shown.estimated && tip && mode === 'detail'
  const dotTip = [m.src?.tip, m.shown.estimated && mode === 'table' ? tip : undefined].filter(Boolean).join('\n')
  return (
    <div className={`meter-cell${showTip ? ' has-tip tip-start' : ''}`} data-tip={showTip ? tip : undefined}>
      <div className="meter-top">
        {label && <span className="meter-label">{label}</span>}
        <span className={`meter-pct${m.pct === undefined ? ' na' : m.level === 'bad' ? ' bad' : m.level === 'warn' ? ' warn' : ''}`}>
          {m.pct === undefined ? '—' : `${m.shown.estimated ? t('approx') : ''}${Math.round(m.pct)}%`}
        </span>
        {m.src &&
          (mode === 'detail' ? (
            <span className={`meter-src${m.src.stale ? ' stale' : ''}`} title={m.src.tip}>
              {m.src.stale ? `${t('srcStale')} · ${m.src.text}` : m.src.text}
            </span>
          ) : (
            <span className={`src-dot has-tip${m.src.stale ? ' stale' : ''}`} data-tip={dotTip} tabIndex={0} aria-label={dotTip} />
          ))}
      </div>
      <div className="meter" aria-hidden="true">
        {m.w && <div className={`meter-fill${m.cls}`} style={{ width: `${m.recorded}%` }} />}
        {m.extra > 0 && <div className={`meter-est${m.cls}`} style={{ left: `${m.recorded}%`, width: `${m.extra}%` }} />}
        {m.gone !== undefined && m.gone > 0 && m.gone < 1 && <span className="meter-tick" style={{ left: `${m.gone * 100}%` }} />}
      </div>
      {mode !== 'compact' && m.resetLabel && (
        <span className="meter-reset" title={m.reset ? formatIn(m.reset, lang, now) : undefined}>
          {m.resetLabel}
        </span>
      )}
      {mode === 'detail' && m.pace && <span className={`meter-pace${m.pace.warn ? ' warn' : ''}`}>{m.pace.text}</span>}
    </div>
  )
}

/** The run-out column: the earliest window that fills before it resets, else how much is left at reset. */
function PaceCell({ account: a }: { account: AccountView }) {
  const { t, lang, tz, now, state } = useApp()
  const fh = meterModel(a, 'fh', t, lang, tz, now, state.settings.warnAt)
  const sd = meterModel(a, 'sd', t, lang, tz, now, state.settings.warnAt)
  const full = [fh.fullAt ? { at: fh.fullAt, key: 'fiveHour' as const } : undefined, sd.fullAt ? { at: sd.fullAt, key: 'sevenDay' as const } : undefined]
    .filter((x): x is { at: number; key: 'fiveHour' | 'sevenDay' } => !!x)
    .sort((x, y) => x.at - y.at)[0]
  if (full)
    return (
      <div className="dt-cell">
        <span className="dt-num pace-full">{formatClock(full.at, tz, lang, now)}</span>
        <div className="dt-sub">{t(full.key)}</div>
      </div>
    )
  const lefts = [fh.left, sd.left].filter((v): v is number => v !== undefined)
  if (lefts.length === 0) return <span className="dt-num dim">—</span>
  return (
    <div className="dt-cell">
      <span className="dt-num">{t('paceEnough')}</span>
      <div className="dt-sub">{t('paceLeftShort', { n: Math.min(...lefts) })}</div>
    </div>
  )
}

export function statusView(a: AccountView, t: T, clock: (ts: number) => string): { text: string; tone: '' | 'warn' | 'bad'; sub?: string } {
  if (a.status === 'limited') return { text: t('statusLimited'), tone: 'bad', sub: a.limit?.resetsAt ? t('resetAt', { clock: clock(a.limit.resetsAt) }) : undefined }
  if (a.status === 'warn') return { text: t('statusWarn'), tone: 'warn' }
  if (a.status === 'needs-login') return { text: t('statusNeedsLogin'), tone: 'warn' }
  return { text: t(statusKey(a.status) as TKey), tone: '' }
}

/** `detailed` (the accounts page) also shows where each number comes from and the full pace sentence. */
export function AccountTable({ accounts, onScope, detailed }: { accounts: AccountView[]; onScope?: (id: string) => void; detailed?: boolean }) {
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
              <MeterCell account={a} kind="fh" mode={detailed ? 'detail' : 'table'} tip={estimateTip(est, u, u?.fiveHour, t, clock)} />
              <MeterCell account={a} kind="sd" mode={detailed ? 'detail' : 'table'} tip={estimateTip(est, u, u?.sevenDay, t, clock)} />
              <PaceCell account={a} />
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
