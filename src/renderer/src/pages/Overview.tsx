// Overview: what to do now, the attention bar, today's numbers, the accounts table, 14 days of use, recent conversations.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatAgo, formatClock } from '@shared/format'
import type { AccountView, AppState, ConversationItem, UsageStats } from '@shared/types'
import { AccountTable } from '../components/AccountTable'
import { IconAlert, IconArrowRight, IconChat, IconInfo, IconMonitor, IconPlus, IconRefresh, IconZap } from '../components/icons'
import { MetricStrip } from '../components/Metrics'
import { Legend, SERIES_COLORS, StackedBars, type Column, type Series } from '../components/StackedBars'
import { Segmented, Spinner } from '../components/ui'
import { useApp, type AppCtx } from '../context'
import { play } from '../sound'
import { useStats, useStatsFor } from '../useStats'
import { cjkSpace, displayName, errMessage, shortLabel, shortName, formatTokens, formatUsd, formatUsdAxis, limitKindKey, shownPct, shownRemaining, sumTokens } from '../util'

/** Accounts the current scope covers, the desktop account first. */
export function scopedAccounts(state: AppState, scope: string): AccountView[] {
  const list = scope === 'all' ? state.accounts : state.accounts.filter((a) => a.id === scope)
  return [...list].sort((a, b) => Number(b.isDesktopCurrent) - Number(a.isDesktopCurrent) || a.addedAt - b.addedAt)
}

/** The one sentence under the title: what is going on and what to do about it. */
function useAdvice(): { text: ReactNode; action?: { label: string; run: () => void } } {
  const { state, t, lang, tz, now, scope, openDialog } = useApp()
  const clock = (ts: number) => formatClock(ts, tz, lang, now)
  const accounts = scopedAccounts(state, scope)
  const current = scope === 'all' ? state.accounts.find((a) => a.isDesktopCurrent) : accounts[0]
  const rec = state.accounts.find((a) => a.id === state.recommendedAccountId && a.id !== current?.id && a.status !== 'limited')
  if (!current) return { text: state.accounts.length ? t('ovSubIdle') : t('ovSubNoData') }
  const name = displayName(current)

  if (current.status === 'limited') {
    if (!rec) {
      const soon = state.accounts.map((a) => a.limit?.resetsAt).filter((v): v is number => !!v && v > now).sort((a, b) => a - b)[0]
      return { text: soon ? t('adviceAllLimited', { clock: clock(soon) }) : t('adviceAllLimitedNoTime') }
    }
    const resetsAt = current.limit?.resetsAt
    const resetPart = resetsAt && resetsAt > now ? t('adviceResetPart', { clock: clock(resetsAt) }) : t('statusLimited')
    const eta = rec.eta?.fiveHourFullAt
    const left = shownRemaining(rec.usage?.fiveHour, rec.estimate?.fiveHour).left
    const etaPart = eta ? t('adviceEtaPart', { eta: clock(eta) }) : left !== undefined ? t('adviceLeftPart', { left }) : ''
    return {
      text: t('adviceSwitch', { from: lang === 'en' ? name : `${name} `, resetPart, to: displayName(rec), etaPart }),
      action: { label: t('adviceAct', { name: displayName(rec) }), run: () => openDialog({ type: 'switch', mode: 'desktop', fromAccountId: current.id, toAccountId: rec.id }) }
    }
  }

  const fh = shownPct(current.usage?.fiveHour, current.estimate?.fiveHour).pct
  const sd = shownPct(current.usage?.sevenDay, current.estimate?.sevenDay).pct
  if (current.status === 'warn') {
    const weekly = (sd ?? 0) > (fh ?? 0)
    const pct = Math.round((weekly ? sd : fh) ?? 0)
    const eta = weekly ? current.eta?.sevenDayFullAt : current.eta?.fiveHourFullAt
    const etaPart = eta ? t('adviceEtaPart', { eta: clock(eta) }) : t('adviceOkNoPace')
    const kind = t(weekly ? 'limitKindWeekly' : 'limitKindSession')
    if (rec)
      return {
        text: t('adviceWarn', { name, kind, pct, etaPart, to: displayName(rec) }),
        action: { label: t('adviceAct', { name: displayName(rec) }), run: () => openDialog({ type: 'switch', mode: 'desktop', fromAccountId: current.id, toAccountId: rec.id }) }
      }
    return { text: t('adviceWarnNoAlt', { name, kind, pct, etaPart }) }
  }

  if (fh === undefined) return { text: t('ovSubNoData') }
  const eta = current.eta?.fiveHourFullAt
  const resetsAt = current.usage?.fiveHour?.resetsAt ?? current.estimate?.fiveHourResetsAt
  const tail = eta ? t('adviceOkEta', { eta: clock(eta) }) : resetsAt && resetsAt > now ? `${t('adviceOkReset', { clock: clock(resetsAt) })}，${t('adviceOkNoPace')}` : t('adviceOkNoPace')
  return { text: t('adviceOk', { name, pct: Math.round(fh), tail: lang === 'en' ? tail.replace('，', ', ') : tail }) }
}

/** Shown only when the user may want to act: a limit, a running-low account, a desktop switch in progress. */
function NoticeBar() {
  const { state, t, lang, tz, now, scope, openDialog, api, setState } = useApp()
  const clock = (ts: number) => formatClock(ts, tz, lang, now)
  const pending = state.pendingSwitch
  if (pending && (pending.phase === 'waiting' || pending.phase === 'wrong-account')) {
    const to = state.accounts.find((a) => a.id === pending.toAccountId)
    const wrong = pending.phase === 'wrong-account'
    return (
      <div className={`notice ${wrong ? 'warn' : 'accent'}`} role="status">
        {wrong ? <IconAlert /> : <Spinner />}
        <span className="notice-text">
          <b>{t(wrong ? 'noticeWrong' : 'noticePending', { name: displayName(to) })}</b>
          {!wrong && <span className="muted">{t('noticePendingSub')}</span>}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => void api.openDesktopApp()}>
          <IconMonitor />
          {t('swOpenDesktop')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void api.cancelPendingSwitch().then(setState)}>
          {t('noticeCancel')}
        </button>
      </div>
    )
  }
  const accounts = scopedAccounts(state, scope)
  const current = accounts.find((a) => a.isDesktopCurrent) ?? (scope === 'all' ? undefined : accounts[0])
  if (!current) return null
  const rec = state.accounts.find((a) => a.id === state.recommendedAccountId && a.id !== current.id && a.status !== 'limited')
  if (current.status === 'limited') {
    const resetsAt = current.limit?.resetsAt
    return (
      <div className="notice bad" role="status">
        <IconZap />
        <span className="notice-text">
          <b>{cjkSpace(t('noticeLimited', { name: displayName(current), kind: t(limitKindKey(current.limit?.kind)) }))}</b>
          {resetsAt && resetsAt > now && <span className="muted">{t('resetAt', { clock: clock(resetsAt) })}</span>}
        </span>
        {rec && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            data-sound="none"
            onClick={() => openDialog({ type: 'switch', mode: 'desktop', fromAccountId: current.id, toAccountId: rec.id })}
          >
            {t('noticeSwitch')}
            <IconArrowRight />
          </button>
        )}
      </div>
    )
  }
  if (current.status === 'warn') {
    const fh = shownPct(current.usage?.fiveHour, current.estimate?.fiveHour).pct ?? 0
    const sd = shownPct(current.usage?.sevenDay, current.estimate?.sevenDay).pct ?? 0
    const weekly = sd > fh
    return (
      <div className="notice warn" role="status">
        <IconAlert />
        <span className="notice-text">
          <b>{cjkSpace(t('noticeWarn', { name: displayName(current), kind: t(weekly ? 'limitKindWeekly' : 'limitKindSession'), pct: Math.round(weekly ? sd : fh) }))}</b>
        </span>
        {rec && (
          <button type="button" className="btn btn-sm" data-sound="none" onClick={() => openDialog({ type: 'switch', mode: 'desktop', fromAccountId: current.id, toAccountId: rec.id })}>
            {t('noticeSwitch')}
          </button>
        )}
      </div>
    )
  }
  return null
}

/** Today's dollars and tokens, this month and everything recorded, for the scope. */
function OverviewMetrics({ stats }: { stats?: UsageStats }) {
  const { t, lang, tz, now } = useApp()
  const today = stats?.days[stats.days.length - 1]
  const todayTokens = sumTokens(today?.tokens)
  return (
    <>
      <MetricStrip
        items={[
          { label: t('metricTodayUsd'), value: formatUsd(stats?.fixed.todayUsd ?? 0), sub: t('metricAsOf', { clock: formatClock(stats?.computedAt ?? now, tz, lang, now) }) },
          { label: t('metricTodayTokens'), value: formatTokens(todayTokens), sub: t('metricRequests', { n: (today?.requests ?? 0).toLocaleString() }) },
          { label: t('metricMonthUsd'), value: formatUsd(stats?.fixed.monthUsd ?? 0), sub: t('metricMonth', { m: monthName(now, tz, lang) }) },
          { label: t('metricAllUsd'), value: formatUsd(stats?.fixed.allTimeUsd ?? 0), sub: stats?.firstDay ? t('metricSince', { day: stats.firstDay }) : undefined }
        ]}
      />
      {stats && (
        <div className="note">
          <IconInfo size={14} />
          {t('priceNote', { date: stats.pricing.asOf })}
        </div>
      )}
    </>
  )
}

function monthName(now: number, tz: string, lang: string): string {
  const zone = tz && tz !== 'system' ? tz : undefined
  try {
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-CN', { month: lang === 'en' ? 'long' : 'numeric', timeZone: zone }).format(now).replace('月', '')
  } catch {
    return String(new Date(now).getMonth() + 1)
  }
}

const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`

/** Last 14 days stacked by account, in dollars or tokens. */
function UsageChart({ stats }: { stats?: UsageStats }) {
  const { t, state, api, scope } = useApp()
  const [unit, setUnit] = useState<'usd' | 'tokens'>('usd')
  const rows = stats?.byAccount ?? []
  const ids = rows.map((r) => r.accountId)
  const perSeries = useStatsFor(api, '30d', unit === 'tokens' && scope === 'all' ? ids : [])
  const currentId = state.accounts.find((a) => a.isDesktopCurrent)?.id
  const series: Series[] = useMemo(() => {
    let k = 0
    return rows.map((r) => ({
      id: r.accountId,
      label: shortLabel(r.label),
      title: r.label,
      color: r.accountId && r.accountId === currentId ? 'var(--accent)' : SERIES_COLORS[Math.min(SERIES_COLORS.length - 1, k++)]
    }))
  }, [rows.map((r) => r.accountId + r.label).join('|'), currentId])

  const days = (stats?.days ?? []).slice(-14)
  const columns: Column[] = days.map((d, i) => {
    const values: Record<string, number> = {}
    if (unit === 'usd') for (const s of series) values[s.id] = d.byAccount[s.id] ?? 0
    else if (scope !== 'all') values[series[0]?.id ?? ''] = sumTokens(d.tokens)
    else
      for (const s of series) {
        const day = perSeries[s.id]?.days.find((x) => x.day === d.day)
        values[s.id] = sumTokens(day?.tokens)
      }
    return { key: d.day, label: i === days.length - 1 ? t('rangeToday') : i % 2 === (days.length - 1) % 2 ? shortDay(d.day) : '', title: d.day, values }
  })

  return (
    <section className="sec">
      <div className="sec-head">
        <h2 className="sec-title">{t('secUsage14')}</h2>
        <div className="sec-tools">
          <Legend series={series} />
          <Segmented<'usd' | 'tokens'>
            ariaLabel={t('secUsage14')}
            small
            value={unit}
            onChange={(v) => setUnit(v)}
            options={[
              { value: 'usd', label: t('unitUsd') },
              { value: 'tokens', label: t('unitTokens') }
            ]}
          />
        </div>
      </div>
      <StackedBars series={series} columns={columns} format={unit === 'usd' ? formatUsd : formatTokens} axis={unit === 'usd' ? formatUsdAxis : formatTokens} empty={t('lgEmpty')} />
    </section>
  )
}

function RecentConversations() {
  const { api, t, lang, now, state, scope, navigate, openDialog, toast } = useApp()
  const [items, setItems] = useState<ConversationItem[] | null>(null)
  useEffect(() => {
    let alive = true
    api
      .listConversations({ limit: 5, ...(scope !== 'all' ? { accountId: scope } : {}) })
      .then((list) => alive && setItems(list))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [api, scope])
  const current = state.accounts.find((a) => a.isDesktopCurrent)
  const resume = async (c: ConversationItem) => {
    if (c.desktopSessionId && current && current.status !== 'limited') {
      const res = await api.openInDesktop({ desktopSessionId: c.desktopSessionId, cliSessionId: c.cliSessionId }).catch((e) => ({ ok: false, error: errMessage(e) }))
      if (!res.ok) toast(t('errGeneric', { msg: res.error ?? '' }), 'bad')
      else play('switch')
      return
    }
    openDialog({ type: 'switch', mode: 'both', cliSessionId: c.cliSessionId, cwd: c.cwd, title: c.title })
  }
  const nameOf = (id?: string) => shortName(state.accounts.find((a) => a.id === id))
  return (
    <section className="sec">
      <div className="sec-head">
        <h2 className="sec-title">{t('secRecent')}</h2>
        <div className="sec-tools">
          <button type="button" className="linkish" onClick={() => navigate('conversations')}>
            {t('viewAll')}
            <IconArrowRight size={14} />
          </button>
        </div>
      </div>
      <div className="list-rows">
        {(items ?? []).map((c) => (
          <div key={c.cliSessionId} className="list-row">
            <IconChat />
            <div style={{ minWidth: 0 }}>
              <div className="list-title">{c.title}</div>
              <div className="list-meta">
                {c.cwd && <span className="ellipsis">{c.cwd.split(/[\\/]/).filter(Boolean).pop()}</span>}
                {c.accountIds[0] && (
                  <>
                    <span className="sep" />
                    <span>{nameOf(c.accountIds[0])}</span>
                  </>
                )}
                <span className="sep" />
                <span>{formatAgo(c.lastActivityAt, lang, now)}</span>
              </div>
            </div>
            <button type="button" className="btn btn-sm" data-sound="none" onClick={() => void resume(c)}>
              {t('actResume')}
            </button>
          </div>
        ))}
        {items && items.length === 0 && <div className="dt-foot">{t('convEmptyAll')}</div>}
      </div>
    </section>
  )
}

export function Overview() {
  const ctx = useApp()
  const { state, t, api, setState, toast, openDialog, scope, setScope } = ctx
  const [spinning, setSpinning] = useState(false)
  const accounts = scopedAccounts(state, scope)
  const stats = useStats(api, { range: '30d', accountId: scope === 'all' ? undefined : scope })
  const advice = useAdvice()

  const refresh = async () => {
    setSpinning(true)
    try {
      setState(await api.refresh())
      toast(t('refreshed'), 'ok')
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    } finally {
      window.setTimeout(() => setSpinning(false), 500)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{t('navDashboard')}</h1>
          <p className="advice">
            <span>{typeof advice.text === 'string' ? cjkSpace(advice.text) : advice.text}</span>
            {advice.action && (
              <button type="button" className="linkish" data-sound="none" onClick={advice.action.run}>
                {cjkSpace(advice.action.label)}
                <IconArrowRight size={14} />
              </button>
            )}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className={`icon-btn bordered${spinning ? ' spin-once' : ''}`} aria-label={t('refresh')} title={t('refresh')} onClick={refresh}>
            <IconRefresh />
          </button>
          <button type="button" className="btn" data-sound="none" onClick={() => openDialog({ type: 'add' })}>
            <IconPlus />
            {t('addAccount')}
          </button>
        </div>
      </header>

      <NoticeBar />
      <OverviewMetrics stats={stats} />

      <section className="sec">
        <div className="sec-head">
          <h2 className="sec-title">{t('secAccountsTitle')}</h2>
          <span className="sec-sub">{accounts.length}</span>
        </div>
        <AccountTable accounts={accounts} onScope={scope === 'all' ? setScope : undefined} />
      </section>

      <UsageChart stats={stats} />
      <RecentConversations />
    </div>
  )
}

export type { AppCtx }
