// Browser-only stand-in for window.qd, backed by the shared demo data.
// Query parameters for previewing states: ?lang=en ?theme=dark ?style=swiss|editorial|eclipse ?accent=ikb|lemon|green|orange ?empty=1 ?conflict=1 ?warn=1 ?dup=1 ?ratio=1 ?page=settings ?dialog=switch|add ?still=1

import type { QuotaDeckApi } from '@shared/api'
import { demoConversations, demoState } from '@shared/demo'
import type { ActivityEvent, AppState, Language, LoginProgress, MergeStatus, Page, Settings, UiCommand } from '@shared/types'

type Listener<T> = (v: T) => void

function clone<T>(v: T): T {
  return structuredClone(v)
}

export function createMockApi(): QuotaDeckApi {
  const params = new URLSearchParams(location.search)
  if (params.get('still') === '1') document.documentElement.dataset.motion = 'off'
  let lang: Language = params.get('lang') === 'en' ? 'en' : 'zh-CN'
  let state: AppState = build(lang)

  function build(l: Language): AppState {
    const s = demoState(l)
    const theme = params.get('theme')
    if (theme === 'dark' || theme === 'light') s.settings.theme = theme
    const style = params.get('style')
    if (style === 'swiss' || style === 'editorial' || style === 'eclipse') s.settings.uiStyle = style
    const accent = params.get('accent')
    if (accent === 'ikb' || accent === 'lemon' || accent === 'green' || accent === 'orange') s.settings.accent = accent
    if (params.get('empty') === '1') {
      s.accounts = []
      s.recommendedAccountId = undefined
      s.lastInterrupted = undefined
      s.events = []
      s.defaultCliCandidate = {
        email: 'alice.chen@example.com',
        plan: { kind: 'max5x', label: 'Max 5x', multiplier: 5 },
        accountUuid: 'a1f0c3d2-0000-4000-8000-000000000009'
      }
      s.integration = { ...s.integration, hooksInstalled: false, statusLineInstalled: false }
    }
    if (params.get('conflict') === '1') {
      s.integration = {
        ...s.integration,
        hooksInstalled: false,
        statusLineInstalled: false,
        statusLineConflict: 'bash ~/.claude/statusline-command.sh'
      }
    }
    if (params.get('ratio') === '1') {
      for (const a of s.accounts) if (a.estimate) a.estimate = { ...a.estimate, basis: 'plan-ratio' }
    }
    if (params.get('warn') === '1') {
      const bob = s.accounts[1]
      bob.status = 'warn'
      bob.limit = undefined
      bob.usage = { ...bob.usage!, fiveHour: { pct: 86, resetsAt: Date.now() + 78 * 60_000 } }
    }
    return s
  }

  const stateL = new Set<Listener<AppState>>()
  const commandL = new Set<Listener<UiCommand>>()
  const loginL = new Set<Listener<LoginProgress>>()
  const timers = new Map<string, number[]>()

  const emit = () => stateL.forEach((cb) => cb(clone(state)))
  const log = (name: string, ...args: unknown[]) => console.info(`[mock] ${name}`, ...args)
  const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms))
  const addEvent = (ev: Omit<ActivityEvent, 'id' | 'at'>) => {
    state.events = [{ id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...ev }, ...state.events].slice(0, 300)
  }

  const runLogin = (loginId: string, reAccountId?: string) => {
    const send = (p: Omit<LoginProgress, 'loginId'>) => loginL.forEach((cb) => cb({ loginId, ...p }))
    const ids: number[] = []
    ids.push(window.setTimeout(() => send({ phase: 'starting', message: 'Starting claude auth login…' }), 50))
    ids.push(
      window.setTimeout(
        () =>
          send({
            phase: 'waiting-browser',
            url: 'https://claude.ai/oauth/authorize?code=true&client_id=demo-client&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback&scope=user%3Ainference'
          }),
        700
      )
    )
    ids.push(window.setTimeout(() => send({ phase: 'verifying', message: 'Login successful. Reading account…' }), 4200))
    ids.push(
      window.setTimeout(() => {
        let accountId = reAccountId
        if (!accountId && params.get('dup') === '1') {
          send({ phase: 'done', accountId: state.accounts[0]?.id, duplicate: true })
          return
        }
        if (!accountId) {
          accountId = `a1f0c3d2-0000-4000-8000-${String(Date.now()).slice(-12)}`
          state.accounts = [
            ...state.accounts,
            {
              id: accountId,
              accountUuid: accountId,
              orgUuid: accountId.replace('a1f0', 'b2e1'),
              email: 'dave.lee@example.com',
              displayName: 'Dave',
              color: '#3B82F6',
              plan: { kind: 'pro', label: 'Pro', multiplier: 1 },
              cliConfigDir: 'C:\\Users\\alice\\.quotadeck\\profiles\\dave',
              cliLoggedIn: true,
              addedAt: Date.now(),
              history: [],
              isDesktopCurrent: false,
              desktopSessionCount: 0,
              status: 'unknown'
            }
          ]
          addEvent({ type: 'login', accountId, title: lang === 'zh-CN' ? '已添加 dave.lee@example.com（Pro）' : 'Added dave.lee@example.com (Pro)' })
        }
        emit()
        send({ phase: 'done', accountId, duplicate: false })
      }, 5600)
    )
    timers.set(loginId, ids)
  }

  const api: QuotaDeckApi = {
    async getState() {
      return clone(state)
    },
    async refresh() {
      await wait(450)
      log('refresh')
      return clone(state)
    },
    onState(cb) {
      stateL.add(cb)
      return () => stateL.delete(cb)
    },
    onCommand(cb) {
      commandL.add(cb)
      return () => commandL.delete(cb)
    },

    async adoptDefaultCli() {
      await wait()
      const fresh = demoState(lang)
      state.accounts = [fresh.accounts[0]]
      state.defaultCliCandidate = undefined
      state.recommendedAccountId = fresh.accounts[0].id
      log('adoptDefaultCli')
      emit()
      return clone(state)
    },
    async startLogin(opts) {
      const loginId = `login-${Date.now()}`
      log('startLogin', opts)
      runLogin(loginId)
      return { loginId }
    },
    async reLogin(accountId) {
      const loginId = `login-${Date.now()}`
      log('reLogin', accountId)
      runLogin(loginId, accountId)
      return { loginId }
    },
    async cancelLogin(loginId) {
      timers.get(loginId)?.forEach((id) => clearTimeout(id))
      loginL.forEach((cb) => cb({ loginId, phase: 'cancelled' }))
      log('cancelLogin', loginId)
    },
    onLoginProgress(cb) {
      loginL.add(cb)
      return () => loginL.delete(cb)
    },
    async updateAccount(accountId, patch) {
      state.accounts = state.accounts.map((a) => (a.id === accountId ? { ...a, nickname: patch.nickname || undefined, color: patch.color ?? a.color } : a))
      log('updateAccount', accountId, patch)
      emit()
      return clone(state)
    },
    async removeAccount(accountId, opts) {
      state.accounts = state.accounts.filter((a) => a.id !== accountId)
      if (state.recommendedAccountId === accountId) state.recommendedAccountId = state.accounts[0]?.id
      log('removeAccount', accountId, opts)
      emit()
      return clone(state)
    },

    async continueInTerminal(req) {
      await wait(500)
      log('continueInTerminal', req)
      const a = state.accounts.find((x) => x.id === req.accountId)
      addEvent({
        type: 'switch',
        accountId: req.accountId,
        title: lang === 'zh-CN' ? `在终端用 ${a?.nickname ?? a?.email} 接着聊` : `Continued in a terminal as ${a?.nickname ?? a?.email}`,
        cliSessionId: req.cliSessionId,
        cwd: req.cwd
      })
      emit()
      return { ok: true }
    },
    async prepareDesktopSwitch(toAccountId) {
      await wait(700)
      const a = state.accounts.find((x) => x.id === toAccountId)
      log('prepareDesktopSwitch', toAccountId)
      return { ok: true, copied: 3, targetEmail: a?.email }
    },
    async openDesktopApp() {
      log('openDesktopApp')
      return { ok: true }
    },

    async listConversations(query) {
      await wait(120)
      const q = query?.search?.toLowerCase()
      const all = demoConversations(lang)
      const list = q ? all.filter((c) => `${c.title} ${c.cwd ?? ''} ${c.firstPrompt ?? ''}`.toLowerCase().includes(q)) : all
      return list.slice(0, query?.limit ?? 200)
    },

    async runMergeNow() {
      await wait(600)
      const merge: MergeStatus = { ...state.merge, lastRunAt: Date.now(), lastCopied: 2, totalCopied: state.merge.totalCopied + 2 }
      state.merge = merge
      emit()
      return clone(merge)
    },
    async undoMerge() {
      await wait(400)
      state.merge = { ...state.merge, totalCopied: 0, lastCopied: 0 }
      emit()
      return clone(state.merge)
    },

    async installIntegration(opts) {
      await wait(400)
      state.integration = {
        ...state.integration,
        hooksInstalled: opts.hooks || state.integration.hooksInstalled,
        statusLineInstalled: opts.statusLine && (!state.integration.statusLineConflict || !!opts.replaceStatusLine),
        statusLineConflict: opts.statusLine && opts.replaceStatusLine ? undefined : state.integration.statusLineConflict
      }
      log('installIntegration', opts)
      emit()
      return clone(state.integration)
    },
    async uninstallIntegration() {
      await wait(300)
      state.integration = { ...state.integration, hooksInstalled: false, statusLineInstalled: false }
      emit()
      return clone(state.integration)
    },

    async updateSettings(patch: Partial<Settings>) {
      const next = { ...state.settings, ...patch }
      if (patch.desktopDataDirOverride === '') delete next.desktopDataDirOverride
      if (patch.language && patch.language !== lang) {
        lang = patch.language
        const rebuilt = build(lang)
        state = { ...rebuilt, accounts: rebuilt.accounts, settings: next }
      } else state.settings = next
      log('updateSettings', patch)
      emit()
      return clone(state)
    },
    async clearEvents() {
      state.events = []
      emit()
      return clone(state)
    },
    async openPath(path) {
      log('openPath', path)
    },
    async openExternal(url) {
      log('openExternal', url)
      window.open(url, '_blank', 'noopener')
    },
    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        /* clipboard may be blocked in the preview */
      }
      log('copyText', text)
    }
  }

  // Dev helpers for the preview: __qdMock.command({ type: 'open-switch' }), __qdMock.pushEvent('limit-hit')
  ;(window as unknown as { __qdMock: unknown }).__qdMock = {
    command: (cmd: UiCommand) => commandL.forEach((cb) => cb(cmd)),
    navigate: (page: Page) => commandL.forEach((cb) => cb({ type: 'navigate', page })),
    pushEvent: (type: ActivityEvent['type'] = 'limit-hit') => {
      addEvent({ type, title: type === 'limit-hit' ? 'Test limit event' : 'Test event', accountId: state.accounts[0]?.id })
      emit()
    },
    get state() {
      return clone(state)
    }
  }

  const initialPage = params.get('page') as Page | null
  const initialDialog = params.get('dialog')
  setTimeout(() => {
    if (initialPage) commandL.forEach((cb) => cb({ type: 'navigate', page: initialPage }))
    if (initialDialog === 'switch') commandL.forEach((cb) => cb({ type: 'open-switch' }))
    if (initialDialog === 'add') commandL.forEach((cb) => cb({ type: 'open-add-account' }))
  }, 300)

  return api
}
