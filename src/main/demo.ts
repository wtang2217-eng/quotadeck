// Backend for `--demo`: serves the fake data in src/shared/demo.ts and pretends to carry out actions.
// Used for README screenshots and for trying the app without any account.

import { EventEmitter } from 'node:events'
import { demoConversations, demoProjects, demoSetupStatus, demoState, demoStats, setDemoOrgLabel } from '@shared/demo'
import type {
  AppState,
  ConversationQuery,
  DesktopSwitchOptions,
  DesktopSwitchResult,
  LoginProgress,
  PendingSwitch,
  Settings,
  SetupOptions,
  SetupProgress,
  StatsQuery,
  UpdateInfo
} from '@shared/types'
import type { Backend } from './backend'

export class DemoBackend extends EventEmitter implements Backend {
  private state: AppState
  private favorites = new Set<string>()
  private setupDone = false

  constructor(lang: Settings['language']) {
    super()
    this.state = demoState(lang)
    for (const c of demoConversations(lang)) if (c.favorite) this.favorites.add(c.cliSessionId)
  }

  get settings(): Settings {
    return this.state.settings
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  getState(): AppState {
    return this.state
  }

  refresh(): AppState {
    return this.state
  }

  private push(): void {
    this.emit('state', this.state)
  }

  async adoptDefaultCli(): Promise<void> {}

  async startLogin(): Promise<string> {
    const loginId = `demo-${Date.now()}`
    const send = (p: Omit<LoginProgress, 'loginId'>, ms: number) => setTimeout(() => this.emit('login-progress', { loginId, ...p }), ms)
    send({ phase: 'starting' }, 100)
    send({ phase: 'waiting-browser', url: 'https://claude.ai/oauth/authorize?demo=1', message: 'Opening browser to sign in…' }, 700)
    send({ phase: 'verifying' }, 2600)
    send({ phase: 'done', accountId: this.state.accounts[2].id, duplicate: true }, 3400)
    return loginId
  }

  async cancelLogin(): Promise<void> {}

  updateAccount(id: string, patch: { nickname?: string; color?: string }): void {
    this.state = { ...this.state, accounts: this.state.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
    this.push()
  }

  async removeAccount(): Promise<void> {}

  async continueInTerminal() {
    return { ok: true }
  }

  prepareDesktopSwitch(toAccountId: string, opts?: DesktopSwitchOptions): DesktopSwitchResult {
    const target = this.state.accounts.find((a) => a.id === toAccountId)
    const last = this.state.lastInterrupted
    const conv = demoConversations(this.settings.language).find((c) => c.cliSessionId === (opts?.cliSessionId ?? last?.cliSessionId))
    const pending: PendingSwitch = {
      id: `demo-switch-${Date.now()}`,
      fromAccountId: opts?.fromAccountId ?? this.state.accounts.find((a) => a.isDesktopCurrent)?.id,
      toAccountId,
      conversation: conv
        ? { cliSessionId: conv.cliSessionId, desktopSessionId: conv.desktopSessionId, title: conv.title, cwd: conv.cwd, inTargetList: true }
        : undefined,
      startedAt: Date.now(),
      phase: 'waiting'
    }
    this.state = { ...this.state, pendingSwitch: pending }
    this.push()
    // Pretend the user signed in a few seconds later.
    setTimeout(() => {
      if (this.state.pendingSwitch?.id !== pending.id) return
      const done: PendingSwitch = { ...pending, phase: 'done', finishedAt: Date.now(), copiedPrompt: !!conv }
      this.state = {
        ...this.state,
        pendingSwitch: done,
        accounts: this.state.accounts.map((a) => ({ ...a, isDesktopCurrent: a.id === toAccountId }))
      }
      this.emit('switch-progress', done)
      this.push()
    }, 5000)
    return { ok: true, copied: 3, targetEmail: target?.email, pending }
  }

  cancelPendingSwitch(): void {
    this.state = { ...this.state, pendingSwitch: undefined }
    this.push()
  }

  async openDesktopApp() {
    return { ok: true }
  }

  /** Demo mode never opens the real desktop app. */
  desktopLinkFor(): string | undefined {
    return undefined
  }

  listConversations(query?: ConversationQuery) {
    const q = query?.search?.trim().toLowerCase()
    let items = demoConversations(this.settings.language).map((c) => ({ ...c, favorite: this.favorites.has(c.cliSessionId) }))
    if (q) items = items.filter((c) => c.title.toLowerCase().includes(q) || c.cwd?.toLowerCase().includes(q))
    if (query?.cwd) items = items.filter((c) => c.cwd?.toLowerCase() === query.cwd!.toLowerCase())
    if (query?.accountId) items = items.filter((c) => c.accountIds.includes(query.accountId!))
    if (query?.entrypoint) items = items.filter((c) => (c.entrypoint === 'claude-desktop') === (query.entrypoint === 'desktop'))
    if (query?.favoritesOnly) items = items.filter((c) => c.favorite)
    return query?.limit ? items.slice(0, query.limit) : items
  }

  listProjects() {
    return demoProjects(this.settings.language)
  }

  setFavorite(cliSessionId: string, favorite: boolean): void {
    if (favorite) this.favorites.add(cliSessionId)
    else this.favorites.delete(cliSessionId)
  }

  async exportMarkdown(cliSessionId: string) {
    const c = demoConversations(this.settings.language).find((x) => x.cliSessionId === cliSessionId)
    if (!c) return undefined
    const markdown = `# ${c.title}\n\n- 文件夹：\`${c.cwd}\`\n\n## 你\n\n${c.firstPrompt}\n\n## Claude\n\n（演示数据）\n`
    return { markdown, fileName: c.title }
  }

  async getStats(query: StatsQuery) {
    return demoStats(this.settings.language, query.range, query.accountId)
  }

  setOrgLabel(orgUuid: string, label: string): void {
    setDemoOrgLabel(orgUuid, label)
    this.push()
  }

  async ledgerCsv(query: StatsQuery) {
    const s = demoStats(this.settings.language, query.range, query.accountId)
    const zh = this.settings.language === 'zh-CN'
    const head = zh ? '日期,账号,模型,按 API 标价折算（美元）' : 'Date,Account,Model,At API list prices (USD)'
    const rows = s.days.flatMap((d) => Object.entries(d.byAccount).map(([id, usd]) => `${d.day},${s.byAccount.find((a) => a.accountId === id)?.label ?? id},Opus 5.5,${usd.toFixed(2)}`))
    return { csv: [head, ...rows].join('\r\n') + '\r\n', fileName: zh ? 'QuotaDeck 用量账本（演示）' : 'QuotaDeck usage ledger (demo)' }
  }

  async getSetupStatus() {
    return { ...demoSetupStatus(this.settings.language, !this.setupDone && this.state.needsSetup), running: false }
  }

  async runSetup(opts: SetupOptions): Promise<string> {
    const runId = `demo-setup-${Date.now()}`
    const send = (p: Omit<SetupProgress, 'runId'>, ms: number) => setTimeout(() => this.emit('setup-progress', { runId, ...p } satisfies SetupProgress), ms)
    const zh = this.settings.language === 'zh-CN'
    let t = 200
    if (opts.installCli) {
      send({ step: 'cli', phase: 'running', message: zh ? '正在用官方安装脚本安装 Claude Code…' : 'Installing Claude Code with the official installer…' }, t)
      send({ step: 'cli', phase: 'running', message: 'Setting up Claude Code...' }, (t += 900))
      send({ step: 'cli', phase: 'ok', message: zh ? '已安装 2.1.283' : 'Installed 2.1.283' }, (t += 900))
    }
    send({ step: 'main-account', phase: 'ok', message: zh ? '已加入 alice.chen@example.com' : 'Added alice.chen@example.com' }, (t += 500))
    if (opts.connectIntegration) send({ step: 'integration', phase: 'ok', message: zh ? '已接入' : 'Connected' }, (t += 500))
    send({ step: 'open-at-login', phase: opts.openAtLogin ? 'ok' : 'skipped' }, (t += 300))
    setTimeout(() => {
      this.setupDone = true
      this.state = { ...this.state, needsSetup: false, settings: { ...this.state.settings, openAtLogin: opts.openAtLogin || this.state.settings.openAtLogin } }
      this.emit('setup-progress', { runId, phase: 'done', ok: true, status: demoSetupStatus(this.settings.language, false) } satisfies SetupProgress)
      this.push()
    }, t + 300)
    return runId
  }

  dismissSetup(): void {
    this.state = { ...this.state, needsSetup: false }
    this.push()
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    return this.state.update ?? { current: this.state.appVersion, available: false }
  }

  runMergeNow() {
    return this.state.merge
  }

  async undoMergeNow() {
    return this.state.merge
  }

  installIntegration() {
    return this.state.integration
  }

  uninstallIntegration() {
    return this.state.integration
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = { ...this.state.settings, ...patch }
    // Regenerate localized demo text when the language changes.
    this.state = patch.language && patch.language !== this.state.settings.language ? { ...demoState(settings.language), settings } : { ...this.state, settings }
    this.push()
  }

  clearEvents(): void {
    this.state = { ...this.state, events: [] }
    this.push()
  }
}
