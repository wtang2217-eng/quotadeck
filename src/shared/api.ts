// The API the preload script exposes to the renderer as `window.qd`.
// Every method is a thin wrapper over one IPC channel in src/main/ipc.ts.

import type {
  ActionResult,
  AppState,
  ContinueRequest,
  ConversationItem,
  ConversationQuery,
  DesktopSwitchOptions,
  DesktopSwitchResult,
  ExportResult,
  IntegrationStatus,
  LoginProgress,
  MergeStatus,
  PendingSwitch,
  ProjectItem,
  Settings,
  SetupOptions,
  SetupProgress,
  SetupStatus,
  StatsQuery,
  UiCommand,
  UpdateInfo,
  UsageStats
} from './types'

export interface QuotaDeckApi {
  /** Current state. Cheap: served from memory. */
  getState(): Promise<AppState>
  /** Re-read every source (desktop files, Claude Code config, login status) and return the result. */
  refresh(): Promise<AppState>
  /** Subscribe to state pushes. Returns an unsubscribe function. */
  onState(cb: (state: AppState) => void): () => void
  /** Subscribe to UI commands from the tray, notifications or screenshot mode. */
  onCommand(cb: (cmd: UiCommand) => void): () => void

  // Accounts
  /** Add the account that is already signed in at ~/.claude (AppState.defaultCliCandidate). */
  adoptDefaultCli(): Promise<AppState>
  /** Create a new profile folder and run the official `claude auth login` in it. Progress arrives via onLoginProgress. */
  startLogin(opts: { email?: string }): Promise<{ loginId: string }>
  /** Run the official login again for an existing account whose sign-in expired. */
  reLogin(accountId: string): Promise<{ loginId: string }>
  cancelLogin(loginId: string): Promise<void>
  onLoginProgress(cb: (p: LoginProgress) => void): () => void
  updateAccount(accountId: string, patch: { nickname?: string; color?: string }): Promise<AppState>
  /** Remove from the list. trashProfile moves the account's profile folder to the recycle bin (never the default ~/.claude). */
  removeAccount(accountId: string, opts: { trashProfile: boolean }): Promise<AppState>

  // Switching and continuing
  /** Open a terminal window signed in as the account, resuming the conversation when one is given. */
  continueInTerminal(req: ContinueRequest): Promise<ActionResult>
  /**
   * Copy your conversations into the target account's desktop list so they are there after you sign in with it,
   * then watch for the sign-in (AppState.pendingSwitch, onSwitchProgress). When it happens, the continue prompt is
   * put on the clipboard and a notification says where the conversation is.
   */
  prepareDesktopSwitch(toAccountId: string, opts?: DesktopSwitchOptions): Promise<DesktopSwitchResult>
  /** Stop waiting for the desktop sign-in, or dismiss a finished switch. */
  cancelPendingSwitch(): Promise<AppState>
  /** Fires when the pending switch changes phase (done, wrong-account, expired). */
  onSwitchProgress(cb: (p: PendingSwitch) => void): () => void
  /** Bring the Claude desktop app to the front (or start it). */
  openDesktopApp(): Promise<ActionResult>
  /** Open one conversation in the desktop app (claude://code/continue). Needs ConversationItem.desktopSessionId. */
  openInDesktop(target: { cliSessionId?: string; desktopSessionId?: string }): Promise<ActionResult>

  // Conversations
  listConversations(query?: ConversationQuery): Promise<ConversationItem[]>
  /** Working folders that have conversations, newest first. */
  listProjects(): Promise<ProjectItem[]>
  setFavorite(cliSessionId: string, favorite: boolean): Promise<void>
  /** Ask where to save, then write the conversation as Markdown. */
  exportConversation(cliSessionId: string): Promise<ExportResult>

  // Usage statistics (from the local transcripts)
  getStats(query: StatsQuery): Promise<UsageStats>

  // One-click setup
  getSetupStatus(): Promise<SetupStatus>
  /** Do every fixable step in order. Progress and the final status arrive via onSetupProgress. */
  runSetup(opts: SetupOptions): Promise<{ runId: string }>
  onSetupProgress(cb: (p: SetupProgress) => void): () => void
  /** The user closed the setup page: do not open it by itself again. */
  dismissSetup(): Promise<AppState>

  // Updates
  /** Check GitHub for a newer release now. */
  checkForUpdates(): Promise<UpdateInfo>

  // Desktop merge
  runMergeNow(): Promise<MergeStatus>
  /** Move the conversation copies QuotaDeck made (and that were not changed since) to the recycle bin. */
  undoMerge(): Promise<MergeStatus>

  // Claude Code integration (hooks + status line in ~/.claude/settings.json)
  installIntegration(opts: { hooks: boolean; statusLine: boolean; replaceStatusLine?: boolean }): Promise<IntegrationStatus>
  uninstallIntegration(): Promise<IntegrationStatus>

  // Settings and misc
  updateSettings(patch: Partial<Settings>): Promise<AppState>
  clearEvents(): Promise<AppState>
  openPath(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
}

/** IPC channel names. Kept in one place so main and preload cannot drift apart. */
export const IPC = {
  getState: 'qd:get-state',
  refresh: 'qd:refresh',
  state: 'qd:state',
  command: 'qd:command',
  adoptDefaultCli: 'qd:adopt-default-cli',
  startLogin: 'qd:start-login',
  reLogin: 'qd:re-login',
  cancelLogin: 'qd:cancel-login',
  loginProgress: 'qd:login-progress',
  updateAccount: 'qd:update-account',
  removeAccount: 'qd:remove-account',
  continueInTerminal: 'qd:continue-in-terminal',
  prepareDesktopSwitch: 'qd:prepare-desktop-switch',
  cancelPendingSwitch: 'qd:cancel-pending-switch',
  switchProgress: 'qd:switch-progress',
  openDesktopApp: 'qd:open-desktop-app',
  openInDesktop: 'qd:open-in-desktop',
  listConversations: 'qd:list-conversations',
  listProjects: 'qd:list-projects',
  setFavorite: 'qd:set-favorite',
  exportConversation: 'qd:export-conversation',
  getStats: 'qd:get-stats',
  getSetupStatus: 'qd:get-setup-status',
  runSetup: 'qd:run-setup',
  setupProgress: 'qd:setup-progress',
  dismissSetup: 'qd:dismiss-setup',
  checkForUpdates: 'qd:check-for-updates',
  runMergeNow: 'qd:run-merge-now',
  undoMerge: 'qd:undo-merge',
  installIntegration: 'qd:install-integration',
  uninstallIntegration: 'qd:uninstall-integration',
  updateSettings: 'qd:update-settings',
  clearEvents: 'qd:clear-events',
  openPath: 'qd:open-path',
  openExternal: 'qd:open-external',
  copyText: 'qd:copy-text'
} as const
