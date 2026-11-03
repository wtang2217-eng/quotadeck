import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuotaDeckApi } from '@shared/api'
import type { AppState, Page } from '@shared/types'
import { IconCheck, IconInfo, IconX, Logo } from './components/icons'
import { Ctx, type AppCtx, type DialogState, type ToastKind } from './context'
import { EditAccountDialog, RemoveAccountDialog } from './dialogs/AccountDialogs'
import { AddAccountDialog } from './dialogs/AddAccountDialog'
import { SwitchDialog } from './dialogs/SwitchDialog'
import { makeT } from './i18n'
import { About } from './pages/About'
import { Activity } from './pages/Activity'
import { Conversations } from './pages/Conversations'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { configureSound, installClickSounds, play, preloadSounds } from './sound'
import { displayName, resolveTheme, withViewTransition } from './util'

interface Toast {
  id: number
  message: string
  kind: ToastKind
  leaving?: boolean
}

export const NAV: { page: Page; key: 'navDashboard' | 'navConversations' | 'navActivity' | 'navSettings' | 'navAbout' }[] = [
  { page: 'dashboard', key: 'navDashboard' },
  { page: 'conversations', key: 'navConversations' },
  { page: 'activity', key: 'navActivity' },
  { page: 'settings', key: 'navSettings' },
  { page: 'about', key: 'navAbout' }
]

/** Height of one sidebar index row, for the gliding marker. */
const NAV_ROW = 38

function platformName(p: string): 'mac' | 'win' | 'linux' {
  return p === 'darwin' ? 'mac' : p === 'win32' ? 'win' : 'linux'
}

export function App({ api }: { api: QuotaDeckApi }) {
  const [state, setState] = useState<AppState | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [now, setNow] = useState(() => Date.now())
  const known = useRef<Set<string> | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let alive = true
    api
      .getState()
      .then((s) => alive && setState(s))
      .catch(() => undefined)
    const off = api.onState((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [api])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    preloadSounds()
    return installClickSounds()
  }, [])

  const settings = state?.settings
  useEffect(() => {
    if (settings) configureSound({ enabled: settings.soundEnabled, volume: settings.soundVolume })
  }, [settings?.soundEnabled, settings?.soundVolume])

  // Theme: follow the setting, and the OS when the setting is "system".
  useEffect(() => {
    if (!settings) return
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(settings.theme)
    }
    apply()
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  useEffect(() => {
    if (settings) document.documentElement.lang = settings.language
  }, [settings?.language])

  // Visual style and Swiss highlight color, plus the platform for window chrome spacing.
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.style = settings.uiStyle ?? 'swiss'
    root.dataset.accent = settings.accent ?? 'ikb'
  }, [settings?.uiStyle, settings?.accent])

  useEffect(() => {
    if (state) document.documentElement.dataset.platform = platformName(state.platform)
  }, [state?.platform])

  // Alert sounds for limit events that arrive while the app is open (never for events loaded at start).
  useEffect(() => {
    if (!state) return
    if (known.current === null) {
      known.current = new Set(state.events.map((e) => e.id))
      return
    }
    const fresh = state.events.filter((e) => !known.current!.has(e.id))
    for (const e of fresh) known.current.add(e.id)
    if (fresh.some((e) => e.type === 'limit-hit')) play('alert')
    else if (fresh.some((e) => e.type === 'threshold')) play('warn')
  }, [state?.events])

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list.slice(-3), { id, message, kind }])
    window.setTimeout(() => setToasts((list) => list.map((x) => (x.id === id ? { ...x, leaving: true } : x))), 2600)
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 2850)
  }, [])

  const navigate = useCallback((p: Page) => {
    withViewTransition(() => setPage(p))
    mainRef.current?.scrollTo({ top: 0 })
  }, [])

  useEffect(
    () =>
      api.onCommand((cmd) => {
        if (cmd.type === 'navigate') {
          setDialog(null)
          navigate(cmd.page)
        } else if (cmd.type === 'open-switch') {
          setPage('dashboard')
          setDialog({ type: 'switch', mode: 'both', fromAccountId: cmd.fromAccountId, toAccountId: cmd.toAccountId })
        } else if (cmd.type === 'open-add-account') {
          setDialog({ type: 'add' })
        }
      }),
    [api, navigate]
  )

  const ctx = useMemo<AppCtx | null>(() => {
    if (!state) return null
    const lang = state.settings.language
    return {
      api,
      state,
      setState,
      t: makeT(lang),
      lang,
      tz: state.settings.timezone,
      now,
      page,
      navigate,
      openDialog: setDialog,
      closeDialog: () => setDialog(null),
      toast
    }
  }, [api, state, now, page, navigate, toast])

  if (!ctx || !state) {
    return (
      <div className="splash">
        <Logo size={44} />
        <span className="spinner" />
      </div>
    )
  }

  const { t } = ctx
  const current = state.accounts.find((a) => a.isDesktopCurrent)
  const limitedCount = state.accounts.filter((a) => a.status === 'limited').length
  const integ = state.integration
  const integOn = integ.hooksInstalled && integ.statusLineInstalled
  const integSome = integ.hooksInstalled || integ.statusLineInstalled
  const navIndex = NAV.findIndex((n) => n.page === page)
  const close = () => setDialog(null)

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="strip drag" />
          <div className="brand">
            <Logo size={30} />
            <div className="brand-text">
              <div className="brand-name">QuotaDeck</div>
              <div className="brand-tag">{t('brandTag')}</div>
            </div>
          </div>
          <nav className="nav" aria-label="main">
            <span className="nav-mark" style={{ transform: `translateY(${navIndex * NAV_ROW}px)` }} />
            {NAV.map((n, i) => (
              <button
                key={n.page}
                type="button"
                className={`nav-item${page === n.page ? ' active' : ''}`}
                aria-current={page === n.page ? 'page' : undefined}
                onClick={() => page !== n.page && navigate(n.page)}
              >
                <span className="nav-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="nav-label">{t(n.key)}</span>
                {n.page === 'dashboard' && limitedCount > 0 && <span className="nav-count">{limitedCount}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="side-status">
              <button type="button" className="side-row" onClick={() => navigate('dashboard')}>
                <span className="side-row-label">{t('sideDesktop')}</span>
                <span className="side-row-value">
                  {!state.desktop.found ? (
                    <>
                      <span className="dot-sm dot-muted" />
                      {t('sideDesktopNone')}
                    </>
                  ) : current ? (
                    <>
                      <span className={`dot-sm ${current.status === 'limited' ? 'dot-bad' : current.status === 'warn' ? 'dot-warn' : 'dot-ok'}`} />
                      <span className="ellipsis">{displayName(current)}</span>
                    </>
                  ) : state.desktop.currentAccountUuid ? (
                    <>
                      <span className="dot-sm dot-muted" />
                      {t('sideDesktopUnknownAccount')}
                    </>
                  ) : (
                    <>
                      <span className="dot-sm dot-muted" />
                      {t('sideDesktopIdle')}
                    </>
                  )}
                </span>
              </button>
              <button type="button" className="side-row" onClick={() => navigate('settings')}>
                <span className="side-row-label">{t('sideIntegration')}</span>
                <span className="side-row-value">
                  <span className={`dot-sm ${integOn ? 'dot-ok' : integSome ? 'dot-warn' : 'dot-muted'}`} />
                  {integOn ? t('sideIntegrationOn') : integSome ? t('sideIntegrationPartial') : t('sideIntegrationOff')}
                </span>
              </button>
            </div>
            <div className="side-version">
              <span>v{state.appVersion}</span>
              {state.demo && <span className="badge badge-accent">{t('demoMode')}</span>}
            </div>
          </div>
        </aside>

        <main className="main" ref={mainRef}>
          <div className="topbar drag">
            <span>
              <b>QuotaDeck</b> <i>/</i> {String(navIndex + 1).padStart(2, '0')} {t(NAV[navIndex]?.key ?? 'navDashboard')}
            </span>
            <span className="grow" />
            <span className="topbar-meta">{t('topbarMeta')}</span>
          </div>
          {page === 'dashboard' && <Dashboard />}
          {page === 'conversations' && <Conversations />}
          {page === 'activity' && <Activity />}
          {page === 'settings' && <Settings />}
          {page === 'about' && <About />}
        </main>
      </div>

      {dialog?.type === 'add' && <AddAccountDialog key="add" reLoginAccountId={dialog.reLoginAccountId} onClose={close} />}
      {dialog?.type === 'switch' && (
        <SwitchDialog
          key={`switch-${dialog.mode}-${dialog.toAccountId ?? ''}-${dialog.cliSessionId ?? ''}`}
          mode={dialog.mode}
          fromAccountId={dialog.fromAccountId}
          toAccountId={dialog.toAccountId}
          cliSessionId={dialog.cliSessionId}
          cwd={dialog.cwd}
          onClose={close}
        />
      )}
      {dialog?.type === 'edit' && <EditAccountDialog key={`edit-${dialog.accountId}`} accountId={dialog.accountId} onClose={close} />}
      {dialog?.type === 'remove' && <RemoveAccountDialog key={`remove-${dialog.accountId}`} accountId={dialog.accountId} onClose={close} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}${x.leaving ? ' leaving' : ''}`}>
            <span className="toast-icon">{x.kind === 'ok' ? <IconCheck size={13} stroke={3} /> : x.kind === 'bad' ? <IconX size={13} stroke={3} /> : <IconInfo size={13} stroke={2.6} />}</span>
            <span>{x.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
