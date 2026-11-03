import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuotaDeckApi } from '@shared/api'
import type { AccentChoice, AppState, Page } from '@shared/types'
import { CommandPalette } from './components/CommandPalette'
import { IconCheck, IconInfo, IconX, Logo } from './components/icons'
import { Sidebar, Topbar } from './components/Shell'
import { Ctx, type AppCtx, type DialogState, type ToastKind } from './context'
import { EditAccountDialog, RemoveAccountDialog } from './dialogs/AccountDialogs'
import { AddAccountDialog } from './dialogs/AddAccountDialog'
import { SwitchDialog } from './dialogs/SwitchDialog'
import { makeT } from './i18n'
import { About } from './pages/About'
import { Accounts } from './pages/Accounts'
import { Activity } from './pages/Activity'
import { Conversations } from './pages/Conversations'
import { Ledger } from './pages/Ledger'
import { Overview } from './pages/Overview'
import { Settings } from './pages/Settings'
import { Onboarding, Setup } from './pages/Setup'
import { configureSound, installClickSounds, play, preloadSounds } from './sound'
import { resolveTheme } from './util'

interface Toast {
  id: number
  message: string
  kind: ToastKind
  leaving?: boolean
}

const ACCENTS: AccentChoice[] = ['indigo', 'teal', 'orange', 'graphite']
const SCOPE_KEY = 'qd.scope'

function platformName(p: string): 'mac' | 'win' | 'linux' {
  return p === 'darwin' ? 'mac' : p === 'win32' ? 'win' : 'linux'
}

function readScope(): string {
  try {
    return localStorage.getItem(SCOPE_KEY) || 'all'
  } catch {
    return 'all'
  }
}

export function App({ api }: { api: QuotaDeckApi }) {
  const [state, setState] = useState<AppState | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [scope, setScopeRaw] = useState<string>(readScope)
  const [palette, setPalette] = useState(false)
  const known = useRef<Set<string> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  // Theme follows the setting, and the OS when the setting is "system".
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
    if (!settings) return
    const root = document.documentElement
    root.lang = settings.language
    root.dataset.accent = ACCENTS.includes(settings.accent) ? settings.accent : 'indigo'
    root.dataset.density = settings.density === 'compact' ? 'compact' : 'comfortable'
  }, [settings?.language, settings?.accent, settings?.density])

  useEffect(() => {
    if (state) document.documentElement.dataset.platform = platformName(state.platform)
  }, [state?.platform])

  // A scope whose account was removed falls back to every account.
  useEffect(() => {
    if (state && scope !== 'all' && !state.accounts.some((a) => a.id === scope)) setScopeRaw('all')
  }, [state?.accounts, scope])

  // First start: the welcome and setup flow opens over the app by itself, once.
  const setupShown = useRef(false)
  const [onboarding, setOnboarding] = useState(false)
  useEffect(() => {
    if (state?.needsSetup && !setupShown.current) {
      setupShown.current = true
      setOnboarding(true)
    }
  }, [state?.needsSetup])

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
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 2800)
  }, [])

  const navigate = useCallback((p: Page) => {
    setPage(p)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [])

  const setScope = useCallback((s: string) => {
    setScopeRaw(s)
    try {
      localStorage.setItem(SCOPE_KEY, s)
    } catch {
      /* storage may be unavailable; the scope then lasts for this window only */
    }
  }, [])

  useEffect(
    () =>
      api.onCommand((cmd) => {
        if (cmd.type === 'navigate') {
          setDialog(null)
          navigate(cmd.page)
        } else if (cmd.type === 'open-switch') {
          setPage('dashboard')
          setDialog({ type: 'switch', mode: 'both', fromAccountId: cmd.fromAccountId, toAccountId: cmd.toAccountId, cliSessionId: cmd.cliSessionId })
        } else if (cmd.type === 'open-add-account') {
          setDialog({ type: 'add' })
        }
      }),
    [api, navigate]
  )

  // Ctrl/Cmd + K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      toast,
      scope: scope !== 'all' && state.accounts.some((a) => a.id === scope) ? scope : 'all',
      setScope,
      openPalette: () => setPalette(true)
    }
  }, [api, state, now, page, navigate, toast, scope, setScope])

  if (!ctx || !state) {
    return (
      <div className="splash">
        <Logo size={36} />
      </div>
    )
  }

  const close = () => setDialog(null)

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <Sidebar />
        <main className="main">
          <Topbar />
          <div className="scroll" ref={scrollRef}>
            <div key={page + ctx.scope}>
              {page === 'dashboard' && <Overview />}
              {page === 'stats' && <Ledger />}
              {page === 'conversations' && <Conversations />}
              {page === 'accounts' && <Accounts />}
              {page === 'activity' && <Activity />}
              {page === 'settings' && <Settings />}
              {page === 'about' && <About />}
              {page === 'setup' && <Setup />}
            </div>
          </div>
        </main>
      </div>

      {onboarding && <Onboarding onClose={() => setOnboarding(false)} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {dialog?.type === 'add' && <AddAccountDialog key="add" reLoginAccountId={dialog.reLoginAccountId} onClose={close} />}
      {dialog?.type === 'switch' && (
        <SwitchDialog
          key={`switch-${dialog.mode}-${dialog.toAccountId ?? ''}-${dialog.cliSessionId ?? ''}`}
          mode={dialog.mode}
          fromAccountId={dialog.fromAccountId}
          toAccountId={dialog.toAccountId}
          cliSessionId={dialog.cliSessionId}
          cwd={dialog.cwd}
          title={dialog.title}
          onClose={close}
        />
      )}
      {dialog?.type === 'edit' && <EditAccountDialog key={`edit-${dialog.accountId}`} accountId={dialog.accountId} onClose={close} />}
      {dialog?.type === 'remove' && <RemoveAccountDialog key={`remove-${dialog.accountId}`} accountId={dialog.accountId} onClose={close} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}${x.leaving ? ' leaving' : ''}`}>
            <span className="toast-icon">{x.kind === 'ok' ? <IconCheck /> : x.kind === 'bad' ? <IconX /> : <IconInfo />}</span>
            <span>{x.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
