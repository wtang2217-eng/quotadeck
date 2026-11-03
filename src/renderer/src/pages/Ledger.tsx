// Usage ledger: range and grouping filters, totals, a daily chart, breakdowns by model, project and account, active hours.

import { useEffect, useMemo, useState } from 'react'
import { formatClock } from '@shared/format'
import type { StatsAccount, StatsRange, TokenTotals, UsageStats } from '@shared/types'
import { IconCheck, IconDownload, IconInfo, IconPencil, IconX } from '../components/icons'
import { MetricStrip } from '../components/Metrics'
import { Legend, SERIES_COLORS, StackedBars, type Column, type Series } from '../components/StackedBars'
import { Segmented } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { useStats } from '../useStats'
import { errMessage, formatTokens, formatUsd, formatUsdAxis, shortLabel, sumTokens } from '../util'

type Group = 'account' | 'model' | 'project'
const RANGES: { value: StatsRange; key: 'rangeToday' | 'range7' | 'range30' | 'range90' | 'rangeAll' }[] = [
  { value: 'today', key: 'rangeToday' },
  { value: '7d', key: 'range7' },
  { value: '30d', key: 'range30' },
  { value: '90d', key: 'range90' },
  { value: 'all', key: 'rangeAll' }
]

const RANGE_KEY = 'qd.ledger.range'
function readRange(): StatsRange {
  try {
    const v = localStorage.getItem(RANGE_KEY)
    return v === 'today' || v === '7d' || v === '30d' || v === '90d' || v === 'all' ? v : '30d'
  } catch {
    return '30d'
  }
}

const cw = (t: TokenTotals) => t.cacheWrite5m + t.cacheWrite1h
const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`

function Share({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <span className="share">
      <span className="dt-num dim">{pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%</span>
      <span className="meter">
        <span className="meter-fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

/** Name of an organization row, renamed in place. */
function OrgName({ row }: { row: StatsAccount }) {
  const { t, api, setState, toast } = useApp()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(row.label)
  const save = async (label: string) => {
    if (!row.orgUuid) return
    try {
      setState(await api.setOrgLabel(row.orgUuid, label.trim()))
      play('success')
      setEditing(false)
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }
  if (editing)
    return (
      <form
        className="inline-edit"
        onSubmit={(e) => {
          e.preventDefault()
          void save(value)
        }}
      >
        <input className="input" autoFocus value={value} maxLength={60} placeholder={t('orgRenamePlaceholder')} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
        <button type="submit" className="icon-btn" aria-label={t('save')}>
          <IconCheck />
        </button>
        <button type="button" className="icon-btn" aria-label={t('cancel')} onClick={() => setEditing(false)}>
          <IconX />
        </button>
      </form>
    )
  return (
    <div className="dt-name">
      <span className="ellipsis">{row.label}</span>
      <span className="org-hint">{t('orgNotInPanel')}</span>
      <button type="button" className="icon-btn" aria-label={t('orgRename')} title={t('orgRename')} onClick={() => setEditing(true)}>
        <IconPencil size={14} />
      </button>
    </div>
  )
}

export function Ledger() {
  const { api, t, lang, tz, now, state, scope, toast } = useApp()
  const [range, setRangeRaw] = useState<StatsRange>(readRange)
  const setRange = (r: StatsRange) => {
    setRangeRaw(r)
    try {
      localStorage.setItem(RANGE_KEY, r)
    } catch {
      /* remembered for this window only */
    }
  }
  const [group, setGroup] = useState<Group>('account')
  const [account, setAccount] = useState<string>(scope === 'all' ? '*' : scope)
  useEffect(() => setAccount(scope === 'all' ? '*' : scope), [scope])
  const stats = useStats(api, { range, accountId: account === '*' ? undefined : account })
  const all = useStats(api, { range: 'all' })

  // Account filter: panel accounts, then organizations that are not in the panel, then "other".
  const options = useMemo(() => {
    const rows = all?.byAccount ?? []
    const extra = rows.filter((r) => r.kind !== 'account')
    return [
      { value: '*', label: t('lgAllAccounts') },
      ...state.accounts.map((a) => ({ value: a.id, label: a.nickname || a.email || a.id.slice(0, 8) })),
      ...extra.map((r) => ({ value: r.accountId, label: r.kind === 'org' ? `${r.label} · ${t('orgNotInPanel')}` : r.label }))
    ]
  }, [all?.byAccount.map((r) => r.accountId + r.label).join('|'), state.accounts.map((a) => a.id + a.nickname).join('|'), lang])

  const exportCsv = async () => {
    try {
      const res = await api.exportLedgerCsv({ range, accountId: account === '*' ? undefined : account })
      if (res.cancelled) return
      if (res.ok) {
        play('success')
        toast(t('exportDone', { path: res.path ?? '' }), 'ok')
      } else toast(t('errGeneric', { msg: res.error ?? '' }), 'bad')
    } catch (e) {
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{t('lgTitle')}</h1>
          <p className="page-sub">{t('lgSub', { tz: stats?.timeZone ?? tz })}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => void exportCsv()}>
            <IconDownload />
            {t('exportCsv')}
          </button>
        </div>
      </header>

      <div className="filters">
        <Segmented<StatsRange> ariaLabel={t('lgTitle')} value={range} onChange={(v) => setRange(v)} options={RANGES.map((r) => ({ value: r.value, label: t(r.key) }))} />
        <Segmented<Group>
          ariaLabel={t('groupAccount')}
          value={group}
          onChange={(v) => setGroup(v)}
          options={[
            { value: 'account', label: t('groupAccount') },
            { value: 'model', label: t('groupModel') },
            { value: 'project', label: t('groupProject') }
          ]}
        />
        <span className="grow" />
        <label className="filter-label" htmlFor="lg-account">
          {t('lgAccountFilter')}
        </label>
        <select id="lg-account" className="select" value={account} onChange={(e) => setAccount(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {stats && <LedgerBody stats={stats} group={group} />}
      {stats?.partial && (
        <div className="note">
          <IconInfo size={14} />
          {t('lgPartial')}
        </div>
      )}
      {stats && (
        <div className="note" style={{ marginTop: 28 }}>
          <span>
            {t('lgPriceList', { date: stats.pricing.asOf })} · {t('metricAsOf', { clock: formatClock(stats.computedAt, tz, lang, now) })}
          </span>
        </div>
      )}
    </div>
  )
}

function LedgerBody({ stats, group }: { stats: UsageStats; group: Group }) {
  const { t, state } = useApp()
  const total = stats.totals
  const currentId = state.accounts.find((a) => a.isDesktopCurrent)?.id

  const series: Series[] = useMemo(() => {
    if (group !== 'account') return [{ id: 'total', label: t('lgCost'), color: 'var(--chart-1)' }]
    let k = 0
    return stats.byAccount.map((r) => ({
      id: r.accountId,
      label: shortLabel(r.label),
      title: r.label,
      color: r.accountId && r.accountId === currentId ? 'var(--accent)' : SERIES_COLORS[Math.min(SERIES_COLORS.length - 1, k++)]
    }))
  }, [stats, group, currentId])

  const columns: Column[] =
    stats.range === 'today' && stats.hours
      ? stats.hours.map((h) => ({ key: String(h.hour), label: h.hour % 3 === 0 ? String(h.hour) : '', title: `${h.hour}:00`, values: { total: h.costUsd, ...(group === 'account' ? {} : {}) } }))
      : stats.days.map((d, i, arr) => {
          const step = arr.length > 45 ? 14 : arr.length > 20 ? 5 : arr.length > 10 ? 2 : 1
          return {
            key: d.day,
            label: (arr.length - 1 - i) % step === 0 ? shortDay(d.day) : '',
            title: d.day,
            values: group === 'account' ? { ...d.byAccount } : { total: d.costUsd }
          }
        })
  const chartSeries = stats.range === 'today' ? [{ id: 'total', label: t('lgCost'), color: 'var(--chart-1)' }] : series

  const models = (
    <section className="sec" key="m">
      <div className="sec-head">
        <h2 className="sec-title">{t('lgByModel')}</h2>
      </div>
      <div className="dt" style={{ ['--cols' as string]: 'minmax(120px, 1.4fr) repeat(4, minmax(70px, 1fr)) 90px 110px' }}>
        <div className="dt-row dt-head">
          <span>{t('colModel')}</span>
          <span className="r">{t('colInput')}</span>
          <span className="r">{t('colOutput')}</span>
          <span className="r">{t('colCacheWrite')}</span>
          <span className="r">{t('colCacheRead')}</span>
          <span className="r">{t('colUsd')}</span>
          <span className="r">{t('colShare')}</span>
        </div>
        <div className="dt-body">
          {stats.models.map((m) => (
            <div key={m.model} className="dt-row" style={{ minHeight: 44 }}>
              <div className="dt-name">
                <span className="ellipsis">{m.label}</span>
              </div>
              <span className="dt-num r">{formatTokens(m.tokens.input)}</span>
              <span className="dt-num r">{formatTokens(m.tokens.output)}</span>
              <span className="dt-num r">{formatTokens(cw(m.tokens))}</span>
              <span className="dt-num r">{formatTokens(m.tokens.cacheRead)}</span>
              <span className="dt-num r">{formatUsd(m.costUsd)}</span>
              <Share value={m.costUsd} total={total.costUsd} />
            </div>
          ))}
          {(total.background.costUsd > 0 || sumTokens(total.background.tokens) > 0) && (
            <div className="dt-row" style={{ minHeight: 52 }}>
              <div className="dt-cell">
                <div className="dt-name">
                  <span className="ellipsis">{t('lgBackground')}</span>
                </div>
                <div className="dt-sub" style={{ whiteSpace: 'normal' }}>
                  {t('lgBackgroundHint')}
                  {total.background.webSearches > 0 ? ` · ${t('lgWebSearches', { n: total.background.webSearches })}` : ''}
                </div>
              </div>
              <span className="dt-num r">{formatTokens(total.background.tokens.input)}</span>
              <span className="dt-num r">{formatTokens(total.background.tokens.output)}</span>
              <span className="dt-num r">{formatTokens(cw(total.background.tokens))}</span>
              <span className="dt-num r">{formatTokens(total.background.tokens.cacheRead)}</span>
              <span className="dt-num r">{formatUsd(total.background.costUsd)}</span>
              <Share value={total.background.costUsd} total={total.costUsd} />
            </div>
          )}
        </div>
      </div>
    </section>
  )

  const projects = (
    <section className="sec" key="p">
      <div className="sec-head">
        <h2 className="sec-title">{t('lgByProject')}</h2>
      </div>
      <div className="dt" style={{ ['--cols' as string]: 'minmax(120px, 1.6fr) 70px 80px 90px 90px 110px' }}>
        <div className="dt-row dt-head">
          <span>{t('colProject')}</span>
          <span className="r">{t('colConvs')}</span>
          <span className="r">{t('colRequests')}</span>
          <span className="r">{t('lgTokens')}</span>
          <span className="r">{t('colUsd')}</span>
          <span className="r">{t('colShare')}</span>
        </div>
        <div className="dt-body">
          {stats.projects.map((p) => (
            <div key={p.projectDir} className="dt-row" style={{ minHeight: 44 }}>
              <div className="dt-cell">
                <div className="dt-name">
                  <span className="ellipsis">{p.name}</span>
                </div>
              </div>
              <span className="dt-num r">{p.conversations}</span>
              <span className="dt-num r">{p.requests.toLocaleString()}</span>
              <span className="dt-num r">{formatTokens(sumTokens(p.tokens))}</span>
              <span className="dt-num r">{formatUsd(p.costUsd)}</span>
              <Share value={p.costUsd} total={total.costUsd} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )

  const accounts = (
    <section className="sec" key="a">
      <div className="sec-head">
        <h2 className="sec-title">{t('lgByAccount')}</h2>
      </div>
      <div className="dt" style={{ ['--cols' as string]: 'minmax(160px, 1.8fr) repeat(4, minmax(70px, 1fr)) 90px 110px' }}>
        <div className="dt-row dt-head">
          <span>{t('colAccount')}</span>
          <span className="r">{t('colInput')}</span>
          <span className="r">{t('colOutput')}</span>
          <span className="r">{t('colCacheWrite')}</span>
          <span className="r">{t('colCacheRead')}</span>
          <span className="r">{t('colUsd')}</span>
          <span className="r">{t('colShare')}</span>
        </div>
        <div className="dt-body">
          {stats.byAccount.map((r) => (
            <div key={r.accountId || 'other'} className={`dt-row${r.accountId && r.accountId === currentId ? ' is-current' : ''}`} style={{ minHeight: 48 }}>
              <div className="dt-cell">
                {r.kind === 'org' ? (
                  <OrgName row={r} />
                ) : (
                  <div className="dt-name">
                    <span className="ellipsis">{r.label}</span>
                  </div>
                )}
                {r.email && r.kind === 'account' && r.email !== r.label && <div className="dt-sub">{r.email}</div>}
              </div>
              <span className="dt-num r">{formatTokens(r.tokens.input)}</span>
              <span className="dt-num r">{formatTokens(r.tokens.output)}</span>
              <span className="dt-num r">{formatTokens(cw(r.tokens))}</span>
              <span className="dt-num r">{formatTokens(r.tokens.cacheRead)}</span>
              <span className="dt-num r">{formatUsd(r.costUsd)}</span>
              <Share value={r.costUsd} total={total.costUsd} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )

  const order = group === 'model' ? [models, projects, accounts] : group === 'project' ? [projects, models, accounts] : [accounts, models, projects]
  const days = t('weekdays').split(',')
  const heatMax = Math.max(0, ...stats.heatmap.flat())
  const level = (v: number) => (v <= 0 || heatMax <= 0 ? 0 : Math.min(4, 1 + Math.floor((v / heatMax) * 3.999)))

  return (
    <>
      <MetricStrip
        items={[
          { label: t('lgCost'), value: formatUsd(total.costUsd) },
          { label: t('lgTokens'), value: formatTokens(sumTokens(total.tokens)) },
          { label: t('lgRequests'), value: total.requests.toLocaleString('en-US') },
          { label: t('lgConversations'), value: total.conversations.toLocaleString('en-US') },
          { label: t('lgActiveDays'), value: String(total.activeDays) }
        ]}
      />
      <div className="note">
        <IconInfo size={14} />
        {stats.pricing.note}
      </div>

      <section className="sec">
        <div className="sec-head">
          <h2 className="sec-title">{stats.range === 'today' ? t('lgHourly') : t('lgDaily')}</h2>
          <div className="sec-tools">
            <Legend series={chartSeries} />
          </div>
        </div>
        <StackedBars series={chartSeries} columns={columns} format={formatUsd} axis={formatUsdAxis} empty={t('lgEmpty')} />
      </section>

      {order}

      <section className="sec">
        <div className="sec-head">
          <h2 className="sec-title">{t('lgHeat')}</h2>
          <span className="sec-sub">{t('lgHeatSub')}</span>
        </div>
        <div className="heat" role="img" aria-label={t('lgHeat')}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="heat-h">
              {h % 3 === 0 ? h : ''}
            </span>
          ))}
          {stats.heatmap.map((row, d) => [
            <span key={`d${d}`} className="heat-d">
              {days[d]}
            </span>,
            ...row.map((v, h) => <span key={`${d}-${h}`} className={`heat-c l${level(v)}`} title={`${days[d]} ${h}:00 · ${formatUsd(v)}`} />)
          ])}
        </div>
        <div className="heat-legend">
          <span>{t('heatLess')}</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`heat-c l${l}`} />
          ))}
          <span>{t('heatMore')}</span>
        </div>
      </section>
    </>
  )
}
