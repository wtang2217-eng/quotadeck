// Backend for `--demo`: serves the fake data in src/shared/demo.ts and pretends to carry out actions.
// Used for README screenshots and for trying the app without any account.

import { EventEmitter } from 'node:events'
import { demoConversations, demoState } from '@shared/demo'
import type { AppState, LoginProgress, Settings } from '@shared/types'
import type { Backend } from './backend'

export class DemoBackend extends EventEmitter implements Backend {
  private state: AppState

  constructor(lang: Settings['language']) {
    super()
    this.state = demoState(lang)
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

  prepareDesktopSwitch(toAccountId: string) {
    return { ok: true, copied: 3, targetEmail: this.state.accounts.find((a) => a.id === toAccountId)?.email }
  }

  async openDesktopApp() {
    return { ok: true }
  }

  listConversations(query?: { search?: string; limit?: number }) {
    const q = query?.search?.trim().toLowerCase()
    const items = demoConversations(this.settings.language)
    return q ? items.filter((c) => c.title.toLowerCase().includes(q) || c.cwd?.toLowerCase().includes(q)) : items
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
