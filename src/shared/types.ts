// Data shapes shared by the main process, the preload bridge and the renderer.
// Times are epoch milliseconds unless a field name says otherwise.

export type PlanKind = 'free' | 'pro' | 'max5x' | 'max20x' | 'ultra' | 'team' | 'enterprise' | 'unknown'

export interface PlanInfo {
  kind: PlanKind
  /** Human label such as "Max 5x" or "Pro". */
  label: string
  /** Usage multiplier relative to Pro, when the plan has one (Pro = 1, Max 5x = 5, Max 20x = 20). */
  multiplier?: number
  /** Raw billing channel reported by Claude Code, e.g. "stripe_subscription" or "apple_subscription". */
  billing?: string
  /** Whether "extra usage" (pay as you go after the limit) is switched on for the account. */
  extraUsage?: boolean
}

export interface UsageWindow {
  /** 0-100. */
  pct: number
  /** When this window resets, if known. */
  resetsAt?: number
}

export type UsageSource = 'desktop' | 'terminal' | 'limit-event' | 'demo'

export interface UsageSnapshot {
  /** When the numbers were observed. */
  at: number
  source: UsageSource
  /** The rolling 5-hour "session" window. */
  fiveHour?: UsageWindow
  /** The 7-day "weekly" window. */
  sevenDay?: UsageWindow
}

/** One point of usage history, used for sparklines. fh = 5-hour %, sd = 7-day %. */
export interface UsagePoint {
  t: number
  fh?: number
  sd?: number
}

export type LimitKind = 'session' | 'weekly' | 'unknown'

export interface LimitInfo {
  kind: LimitKind
  /** When the limit was hit. */
  at: number
  /** When it lifts, if known. */
  resetsAt?: number
  /** The original message from Claude Code, e.g. "You've hit your session limit · resets 11:10pm (America/Chicago)". */
  message?: string
}

export interface Account {
  /** Stable id. Equals accountUuid once it is known. */
  id: string
  accountUuid?: string
  orgUuid?: string
  email?: string
  displayName?: string
  /** User-chosen short name shown instead of the email. */
  nickname?: string
  /** Hex color used for the account's avatar and chart lines. */
  color: string
  plan?: PlanInfo
  /** CLAUDE_CONFIG_DIR used when this account runs in a terminal. */
  cliConfigDir?: string
  /** True when cliConfigDir is the default ~/.claude, so no environment variable is needed. */
  usesDefaultCliDir?: boolean
  /** Result of the last `claude auth status` for cliConfigDir. Undefined = not checked yet. */
  cliLoggedIn?: boolean
  addedAt: number
}

/**
 * A live estimate between two real records. The desktop app records usage about every 15 minutes; QuotaDeck adds
 * the tokens your conversations used since then (from the local transcripts), converted with a rate learned from
 * this account's own history (or scaled from another account by plan size). Always shown as approximate.
 */
export interface UsageEstimate {
  at: number
  /** Estimated 5-hour usage, 0-100. */
  fiveHour?: number
  /** Estimated weekly usage, 0-100. */
  sevenDay?: number
  /** Estimated reset of the 5-hour window (it starts with your first message). */
  fiveHourResetsAt?: number
  /** Where the conversion rate came from. */
  basis: 'own-history' | 'plan-ratio'
  /** The real record the estimate builds on. */
  fromRecordAt?: number
}

export type AccountStatus = 'ok' | 'warn' | 'limited' | 'unknown' | 'needs-login'

export interface AccountView extends Account {
  usage?: UsageSnapshot
  /** Present when the account was used since its last real record. */
  estimate?: UsageEstimate
  /** Up to 7 days of history, oldest first. */
  history: UsagePoint[]
  /** Set while the account is blocked by a limit that has not reset yet. */
  limit?: LimitInfo
  /** The Claude desktop app is currently signed in with this account. */
  isDesktopCurrent: boolean
  /** Conversations in this account's desktop list. */
  desktopSessionCount: number
  status: AccountStatus
}

export interface DesktopInfo {
  /** A Claude desktop data folder was found on this computer. */
  found: boolean
  dataDir?: string
  /** Account the desktop app is (most likely) signed in with right now. */
  currentAccountUuid?: string
  currentOrgUuid?: string
  /** How the current account was determined and when. */
  currentSince?: number
  /** Account folders that exist in the desktop session store (may include accounts that are not yours). */
  knownAccountUuids: string[]
  running: boolean
}

export interface ConversationItem {
  /** The Claude Code session id (the transcript file name). Used with `claude --resume`. */
  cliSessionId: string
  /** Desktop title when known, otherwise the first prompt. */
  title: string
  firstPrompt?: string
  cwd?: string
  /** Folder under ~/.claude/projects that holds the transcript. */
  projectDir: string
  lastActivityAt: number
  createdAt?: number
  /** Number of transcript lines, a rough size indicator. */
  lines: number
  /** Where it was started: "cli", "claude-desktop", "sdk-ts", ... */
  entrypoint?: string
  /** Ids of your accounts whose desktop list contains this conversation. */
  desktopAccountIds: string[]
  sizeBytes: number
}

export type ActivityType =
  | 'limit-hit'
  | 'threshold'
  | 'reset'
  | 'switch'
  | 'merge'
  | 'login'
  | 'integration'
  | 'error'
  | 'info'

export interface ActivityEvent {
  id: string
  at: number
  type: ActivityType
  accountId?: string
  /** Already localized for the current language when produced by the main process. */
  title: string
  detail?: string
  /** Conversation the event is about, so the UI can offer to continue it. */
  cliSessionId?: string
  cwd?: string
}

export interface MergeStatus {
  enabled: boolean
  lastRunAt?: number
  /** Files copied in the last run. */
  lastCopied: number
  /** Files copied since the feature was first used. */
  totalCopied: number
  backupsDir?: string
  error?: string
  /** Number of your accounts that have both an account and an organization id, which merging needs. */
  eligibleAccounts: number
}

export interface IntegrationStatus {
  /** The StopFailure hook (limit detection for desktop and terminal sessions) is in ~/.claude/settings.json. */
  hooksInstalled: boolean
  /** Our status line (live usage for terminal sessions) is in ~/.claude/settings.json. */
  statusLineInstalled: boolean
  /** An existing status line command that is not ours; installing ours would replace it. */
  statusLineConflict?: string
  serverPort: number
  serverRunning: boolean
  settingsPath: string
}

export type ThemeSetting = 'system' | 'light' | 'dark'
export type Language = 'zh-CN' | 'en'
export type TerminalChoice = 'auto' | 'wt' | 'powershell' | 'terminal-app' | 'iterm' | 'gnome-terminal' | 'x-terminal-emulator'

export interface Settings {
  language: Language
  theme: ThemeSetting
  /** "system" or an IANA zone such as "Asia/Shanghai", used for every time shown. */
  timezone: string
  /** Percent at which an account is shown as "running low" and a notification is sent. */
  warnAt: number
  /** Percent at which a second, more urgent notification is sent. */
  criticalAt: number
  notifyOnLimit: boolean
  notifyOnThreshold: boolean
  notifyOnReset: boolean
  /** Keep the desktop conversation lists of your accounts merged. */
  autoMergeDesktop: boolean
  /** Prompt sent after resuming a conversation with another account. Empty = send nothing. */
  continuePrompt: string
  openAtLogin: boolean
  /** Start in the tray without opening the window. */
  startHidden: boolean
  serverPort: number
  terminal: TerminalChoice
  /** Use this desktop data folder instead of the detected one. */
  desktopDataDirOverride?: string
  /** The user confirmed that every account they add is their own. */
  acceptedOwnershipNotice: boolean
  /** Play short sounds on clicks, toggles and alerts. */
  soundEnabled: boolean
  /** Sound volume, 0-1. */
  soundVolume: number
}

export interface CliInfo {
  found: boolean
  path?: string
  version?: string
}

export interface AppState {
  appVersion: string
  platform: string
  demo: boolean
  accounts: AccountView[]
  /** Best account to switch to right now (most remaining usage, not limited). */
  recommendedAccountId?: string
  /** The default ~/.claude login, when it is not one of your accounts yet. Offered as a one-click add. */
  defaultCliCandidate?: { email?: string; plan?: PlanInfo; accountUuid?: string }
  desktop: DesktopInfo
  merge: MergeStatus
  integration: IntegrationStatus
  settings: Settings
  cli: CliInfo
  /** Newest first, at most 300. */
  events: ActivityEvent[]
  /** The most recent conversation that was interrupted by a limit, used by the switch dialog. */
  lastInterrupted?: { accountId?: string; cliSessionId?: string; cwd?: string; title?: string; at: number }
}

export type LoginPhase = 'starting' | 'waiting-browser' | 'verifying' | 'done' | 'failed' | 'cancelled'

export interface LoginProgress {
  loginId: string
  phase: LoginPhase
  /** Official sign-in URL printed by Claude Code, in case the browser did not open by itself. */
  url?: string
  /** Last line of output from `claude auth login`, or an error. */
  message?: string
  /** Set when phase is "done". */
  accountId?: string
  /** True when the account was already in the list. */
  duplicate?: boolean
}

export interface ContinueRequest {
  accountId: string
  /** Conversation to resume. Omit to start a new conversation. */
  cliSessionId?: string
  cwd?: string
  /** Send Settings.continuePrompt after resuming. */
  sendPrompt?: boolean
}

export interface ActionResult {
  ok: boolean
  error?: string
}

export interface DesktopSwitchResult extends ActionResult {
  /** Conversations copied into the target account's desktop list. */
  copied: number
  /** Email of the target account, for the sign-in instructions. */
  targetEmail?: string
}

export type Page = 'dashboard' | 'conversations' | 'activity' | 'settings' | 'about'

/** Messages the main process pushes to the renderer besides state updates. */
export type UiCommand =
  | { type: 'navigate'; page: Page }
  | { type: 'open-switch'; fromAccountId?: string; toAccountId?: string }
  | { type: 'open-add-account' }
