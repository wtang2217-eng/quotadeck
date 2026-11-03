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
  /** When the account will run out at the recent pace. Only present while it is being used. */
  eta?: UsageEta
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
  /** Ids of your accounts that ran replies in this conversation (last 31 days of usage), most used first. */
  accountIds: string[]
  /** The desktop app's id for it ("local_<uuid>"), when it is in a desktop list. Needed to open it there. */
  desktopSessionId?: string
  /** Starred by the user. */
  favorite: boolean
  sizeBytes: number
}

export interface ConversationQuery {
  /** Matches the title, first and last prompt, and folder. */
  search?: string
  limit?: number
  /** Only conversations whose working folder is this path. */
  cwd?: string
  /** Only conversations this account ran replies in. */
  accountId?: string
  /** "desktop": started in the desktop app; "terminal": everything else. */
  entrypoint?: 'desktop' | 'terminal'
  favoritesOnly?: boolean
}

/** A working folder that has conversations, for the project filter. */
export interface ProjectItem {
  /** Working folder, when a transcript recorded it. */
  cwd?: string
  /** Folder name under ~/.claude/projects. */
  projectDir: string
  /** Last part of the folder path, for display. */
  name: string
  conversations: number
  lastActivityAt: number
}

export interface ExportResult extends ActionResult {
  /** Where the Markdown file was saved. */
  path?: string
  /** The user closed the save dialog. */
  cancelled?: boolean
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
  /** Color for the primary highlight: selection, focus and the account the desktop app is on. */
  accent: AccentChoice
  /** Row height and spacing: comfortable or compact. */
  density: Density
  /** macOS: show the desktop account's 5-hour usage next to the menu bar icon. */
  trayShowPercent: boolean
  /** Accelerator that shows or hides the main window from anywhere, e.g. "CommandOrControl+Shift+Q". Empty = off. */
  globalShortcut: string
  /** Look for a new QuotaDeck release on GitHub at start and every 12 hours. */
  autoCheckUpdates: boolean
}

/** indigo, teal and orange are Radix Colors step 9; graphite is the text color itself. */
export type AccentChoice = 'indigo' | 'teal' | 'orange' | 'graphite'
export type Density = 'comfortable' | 'compact'

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
  /** First start, or nothing set up yet: the UI opens the setup page by itself. */
  needsSetup: boolean
  /** A desktop switch the user started and QuotaDeck is waiting to see finish. */
  pendingSwitch?: PendingSwitch
  /** Result of the last check for a new QuotaDeck version. */
  update?: UpdateInfo
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
  /** The switch QuotaDeck now waits for (absent when the desktop app is already on the target). */
  pending?: PendingSwitch
}

/** What the switch dialog knows when it starts a desktop switch. */
export interface DesktopSwitchOptions {
  fromAccountId?: string
  /** The conversation to continue after signing in. Defaults to the one a limit interrupted. */
  cliSessionId?: string
  title?: string
  cwd?: string
}

export type Page = 'dashboard' | 'stats' | 'conversations' | 'accounts' | 'activity' | 'settings' | 'about' | 'setup'

/** Messages the main process pushes to the renderer besides state updates. */
export type UiCommand =
  | { type: 'navigate'; page: Page }
  | { type: 'open-switch'; fromAccountId?: string; toAccountId?: string; cliSessionId?: string }
  | { type: 'open-add-account' }

// ---------------------------------------------------------------- run-out forecast

export interface UsageEta {
  /** When the 5-hour window reaches 100% at the recent pace. Only set when that is before the window resets. */
  fiveHourFullAt?: number
  /** Same for the weekly window. */
  sevenDayFullAt?: number
  /** Recent pace in percent per hour, for tooltips. */
  fiveHourPerHour?: number
  sevenDayPerHour?: number
  /** "estimate": from the tokens your conversations used and the learned rate; "records": from recorded percentages. */
  basis: 'estimate' | 'records'
  at: number
}

// ---------------------------------------------------------------- desktop switch follow-up

export interface PendingSwitch {
  id: string
  fromAccountId?: string
  toAccountId: string
  /** The conversation to continue once the desktop app is signed in with the target. */
  conversation?: {
    cliSessionId?: string
    /** The desktop app's id ("local_<uuid>"); lets the UI open it directly. */
    desktopSessionId?: string
    title?: string
    cwd?: string
    /** The conversation is in the target account's desktop list. */
    inTargetList?: boolean
  }
  startedAt: number
  /**
   * waiting: QuotaDeck is watching for the sign-in. done: the desktop app is now on the target.
   * wrong-account: it signed in with another account. expired: nothing happened within 30 minutes.
   */
  phase: 'waiting' | 'done' | 'wrong-account' | 'expired'
  finishedAt?: number
  /** Account the desktop app signed in with when it is not the target (undefined when it is not one of yours). */
  actualAccountId?: string
  /** The continue prompt was put on the clipboard. */
  copiedPrompt?: boolean
}

// ---------------------------------------------------------------- one-click setup

export type SetupCheckId = 'desktop-installed' | 'desktop-signed-in' | 'cli' | 'git-bash' | 'main-account' | 'integration' | 'open-at-login'

/** ok: done. fixable: the setup button does it. manual: needs the user (see action/url). missing: not available here. */
export type SetupCheckState = 'ok' | 'fixable' | 'manual' | 'missing'

export type SetupAction =
  | 'install-cli'
  | 'adopt-main'
  | 'add-account'
  | 'connect'
  | 'open-at-login'
  | 'download-desktop'
  | 'open-desktop'
  | 'download-git'

export interface SetupCheck {
  id: SetupCheckId
  state: SetupCheckState
  /** Localized title, e.g. "Claude Code 命令行". */
  title: string
  /** Localized explanation of the current state and of what the fix does. */
  detail: string
  /** QuotaDeck's main features work without it. */
  optional: boolean
  /** What fixes it: done by runSetup when "fixable", a button for the user when "manual". */
  action?: SetupAction
  /** Page to open for a manual step (downloads). */
  url?: string
}

export interface SetupStatus {
  checks: SetupCheck[]
  /** Every required check is ok. */
  ready: boolean
  /** Same as AppState.needsSetup. */
  needsSetup: boolean
  /** A runSetup is in progress. */
  running: boolean
}

export interface SetupOptions {
  /** Install Claude Code with the official installer when it is missing. */
  installCli: boolean
  /** Add the hooks and status line to ~/.claude/settings.json. */
  connectIntegration: boolean
  /** Start QuotaDeck when you sign in to the computer. */
  openAtLogin: boolean
}

export interface SetupProgress {
  runId: string
  /** The step this message is about; absent on the final message. */
  step?: SetupCheckId
  phase: 'running' | 'ok' | 'failed' | 'skipped' | 'done'
  /** Localized status text, or one line of installer output. */
  message?: string
  /** Set on the final message ("done"). */
  ok?: boolean
  status?: SetupStatus
}

// ---------------------------------------------------------------- usage ledger and statistics
// QuotaDeck keeps its own ledger of every request (~/.quotadeck/ledger), so the history outlives Claude Code's
// clean-up of old transcripts. Costs are what the tokens would cost at API list prices; subscriptions are not billed
// that way, and the UI says so.

/** "today" is the current calendar day; "all" is everything in the ledger. */
export type StatsRange = 'today' | '7d' | '30d' | '90d' | 'all'

export interface StatsQuery {
  range: StatsRange
  /** "all" (the default), one account id, "org:<uuid>" for one organization row, or "" for the usage of unknown accounts. */
  accountId?: string
}

export interface TokenTotals {
  input: number
  output: number
  /** Cache writes that live 5 minutes (1.25x the input price). */
  cacheWrite5m: number
  /** Cache writes that live 1 hour (2x the input price). */
  cacheWrite1h: number
  cacheRead: number
}

/** List prices in US dollars per million tokens. */
export interface ModelPrice {
  /** e.g. "Opus 5.5". */
  model: string
  input: number
  output: number
  /** When the list gives one; otherwise 0.1x input. Cache writes are always 1.25x (5 min) and 2x (1 h) input. */
  cacheRead?: number
  /** Higher prices for prompts over `above` tokens. */
  longContext?: { above: number; input: number; output: number }
  /** Fast mode prices; the cache multipliers apply to them. */
  fast?: { input: number; output: number }
}

export interface StatsDay {
  /** YYYY-MM-DD in the chosen time zone. */
  day: string
  tokens: TokenTotals
  costUsd: number
  requests: number
  /** Cost-weighted usage units (what the live estimate counts). */
  units: number
  /** US dollars per account id ("" = not attributed to any of your accounts). */
  byAccount: Record<string, number>
}

/** One hour of the current day, for range "today". */
export interface StatsHour {
  /** 0-23 in the chosen time zone. */
  hour: number
  tokens: TokenTotals
  costUsd: number
  requests: number
}

export type ModelFamily = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'

export interface StatsModel {
  /** A model id seen in the transcripts, e.g. "claude-opus-5-5". */
  model: string
  /** e.g. "Opus 5.5"; ids of the same model are combined under one label. */
  label: string
  family: ModelFamily
  tokens: TokenTotals
  costUsd: number
  requests: number
  units: number
  /** The price the costs were computed with. */
  price: ModelPrice
}

export interface StatsProject {
  cwd?: string
  projectDir: string
  name: string
  tokens: TokenTotals
  costUsd: number
  requests: number
  units: number
  conversations: number
}

export interface StatsConversation {
  cliSessionId: string
  title: string
  cwd?: string
  /** Account that ran most of it. */
  accountId?: string
  tokens: TokenTotals
  costUsd: number
  requests: number
  units: number
  lastActivityAt: number
}

export interface StatsAccount {
  /**
   * An account id (kind "account"); "org:<uuid>" for usage of an organization that is not in the panel, such as an
   * account you no longer use (kind "org"); "" for usage whose account cannot be told (kind "unknown").
   */
  accountId: string
  kind: 'account' | 'org' | 'unknown'
  /** For kind "org": the organization, to rename it with setOrgLabel. */
  orgUuid?: string
  /**
   * Nickname or email (kept in the ledger, so removed accounts still have a name). For an organization, the name
   * the user gave it, else "旧号" / "Old account", numbered "旧号 2", "旧号 3" … when there are several. "其他" / "Other"
   * for kind "unknown".
   */
  label: string
  email?: string
  tokens: TokenTotals
  costUsd: number
  requests: number
  units: number
  conversations: number
}

export interface UsageStats {
  range: StatsRange
  /** The account the numbers are for, or "all". */
  accountId: string
  /** Start of the first day, and the time the numbers were computed. */
  from: number
  to: number
  /** Time zone the days, hours and heatmap use. */
  timeZone: string
  /** First day in the ledger (YYYY-MM-DD), if it has anything. */
  firstDay?: string
  /** `webSearches`: server-side web searches made by the requests ($0.01 each, included in costUsd). */
  totals: { tokens: TokenTotals; costUsd: number; requests: number; conversations: number; units: number; activeDays: number; webSearches: number }
  /** Independent of the range (same account filter): today so far, this calendar month, everything recorded. */
  fixed: { todayUsd: number; monthUsd: number; allTimeUsd: number }
  /** Every day of the range, oldest first, including empty days. */
  days: StatsDay[]
  /** Only for range "today": its 24 hours. */
  hours?: StatsHour[]
  /** Most used first. */
  models: StatsModel[]
  /** Most used first, at most 12. */
  projects: StatsProject[]
  /** heatmap[weekday][hour] = US dollars; weekday 0 = Monday. */
  heatmap: number[][]
  /** Most used first, at most 10. */
  topConversations: StatsConversation[]
  /** Every account with usage in the range, most used first (just the one account when filtered). */
  byAccount: StatsAccount[]
  pricing: {
    /** Date the official price page was read, YYYY-MM-DD. */
    asOf: string
    /** The official price page (link it next to the note). */
    source: string
    currency: 'USD'
    /**
     * "按 API 标价折算（官方价格页，2026-11-03），仅供参考，订阅不按这个扣费", in the UI language, with the date.
     * Show it wherever a dollar amount is shown.
     */
    note: string
    /** Price of one server-side web search, and the multiplier for US-only inference (Claude 4.6 and later). */
    webSearchUsd: number
    usOnlyMultiplier: number
  }
  /** Transcripts are still being read for the first time; numbers will grow. */
  partial: boolean
  computedAt: number
}

// ---------------------------------------------------------------- updates

export interface UpdateInfo {
  current: string
  /** Newest release on GitHub, without the "v". */
  latest?: string
  available: boolean
  /** Release page. */
  url?: string
  notes?: string
  publishedAt?: number
  checkedAt?: number
}
