// The API the preload script exposes to the renderer as `window.qd`.
// Every method is a thin wrapper over one IPC channel in src/main/ipc.ts.

import type {
  ActionResult,
  AppState,
  ContinueRequest,
  ConversationItem,
  DesktopSwitchResult,
  IntegrationStatus,
  LoginProgress,
  MergeStatus,
  Settings,
  UiCommand
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
  /** Copy your conversations into the target account's desktop list so they are there after you sign in with it. */
  prepareDesktopSwitch(toAccountId: string): Promise<DesktopSwitchResult>
  /** Bring the Claude desktop app to the front (or start it). */
  openDesktopApp(): Promise<ActionResult>

  // Conversations
  listConversations(query?: { search?: string; limit?: number }): Promise<ConversationItem[]>

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
  /** Show the main window and run a UI command there (used by the tray popover; optional so the browser mock can omit it). */
  runCommand?(cmd: UiCommand): Promise<void>
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
  openDesktopApp: 'qd:open-desktop-app',
  listConversations: 'qd:list-conversations',
  runMergeNow: 'qd:run-merge-now',
  undoMerge: 'qd:undo-merge',
  installIntegration: 'qd:install-integration',
  uninstallIntegration: 'qd:uninstall-integration',
  updateSettings: 'qd:update-settings',
  clearEvents: 'qd:clear-events',
  openPath: 'qd:open-path',
  openExternal: 'qd:open-external',
  copyText: 'qd:copy-text',
  runCommand: 'qd:run-command'
} as const
