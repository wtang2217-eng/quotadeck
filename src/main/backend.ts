import type { EventEmitter } from 'node:events'
import type {
  ActionResult,
  AppState,
  ContinueRequest,
  ConversationItem,
  ConversationQuery,
  DesktopSwitchOptions,
  DesktopSwitchResult,
  IntegrationStatus,
  MergeStatus,
  ProjectItem,
  Settings,
  SetupOptions,
  SetupStatus,
  StatsQuery,
  UpdateInfo,
  UsageStats
} from '@shared/types'

/**
 * What the IPC layer needs. Implemented by the real Engine and by the demo backend.
 *
 * Events besides 'state': 'login-progress' (LoginProgress), 'setup-progress' (SetupProgress),
 * 'switch-progress' (PendingSwitch) and 'copy-text' (string: put it on the clipboard).
 */
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
  prepareDesktopSwitch(toAccountId: string, opts?: DesktopSwitchOptions): DesktopSwitchResult
  cancelPendingSwitch(): void
  openDesktopApp(): Promise<ActionResult>
  /** claude://code/continue link for a conversation in a desktop list, or undefined. */
  desktopLinkFor(target: { cliSessionId?: string; desktopSessionId?: string }): string | undefined
  listConversations(query?: ConversationQuery): ConversationItem[]
  listProjects(): ProjectItem[]
  setFavorite(cliSessionId: string, favorite: boolean): void
  /** The conversation as Markdown, with a file name (without extension) to suggest. */
  exportMarkdown(cliSessionId: string): Promise<{ markdown: string; fileName: string } | undefined>
  getStats(query: StatsQuery): Promise<UsageStats>
  getSetupStatus(): Promise<SetupStatus>
  /** Starts the run and returns its id; progress arrives as 'setup-progress' events. */
  runSetup(opts: SetupOptions): Promise<string>
  dismissSetup(): void
  checkForUpdates(force: boolean): Promise<UpdateInfo>
  runMergeNow(): MergeStatus
  undoMergeNow(): Promise<MergeStatus>
  installIntegration(opts: { hooks: boolean; statusLine: boolean; replaceStatusLine?: boolean }): IntegrationStatus
  uninstallIntegration(): IntegrationStatus
  updateSettings(patch: Partial<Settings>): Promise<void>
  clearEvents(): void
}
