import { useState } from 'react'
import { formatClock, maskEmail } from '@shared/format'
import type { AccountView } from '@shared/types'
import { AccountCard } from '../components/AccountCard'
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconTerminal,
  IconUser,
  IconZap,
  Logo
} from '../components/icons'
import { PageHead, PlanBadge, SectionHead, Spinner } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { displayName, errMessage, limitKindKey, shownRemaining } from '../util'

const pad = (n: number) => String(n).padStart(2, '0')

function LimitBanner() {
  const { state, t, lang, tz, now, openDialog } = useApp()
  const accounts = state.accounts
  const current = accounts.find((a) => a.isDesktopCurrent)
  const interrupted = accounts.find((a) => a.id === state.lastInterrupted?.accountId)
  const blocked = (current?.status === 'limited' ? current : undefined) ?? (interrupted?.status === 'limited' ? interrupted : undefined)
  const target = accounts.find((a) => a.id === state.recommendedAccountId && a.id !== blocked?.id && a.status !== 'limited')

  if (blocked) {
    const resetsAt = blocked.limit?.resetsAt
    if (!target) {
      const soonest = accounts
        .map((a) => a.limit?.resetsAt)
        .filter((v): v is number => !!v && v > now)
        .sort((a, b) => a - b)[0]
      return (
        <div className="banner banner-bad" role="status">
          <div className="banner-icon">
            <IconZap size={18} />
          </div>
          <div className="banner-text">
            <span className="banner-kicker">{t('bannerKickerLimited')}</span>
            <div className="banner-title">{t('bannerLimited', { name: displayName(blocked), kind: t(limitKindKey(blocked.limit?.kind)) })}</div>
            <div className="banner-sub">
              {soonest ? t('bannerAllLimited', { clock: formatClock(soonest, tz, lang, now) }) : t('bannerAllLimitedNoTime')}
            </div>
          </div>
        </div>
      )
    }
    const fh = shownRemaining(target.usage?.fiveHour, target.estimate?.fiveHour)
    return (
      <div className="banner banner-bad" role="status">
        <div className="banner-icon">
          <IconZap size={18} />
        </div>
        <div className="banner-text">
          <span className="banner-kicker">{t('bannerKickerLimited')}</span>
          <div className="banner-title">
            {t('bannerLimited', { name: displayName(blocked), kind: t(limitKindKey(blocked.limit?.kind)) })}
            {resetsAt && resetsAt > now && <span className="pill-time">{t('bannerResetAt', { clock: formatClock(resetsAt, tz, lang, now) })}</span>}
          </div>
          <div className="banner-sub">
            {fh.left === undefined
              ? t('bannerRecommendNoData', { name: displayName(target) })
              : t(fh.estimated ? 'bannerRecommendEst' : 'bannerRecommend', { name: displayName(target), fh: fh.left })}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          data-sound="none"
          onClick={() => openDialog({ type: 'switch', mode: 'both', fromAccountId: blocked.id, toAccountId: target.id })}
        >
          {t('bannerSwitch')}
          <IconArrowRight size={16} />
        </button>
      </div>
    )
  }

  if (current?.status === 'warn') {
    const kindWindow =
      (current.usage?.fiveHour?.pct ?? 0) >= (current.usage?.sevenDay?.pct ?? 0) ? ('session' as const) : ('weekly' as const)
    const pct = Math.round(Math.max(current.usage?.fiveHour?.pct ?? 0, current.usage?.sevenDay?.pct ?? 0))
    const alt = accounts.find((a) => a.id === state.recommendedAccountId && a.id !== current.id)
    return (
      <div className="banner banner-warn" role="status">
        <div className="banner-icon">
          <IconAlert size={18} />
        </div>
        <div className="banner-text">
          <span className="banner-kicker">{t('bannerKickerWarn')}</span>
          <div className="banner-title">{t('bannerWarn', { name: displayName(current), kind: t(limitKindKey(kindWindow)), pct })}</div>
          {alt && <div className="banner-sub">{t('bannerWarnSub', { name: displayName(alt) })}</div>}
        </div>
        {alt && (
          <button
            type="button"
            className="btn"
            data-sound="none"
            onClick={() => openDialog({ type: 'switch', mode: 'both', fromAccountId: current.id, toAccountId: alt.id })}
          >
            {t('bannerSwitchEarly')}
            <IconArrowRight size={16} />
          </button>
        )}
      </div>
    )
  }
  return null
}

function ConnectCard({ index }: { index: number }) {
  const { state, t, api, setState, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const integ = state.integration
  if (integ.hooksInstalled && integ.statusLineInstalled) return null
  if (integ.hooksInstalled && integ.statusLineConflict) return null
  const install = async (statusLine: boolean, replaceStatusLine: boolean) => {
    setBusy(true)
    try {
      const status = await api.installIntegration({ hooks: true, statusLine, replaceStatusLine })
      setState({ ...state, integration: status })
      play('success')
      toast(t('integrationDone'), 'ok')
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    } finally {
      setBusy(false)
    }
  }
  const conflict = integ.statusLineConflict
  return (
    <section className="sec">
      <SectionHead index={index} title={t('secConnect')} />
      <div className={`card connect${conflict ? ' top' : ''}`}>
        <div className="connect-icon">
          <IconPlug size={18} />
        </div>
        <div className="connect-text">
          <div className="connect-title">{t('integrationTitle')}</div>
          <div className="connect-body">{t('integrationBody')}</div>
          {conflict && (
            <div className="connect-body" style={{ marginTop: 8 }}>
              {t('integrationConflict')}
              <code className="conflict-cmd mono">{conflict}</code>
              <div style={{ marginTop: 6 }}>{t('integrationConflictAsk')}</div>
            </div>
          )}
        </div>
        <div className="connect-actions">
          {conflict ? (
            <>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => install(false, false)}>
                {t('integrationOnlyHooks')}
              </button>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => install(true, true)}>
                {busy && <Spinner />}
                {t('integrationReplace')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => install(true, false)}>
              {busy && <Spinner />}
              {t('integrationInstall')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function CliMissing() {
  const { state, t, api } = useApp()
  if (state.cli.found) return null
  return (
    <div className="banner banner-info" role="status">
      <div className="banner-icon">
        <IconTerminal size={18} />
      </div>
      <div className="banner-text">
        <span className="banner-kicker">{t('bannerKickerInfo')}</span>
        <div className="banner-title">{t('cliMissingTitle')}</div>
        <div className="banner-sub">{t('cliMissingBody')}</div>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => void api.openExternal('https://code.claude.com/docs/en/setup')}>
        {t('cliMissingLink')}
      </button>
    </div>
  )
}

function FirstRun() {
  const { state, t, api, setState, openDialog, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const cand = state.defaultCliCandidate
  return (
    <>
      <section className="hero">
        <div className="hero-art" aria-hidden="true">
          <HeroArt />
        </div>
        <Logo size={48} />
        <h2 className="hero-title">{t('emptyTitle')}</h2>
        <ul className="hero-list">
          {(['emptyLine1', 'emptyLine2', 'emptyLine3'] as const).map((k) => (
            <li key={k}>
              <span className="tick">
                <IconCheck size={12} stroke={2.6} />
              </span>
              {t(k)}
            </li>
          ))}
        </ul>
        <div className="hero-actions">
          <button type="button" className="btn btn-primary btn-lg" data-sound="none" onClick={() => openDialog({ type: 'add' })}>
            <IconPlus size={17} />
            {t('addAccount')}
          </button>
        </div>
      </section>
      {cand && (
        <div className="card candidate">
          <div className="connect-icon">
            <IconUser size={18} />
          </div>
          <div className="connect-text">
            <div className="connect-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {t('candidateTitle', { email: maskEmail(cand.email) || '—' })}
              {cand.plan && <PlanBadge plan={cand.plan} t={t} />}
            </div>
            <div className="connect-body">{t('candidateBody')}</div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                setState(await api.adoptDefaultCli())
                play('success')
              } catch (e) {
                play('error')
                toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Spinner />}
            {t('candidateAdopt')}
          </button>
        </div>
      )}
    </>
  )
}

/** First-run figure: three meters on a hairline grid, one of them in the highlight color. */
function HeroArt() {
  const rows = [0.86, 0.42, 0.64]
  return (
    <svg width="260" height="150" viewBox="0 0 260 150">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <line key={i} x1={20 + i * 36} x2={20 + i * 36} y1="10" y2="140" stroke="var(--rule)" />
      ))}
      {rows.map((v, i) => (
        <g key={i} transform={`translate(20 ${34 + i * 38})`}>
          <rect width="216" height="6" fill="var(--track)" />
          <rect width={216 * v} height="6" fill={i === 1 ? 'var(--accent)' : 'var(--ink)'} />
          <text x="0" y="-8" fontFamily="var(--font-mono)" fontSize="9" letterSpacing="1" fill="var(--ink-3)">
            {['5H', 'WEEK', 'MAX 5X'][i]}
          </text>
        </g>
      ))}
    </svg>
  )
}

function Facts() {
  const { state, t } = useApp()
  const accounts = state.accounts
  const current = accounts.find((a) => a.isDesktopCurrent)
  const available = accounts.filter((a) => a.status === 'ok' || a.status === 'warn').length
  const limitedCount = accounts.filter((a) => a.status === 'limited').length
  const desktopText = !state.desktop.found
    ? t('sideDesktopNone')
    : current
      ? displayName(current)
      : state.desktop.currentAccountUuid
        ? t('sideDesktopUnknownAccount')
        : t('sideDesktopIdle')
  return (
    <div className="facts">
      <div className="fact">
        <span className="label">{t('factAccounts')}</span>
        <span className="fact-value num">{pad(accounts.length)}</span>
      </div>
      <div className="fact">
        <span className="label">{t('factAvailable')}</span>
        <span className="fact-value num">{pad(available)}</span>
      </div>
      <div className="fact">
        <span className="label">{t('factLimited')}</span>
        <span className={`fact-value num${limitedCount > 0 ? ' is-bad' : ''}`}>{pad(limitedCount)}</span>
      </div>
      <div className="fact">
        <span className="label">{t('factDesktop')}</span>
        <span className="fact-value is-text">
          <span className={`dot-sm fact-mark ${current ? (current.status === 'limited' ? 'dot-bad' : 'dot-ok') : 'dot-muted'}`} />
          <span className="ellipsis">{desktopText}</span>
        </span>
      </div>
    </div>
  )
}

export function Dashboard() {
  const { state, t, api, setState, toast, openDialog } = useApp()
  const [spinning, setSpinning] = useState(false)
  const accounts = state.accounts

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

  const sorted: AccountView[] = [...accounts].sort((a, b) => {
    const rank = (x: AccountView) => (x.isDesktopCurrent ? 0 : 1)
    return rank(a) - rank(b) || a.addedAt - b.addedAt
  })

  return (
    <div className="page">
      <PageHead
        index={1}
        kicker={t('kDashboard')}
        title={t('dashTitle')}
        actions={
          <>
            <button
              type="button"
              className={`icon-btn bordered${spinning ? ' spin-once' : ''}`}
              aria-label={t('refresh')}
              title={t('refresh')}
              onClick={refresh}
            >
              <IconRefresh size={16} />
            </button>
            {accounts.length > 0 && (
              <button type="button" className="btn btn-primary" data-sound="none" onClick={() => openDialog({ type: 'add' })}>
                <IconPlus size={15} />
                {t('addAccount')}
              </button>
            )}
          </>
        }
      />

      {accounts.length > 0 && <Facts />}
      <CliMissing />

      {accounts.length === 0 ? (
        <FirstRun />
      ) : (
        <>
          <LimitBanner />
          <section className="sec">
            <SectionHead index={1} title={t('secAccounts')} meta={t('secAccountsMeta')} />
            <div className="acct-grid">
              {sorted.map((a) => (
                <AccountCard key={a.id} account={a} />
              ))}
              <button type="button" className="add-tile" data-sound="none" onClick={() => openDialog({ type: 'add' })}>
                <span className="add-tile-icon">
                  <IconPlus size={20} />
                </span>
                <span className="add-tile-title">{t('addTile')}</span>
                <span className="add-tile-hint">{t('addTileHint')}</span>
              </button>
            </div>
          </section>
        </>
      )}
      <ConnectCard index={2} />
    </div>
  )
}
