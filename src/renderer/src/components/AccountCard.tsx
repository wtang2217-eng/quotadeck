import { formatAgo, formatClock, formatIn } from '@shared/format'
import type { AccountView, UsageEstimate, UsageSnapshot, UsageWindow } from '@shared/types'
import { useApp } from '../context'
import type { T, TKey } from '../i18n'
import { pctLevel, resetText, shownPct, usageSourceKey } from '../util'
import {
  IconClock,
  IconFolder,
  IconLogin,
  IconMonitor,
  IconMore,
  IconPencil,
  IconStar,
  IconTerminal,
  IconTrash
} from './icons'
import { Menu } from './Menu'
import { Sparkline } from './Sparkline'
import { AnimatedNumber, Avatar, PlanBadge, StatusChip } from './ui'

/** The desktop app writes a usage sample roughly this often. */
const DESKTOP_RECORD_INTERVAL = 15 * 60_000

function QuotaRow({
  label,
  w,
  estimatePct,
  estimateResetsAt,
  tip,
  limitResetsAt,
  warnAt
}: {
  label: TKey
  w: UsageWindow | undefined
  /** Live estimate for this window, if any. Drawn only when above the record. */
  estimatePct?: number
  /** Estimated reset, used only when the record has no reset time. */
  estimateResetsAt?: number
  tip?: string
  limitResetsAt?: number
  warnAt: number
}) {
  const { t, lang, tz, now } = useApp()
  const recorded = w ? Math.min(100, Math.max(0, w.pct)) : 0
  const shown = shownPct(w, estimatePct)
  const level = pctLevel(w?.pct ?? shown.pct, warnAt)
  const extra = shown.estimated && shown.pct !== undefined ? Math.max(0, shown.pct - recorded) : 0

  const hasRealReset = (w?.resetsAt && w.resetsAt > now) || (limitResetsAt && limitResetsAt > now)
  const estReset = !hasRealReset && estimateResetsAt && estimateResetsAt > now ? estimateResetsAt : undefined
  const reset = estReset
    ? t('resetsInAtApprox', { in: formatIn(estReset, lang, now), clock: formatClock(estReset, tz, lang, now) })
    : resetText(w, limitResetsAt, t, lang, tz, now)
  const levelClass = level === 'warn' ? ' warn' : level === 'bad' ? ' bad' : ''
  const estimatedAny = shown.estimated || !!estReset

  return (
    <div className={`quota-row${estimatedAny && tip ? ' has-tip' : ''}`} data-tip={estimatedAny ? tip : undefined} tabIndex={estimatedAny && tip ? 0 : undefined}>
      <div className="quota-top">
        <span className="quota-label">{t(label)}</span>
        {shown.estimated && <span className="est-chip">{t('estChip')}</span>}
      </div>
      <div className={`quota-pct num${shown.pct === undefined ? ' na' : levelClass}`}>
        {shown.pct === undefined ? (
          '—'
        ) : (
          <>
            {shown.estimated && <span className="approx">{t('approx').trim()}</span>}
            <AnimatedNumber value={shown.pct} />
            <span className="pct-sign">%</span>
          </>
        )}
      </div>
      <div className="meter" aria-hidden="true">
        {w && (
          <div
            className={`meter-fill${levelClass}`}
            style={{ width: `${recorded}%`, ['--meter-span' as string]: recorded > 0 ? `${(100 / recorded) * 100}%` : '100%' }}
          />
        )}
        {extra > 0 && <div className={`meter-est${levelClass}`} style={{ left: `${recorded}%`, width: `${extra}%` }} />}
      </div>
      <div className={`quota-reset${level === 'bad' && !estReset ? ' bad' : ''}`}>{reset || ' '}</div>
    </div>
  )
}

function estimateTip(
  est: UsageEstimate | undefined,
  usage: UsageSnapshot | undefined,
  recorded: UsageWindow | undefined,
  t: T,
  clock: (ts: number) => string
): string | undefined {
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

export function AccountCard({ account }: { account: AccountView }) {
  const { t, lang, tz, now, state, openDialog, api, toast } = useApp()
  const recommended = state.recommendedAccountId === account.id && !account.isDesktopCurrent
  const u = account.usage
  const est = account.estimate
  const limited = account.status === 'limited'
  const warnAt = state.settings.warnAt
  const needsLogin = account.status === 'needs-login'
  const canTerminal = !!account.cliConfigDir
  const clock = (ts: number) => formatClock(ts, tz, lang, now)
  const tip5h = estimateTip(est, u, u?.fiveHour, t, clock)
  const tipWeek = estimateTip(est, u, u?.sevenDay, t, clock)
  const nextRecord =
    u && u.source === 'desktop' && account.isDesktopCurrent && u.at + DESKTOP_RECORD_INTERVAL > now ? u.at + DESKTOP_RECORD_INTERVAL : undefined

  const menuItems = [
    {
      label: t('menuEdit'),
      icon: <IconPencil size={16} />,
      onSelect: () => openDialog({ type: 'edit', accountId: account.id })
    },
    {
      label: t('menuReLogin'),
      icon: <IconLogin size={16} />,
      onSelect: () => openDialog({ type: 'add', reLoginAccountId: account.id })
    },
    ...(account.cliConfigDir
      ? [
          {
            label: t('menuOpenProfile'),
            icon: <IconFolder size={16} />,
            onSelect: () => void api.openPath(account.cliConfigDir!).catch((e) => toast(String(e), 'bad'))
          }
        ]
      : []),
    'sep' as const,
    {
      label: t('menuRemove'),
      icon: <IconTrash size={16} />,
      danger: true,
      onSelect: () => openDialog({ type: 'remove', accountId: account.id })
    }
  ]

  return (
    <article
      className={`card acct${recommended ? ' is-recommended' : ''}${limited ? ' is-limited' : ''}${account.isDesktopCurrent ? ' is-current' : ''}`}
      aria-label={account.nickname || account.email}
    >
      <div className="acct-head">
        <Avatar account={account} size={40} />
        <div className="acct-id">
          <div className="acct-name-row">
            <span className="acct-name ellipsis">{account.nickname || account.email || account.id.slice(0, 8)}</span>
            <PlanBadge plan={account.plan} t={t} />
            {account.isDesktopCurrent && (
              <span className="badge badge-desktop">
                <IconMonitor size={12} stroke={2} />
                {t('badgeDesktopCurrent')}
              </span>
            )}
            {recommended && (
              <span className="badge badge-star">
                <IconStar size={12} stroke={2.2} />
                {t('badgeRecommended')}
              </span>
            )}
          </div>
          <div className="acct-email">
            <span className="ellipsis">{account.nickname ? account.email : account.displayName || ''}</span>
          </div>
        </div>
        <div className="acct-head-right">
          <StatusChip status={account.status} t={t} />
          <Menu
            label={t('more')}
            items={menuItems}
            trigger={({ toggle }) => (
              <button type="button" className="icon-btn" aria-label={t('more')} onClick={toggle}>
                <IconMore size={18} />
              </button>
            )}
          />
        </div>
      </div>

      {u || est ? (
        <div className="quota">
          <QuotaRow
            label="fiveHour"
            w={u?.fiveHour}
            estimatePct={est?.fiveHour}
            estimateResetsAt={est?.fiveHourResetsAt}
            tip={tip5h}
            limitResetsAt={account.limit?.kind === 'session' ? account.limit.resetsAt : undefined}
            warnAt={warnAt}
          />
          <QuotaRow
            label="sevenDay"
            w={u?.sevenDay}
            estimatePct={est?.sevenDay}
            tip={tipWeek}
            limitResetsAt={account.limit?.kind === 'weekly' ? account.limit.resetsAt : undefined}
            warnAt={warnAt}
          />
          <div className="quota-foot">
            <IconClock size={13} />
            <span className="ellipsis">
              {u ? (
                <>
                  {t(usageSourceKey(u))} · {formatAgo(u.at, lang, now)}
                  {nextRecord && ` · ${t('nextRecord', { clock: clock(nextRecord) })}`}
                </>
              ) : (
                t('estOnlySource')
              )}
            </span>
            {account.desktopSessionCount > 0 && (
              <span style={{ marginLeft: 'auto', flex: 'none' }}>{t('cardSessions', { n: account.desktopSessionCount })}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="no-usage">
          <strong>{t('noUsageTitle')}</strong>
          {t('noUsageHint')}
        </div>
      )}

      {u && (
        <div className="trend">
          <div className="trend-head">
            <span>{t('last7Days')}</span>
            <span className="grow" />
            <span className="legend">
              <i />
              {t('legend5h')}
            </span>
            <span className="legend">
              <i className="dashed" />
              {t('legendWeek')}
            </span>
          </div>
          <Sparkline
            points={account.history}
            now={now}
            lang={lang}
            tz={tz}
            labels={{ fh: t('legend5h'), sd: t('legendWeek'), empty: t('sparkEmpty') }}
          />
        </div>
      )}

      <div className="acct-foot">
        {needsLogin ? (
          <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'add', reLoginAccountId: account.id })}>
            <IconLogin size={16} />
            <span>{t('actReLogin')}</span>
          </button>
        ) : (
          <button
            type="button"
            className={`btn${recommended ? ' btn-primary' : ''}`}
            disabled={!canTerminal}
            title={canTerminal ? undefined : t('actNoCli')}
            data-sound="none"
            onClick={() => openDialog({ type: 'switch', mode: 'terminal', toAccountId: account.id })}
          >
            <IconTerminal size={16} />
            <span>{t('actContinueTerminal')}</span>
          </button>
        )}
        {account.isDesktopCurrent ? (
          <span className="in-use">
            <IconMonitor size={15} />
            {t('actDesktopInUse')}
          </span>
        ) : (
          <button
            type="button"
            className="btn"
            data-sound="none"
            onClick={() => openDialog({ type: 'switch', mode: 'desktop', toAccountId: account.id })}
          >
            <IconMonitor size={16} />
            <span>{t('actSwitchDesktop')}</span>
          </button>
        )}
      </div>
    </article>
  )
}
