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
import { PlanBadge, Spinner } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { displayName, errMessage, limitKindKey, shownRemaining } from '../util'

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
            <IconZap size={20} />
          </div>
          <div className="banner-text">
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
          <IconZap size={20} />
        </div>
        <div className="banner-text">
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
          className="btn btn-primary"
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
          <IconAlert size={20} />
        </div>
        <div className="banner-text">
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

function ConnectCard() {
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
    <div className={`card connect${conflict ? ' top' : ''}`}>
      <div className="connect-icon">
        <IconPlug size={20} />
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
  )
}

function CliMissing() {
  const { state, t, api } = useApp()
  if (state.cli.found) return null
  return (
    <div className="banner banner-info" role="status">
      <div className="banner-icon">
        <IconTerminal size={20} />
      </div>
      <div className="banner-text">
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
        <Logo size={52} />
        <h2 className="hero-title">{t('emptyTitle')}</h2>
        <ul className="hero-list">
          {(['emptyLine1', 'emptyLine2', 'emptyLine3'] as const).map((k) => (
            <li key={k}>
              <span className="tick">
                <IconCheck size={14} stroke={2.4} />
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
            <IconUser size={20} />
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

/** Decorative stacked cards for the first-run hero. */
function HeroArt() {
  return (
    <svg width="230" height="150" viewBox="0 0 230 150">
      <defs>
        <linearGradient id="hero-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#f9a8d4" />
        </linearGradient>
      </defs>
      <g transform="rotate(-7 160 80)">
        <rect x="88" y="22" width="130" height="92" rx="16" fill="var(--panel)" stroke="var(--border)" />
        <rect x="104" y="40" width="40" height="8" rx="4" fill="var(--panel-3)" />
        <rect x="104" y="62" width="96" height="6" rx="3" fill="var(--track)" />
        <rect x="104" y="62" width="74" height="6" rx="3" fill="#f43f5e" opacity="0.85" />
        <rect x="104" y="80" width="96" height="6" rx="3" fill="var(--track)" />
        <rect x="104" y="80" width="50" height="6" rx="3" fill="#f59e0b" />
      </g>
      <g>
        <rect x="18" y="38" width="140" height="100" rx="16" fill="var(--panel)" stroke="var(--border)" />
        <circle cx="42" cy="62" r="11" fill="url(#hero-a)" />
        <rect x="60" y="55" width="54" height="7" rx="3.5" fill="var(--text)" opacity="0.75" />
        <rect x="60" y="66" width="38" height="5" rx="2.5" fill="var(--text-3)" opacity="0.6" />
        <rect x="34" y="88" width="108" height="6" rx="3" fill="var(--track)" />
        <rect x="34" y="88" width="30" height="6" rx="3" fill="url(#hero-a)" />
        <rect x="34" y="106" width="108" height="6" rx="3" fill="var(--track)" />
        <rect x="34" y="106" width="52" height="6" rx="3" fill="url(#hero-a)" />
      </g>
    </svg>
  )
}

export function Dashboard() {
  const { state, t, api, setState, toast, openDialog } = useApp()
  const [spinning, setSpinning] = useState(false)
  const accounts = state.accounts
  const current = accounts.find((a) => a.isDesktopCurrent)
  const available = accounts.filter((a) => a.status === 'ok' || a.status === 'warn').length
  const limitedCount = accounts.filter((a) => a.status === 'limited').length

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
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('dashTitle')}</h1>
          {accounts.length > 0 && (
            <div className="page-sub">
              <span>{t('dashSubtitle', { count: accounts.length })}</span>
              <span className="dot-sm dot-ok" style={{ marginLeft: 4 }} />
              <span>{t('dashAvailable', { n: available })}</span>
              {limitedCount > 0 && (
                <>
                  <span className="dot-sm dot-bad" style={{ marginLeft: 4 }} />
                  <span>{t('dashLimitedCount', { n: limitedCount })}</span>
                </>
              )}
              {current && (
                <>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span>{t('dashCurrent', { name: displayName(current) })}</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="page-actions">
          <button
            type="button"
            className={`icon-btn bordered${spinning ? ' spin-once' : ''}`}
            aria-label={t('refresh')}
            title={t('refresh')}
            onClick={refresh}
          >
            <IconRefresh size={17} />
          </button>
          {accounts.length > 0 && (
            <button type="button" className="btn btn-primary" data-sound="none" onClick={() => openDialog({ type: 'add' })}>
              <IconPlus size={16} />
              {t('addAccount')}
            </button>
          )}
        </div>
      </header>

      <CliMissing />

      {accounts.length === 0 ? (
        <FirstRun />
      ) : (
        <>
          <LimitBanner />
          <div className="acct-grid">
            {sorted.map((a) => (
              <AccountCard key={a.id} account={a} />
            ))}
            <button type="button" className="add-tile" data-sound="none" onClick={() => openDialog({ type: 'add' })}>
              <span className="add-tile-icon">
                <IconPlus size={22} />
              </span>
              <span className="add-tile-title">{t('addTile')}</span>
              <span className="add-tile-hint">{t('addTileHint')}</span>
            </button>
          </div>
        </>
      )}
      <ConnectCard />
    </div>
  )
}
