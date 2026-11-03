import type { EventEmitter } from 'node:events'
import type {
  ActionResult,
  AppState,
  ContinueRequest,
  ConversationItem,
  DesktopSwitchResult,
  IntegrationStatus,
  MergeStatus,
  Settings
} from '@shared/types'

/** What the IPC layer needs. Implemented by the real Engine and by the demo backend. */
export interface Backend extends EventEmitter {
  readonly settings: Settings
  start(): Promise<void>
  stop(): Promise<void>
  getState(): AppState
  refresh(): AppState
  adoptDefaultCli(): Promise<void>
  startLogin(email: string | undefined, reloginAccountId?: string): Promise<string>
  cancelLogin(loginId: string): Promise<void>
  updateAccount(id: string, patch: { nickname?: string; color?: string }): void
  removeAccount(id: string, trashProfile: boolean): Promise<void>
  continueInTerminal(req: ContinueRequest): Promise<ActionResult>
  prepareDesktopSwitch(toAccountId: string): DesktopSwitchResult
  openDesktopApp(): Promise<ActionResult>
  listConversations(query?: { search?: string; limit?: number }): ConversationItem[]
  runMergeNow(): MergeStatus
  undoMergeNow(): Promise<MergeStatus>
  installIntegration(opts: { hooks: boolean; statusLine: boolean; replaceStatusLine?: boolean }): IntegrationStatus
  uninstallIntegration(): IntegrationStatus
  updateSettings(patch: Partial<Settings>): Promise<void>
  clearEvents(): void
}
