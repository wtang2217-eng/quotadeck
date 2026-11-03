// The orchestrator: keeps the account list, merges usage from every source, decides when to notify,
// and carries out the actions the UI asks for. It has no Electron dependency so it can be tested in Node.

import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type http from 'node:http'
import { DEFAULT_CONTINUE_PROMPT } from '@shared/defaults'
import { DEFAULT_COLORS, accountName, formatClock, peakPct, resolveTimeZone } from '@shared/format'
import type {
  Account,
  AccountView,
  ActionResult,
  ActivityEvent,
  ActivityType,
  AppState,
  CliInfo,
  ContinueRequest,
  ConversationItem,
  ConversationQuery,
  DesktopInfo,
  DesktopSwitchOptions,
  DesktopSwitchResult,
  IntegrationStatus,
  LimitInfo,
  LoginProgress,
  MergeStatus,
  Page,
  PendingSwitch,
  ProjectItem,
  Settings,
  SetupCheckId,
  SetupOptions,
  SetupProgress,
  SetupStatus,
  StatsQuery,
  UpdateInfo,
  UsageEstimate,
  UsagePoint,
  UsageSnapshot,
  UsageStats
} from '@shared/types'
import { tr, windowName } from '../i18n'
import { authStatus, envForConfigDir, extractUrl, findClaude, mainOauthAccount, readOauthAccount, startOfficialLogin, type LoginHandle } from './claudeCli'
import { accountFolder, findDesktopDataDir, isDesktopRunning, listAccountFolders, readSessions, readUsageSamples, sessionFileNames, type AccountFolder, type UsageSample } from './desktop'
import { computeEta } from './eta'
import { attribute, estimateUsage, UsageScanner, type UsageBucket } from './estimate'
import { safeFileName, transcriptToMarkdown } from './exportMd'
import { listTranscripts, saveHistoryCache, type TranscriptMeta } from './history'
import { entriesFrom, Ledger, type LedgerEntry } from './ledger'
import * as integration from './integration'
import { launchInTerminal } from './launcher'
import { isUsageLimitMessage, parseLimitMessage } from './limits'
import { mergeDesktopSessions, undoMerge } from './merge'
import { exists, HOME, isInside, mainClaudeDir, mtime, normalize, qdPaths, samePath } from './paths'
import { planFrom, planWeight } from './plan'
import { createProfile, newProfileDir, repairLinks } from './profiles'
import { startServer, type RunningServer } from './server'
import { buildChecks, desktopAppInstalled, installClaudeCode, isReady, type CommandRunner } from './setup'
import { computeStats, ledgerCsv, type AccountLabel } from './stats'
import { renderStatusLine } from './statusline'
import { loadState, saveStateNow, saveStateSoon, type PersistedState } from './store'
import { compareVersions, fetchLatestRelease } from './updates'
import { PRICE_LIST_DATE } from './pricing'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export interface Notice {
  kind: 'limit' | 'threshold' | 'reset' | 'info' | 'error'
  title: string
  body?: string
  /** What clicking the notification should open. */
  action?: { type: 'open-switch'; fromAccountId?: string; toAccountId?: string; cliSessionId?: string } | { type: 'navigate'; page: Page }
}

export interface EngineOptions {
  appVersion: string
  locale: string
  /** Show a desktop notification. */
  notify: (n: Notice) => void
  /** Move a file or folder to the recycle bin. */
  trash: (p: string) => Promise<void>
  /** Bring the Claude desktop app forward. */
  openDesktop: () => Promise<boolean>
  /** Runs the official Claude Code installer; replaced in tests. */
  runCommand?: CommandRunner
  /** Looks up the latest release; replaced in tests. */
  fetchRelease?: typeof fetchLatestRelease
}

const PENDING_SWITCH_WAIT = 30 * MIN
const PENDING_SWITCH_SHOW = 10 * MIN
const UPDATE_EVERY = 12 * HOUR

interface LoginJob {
  id: string
  handle?: LoginHandle
  dir: string
  newProfile: boolean
  reloginAccountId?: string
  cancelled: boolean
}

export class Engine extends EventEmitter {
  readonly s: PersistedState
  private cli: CliInfo = { found: false }
  private server?: RunningServer
  private desktopDir?: string
  private samples: UsageSample[] = []
  private folders: AccountFolder[] = []
  private desktopCurrent: { accountUuid?: string; orgUuid?: string; since?: number } = {}
  private desktopRunning = false
  private watchMtimes = new Map<string, number>()
  private timers: NodeJS.Timeout[] = []
  private logins = new Map<string, LoginJob>()
  private lastMergeAt = 0
  private emitTimer?: NodeJS.Timeout
  private view?: AppState
  private scanner = new UsageScanner()
  /** Every request ever seen, per hour, account, conversation and model (~/.quotadeck/ledger). */
  private ledger = new Ledger()
  /** Requests rebuilt from transcripts, and kept as they were, when an older ledger was upgraded. */
  lastRebuild?: { rebuilt: number; kept: number; at: number }
  private estimates = new Map<string, UsageEstimate>()
  /** Percent per unit each account's estimate uses, and its replies of the last hours (for the forecast). */
  private rates = new Map<string, { fh?: number; sd?: number }>()
  private recentEvents = new Map<string, Array<{ t: number; u: number }>>()
  private statsCache = new Map<string, { at: number; revision: number; value: UsageStats }>()
  private setupRunning = false
  private updateChecking?: Promise<UpdateInfo>

  constructor(private readonly opts: EngineOptions) {
    super()
    this.s = loadState(opts.locale)
  }

  get settings(): Settings {
    return this.s.settings
  }

  private t = (key: Parameters<typeof tr>[1], vars?: Record<string, string | number>) => tr(this.settings.language, key, vars)

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    fs.mkdirSync(qdPaths().root, { recursive: true })
    this.cli = await findClaude()
    this.readDesktop()
    await this.startServer()
    this.refreshIntegrationIfStale()
    for (const a of this.s.accounts) if (a.cliConfigDir && !a.usesDefaultCliDir && exists(a.cliConfigDir)) repairLinks(a.cliConfigDir)
    this.evaluate(true)
    this.emitState()
    void this.refreshEstimates()
    this.timers.push(setInterval(() => this.poll(), 15_000))
    this.timers.push(setInterval(() => this.evaluate(false), 30_000))
    void this.checkLogins(false)
    // The first update check waits a little so it never slows the start.
    const first = setTimeout(() => void this.checkForUpdates(false), 20_000)
    first.unref?.()
    this.timers.push(first)
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    for (const job of this.logins.values()) job.handle?.child.kill()
    await this.server?.close()
    saveHistoryCache()
    this.scanner.save()
    this.ledger.save(true)
    saveStateNow(this.s)
  }

  private async startServer(): Promise<void> {
    try {
      this.server = await startServer(this.settings.serverPort, this.s.integration.key, {
        statusline: (body) => this.onStatusline(body),
        stopFailure: (body, headers) => this.onStopFailure(body, headers),
        sessionStart: (headers) => this.onSessionStart(headers)
      })
      if (this.server.port !== this.settings.serverPort) {
        this.s.settings.serverPort = this.server.port
        saveStateSoon(this.s)
      }
    } catch (e) {
      this.server = undefined
      this.addEvent('error', this.t('error'), `local server: ${(e as Error).message}`)
    }
  }

  private refreshIntegrationIfStale(): void {
    try {
      const cfg = this.integrationConfig()
      const p = integration.probe(cfg)
      if (p.stale) integration.install(cfg, { hooks: p.hooksInstalled, statusLine: p.statusLineInstalled })
    } catch {
      /* reported when the user opens the integration settings */
    }
  }

  /** Cheap periodic check of the files that matter; re-read only what changed. */
  private poll(): void {
    const dir = this.desktopDir
    const watched = [dir && path.join(dir, 'plan-usage-history.json'), dir && path.join(dir, 'claude-code-sessions'), path.join(HOME, '.claude.json')]
    for (const a of this.s.accounts) if (a.cliConfigDir) watched.push(path.join(a.cliConfigDir, '.claude.json'))
    let changed = false
    for (const f of watched) {
      if (!f) continue
      const m = mtime(f)
      if (this.watchMtimes.get(f) !== m) {
        this.watchMtimes.set(f, m)
        changed = true
      }
    }
    const running = dir ? isDesktopRunning(dir) : false
    if (running !== this.desktopRunning) changed = true
    if (changed) {
      this.readDesktop()
      this.syncProfilesFromConfig()
      this.evaluate(false)
      this.emitState()
    }
    if (this.settings.autoMergeDesktop && Date.now() - this.lastMergeAt > 2 * MIN) this.runMerge(false)
    if (Date.now() - (this.s.lastLoginCheckAt ?? 0) > DAY) void this.checkLogins(false)
    this.checkPendingSwitch()
    if (Date.now() - (this.s.update?.checkedAt ?? 0) > UPDATE_EVERY) void this.checkForUpdates(false)
    void this.refreshEstimates()
  }

  /** Organization the desktop app was signed in with at a time (its last usage sample before then). */
  private orgAt = (t: number): string | undefined => {
    const s = this.samples
    let lo = 0
    let hi = s.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (s[mid].t <= t) {
        idx = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return idx >= 0 ? s[idx].org : undefined
  }

  private estimating?: Promise<void>

  /** Read new replies from the transcripts and recompute the live estimates. Callers share a run in progress. */
  private refreshEstimates(): Promise<void> {
    this.estimating ??= this.computeEstimates().finally(() => {
      this.estimating = undefined
    })
    return this.estimating
  }

  private async computeEstimates(): Promise<void> {
    try {
      // The first scan reads the whole history so the ledger starts complete; buckets that age out go to it. A ledger
      // written before price tiers existed is rebuilt from that read wherever the transcripts still exist.
      const rebuilding = this.ledger.needsRebuild && !this.scanner.complete
      const rows = (bs: Iterable<UsageBucket>) => entriesFrom(this.withOrgs(bs), this.bucketAccounts())
      const result = { rebuilt: 0, kept: 0 }
      const absorb = (r: { rebuilt: number; kept: number }) => {
        result.rebuilt += r.rebuilt
        result.kept += r.kept
      }
      await this.scanner.scan(Date.now(), {
        orgAt: this.orgAt,
        deep: true,
        onDrop: (old) => (rebuilding ? absorb(this.ledger.rebuild(rows(old))) : this.ledger.sync(rows(old), Date.now(), false))
      })
      if (this.scanner.complete) {
        if (rebuilding) {
          absorb(this.ledger.rebuild(rows(Object.values(this.scanner.buckets))))
          this.ledger.markRebuilt()
          this.lastRebuild = { ...result, at: Date.now() }
        }
        this.syncLedger()
      }
      const desktopSessions = this.desktopSessionIds()
      const orgToAccount = new Map<string, string>()
      for (const a of this.s.accounts) if (a.orgUuid) orgToAccount.set(a.orgUuid, a.id)
      const events = attribute(this.scanner.events, {
        samples: this.samples,
        sessionAccounts: this.s.sessionAccounts,
        desktopSessions,
        defaultCliAccountId: this.s.accounts.find((a) => a.usesDefaultCliDir)?.id,
        orgToAccount
      })
      const now = Date.now()
      const rates = new Map<string, { fh?: number; sd?: number }>()
      const next = estimateUsage(
        this.s.accounts.map((a) => ({ id: a.id, orgUuid: a.orgUuid, weight: planWeight(a.plan) })),
        this.samples,
        events,
        now,
        rates
      )
      const recent = new Map<string, Array<{ t: number; u: number }>>()
      for (const e of events) {
        if (!e.account || e.t < now - 3 * HOUR) continue
        const list = recent.get(e.account) ?? []
        list.push({ t: e.t, u: e.u })
        recent.set(e.account, list)
      }
      this.rates = rates
      this.recentEvents = recent
      const same = next.size === this.estimates.size && [...next].every(([k, v]) => {
        const o = this.estimates.get(k)
        return o && o.fiveHour === v.fiveHour && o.sevenDay === v.sevenDay && o.fiveHourResetsAt === v.fiveHourResetsAt
      })
      this.estimates = next
      if (!same) {
        this.evaluate(false)
        this.emitStateSoon()
      }
    } catch {
      /* an unreadable transcript only means no estimate this round */
    }
  }

  // ---------------------------------------------------------------- desktop

  private readDesktop(): void {
    this.desktopDir = findDesktopDataDir(this.settings.desktopDataDirOverride)
    if (!this.desktopDir) {
      this.samples = []
      this.folders = []
      this.desktopRunning = false
      return
    }
    this.samples = readUsageSamples(this.desktopDir)
    this.folders = listAccountFolders(this.desktopDir)
    this.desktopRunning = isDesktopRunning(this.desktopDir)
    const prev = this.desktopCurrent.accountUuid
    this.desktopCurrent = this.detectDesktopCurrent()
    const now = this.desktopCurrent.accountUuid
    if (prev && now && prev !== now) {
      const acct = this.s.accounts.find((a) => a.accountUuid === now)
      this.addEvent('switch', acct ? this.t('desktopSwitched', { name: accountName(acct) }) : this.t('desktopUnknownAccount'), undefined, acct?.id)
    }
    this.checkPendingSwitch()
  }

  /** Claude Code session ids of every conversation in any desktop list. */
  private desktopSessionIds(): Set<string> {
    const ids = new Set<string>()
    for (const f of this.folders) for (const s of readSessions(f)) if (s.cliSessionId) ids.add(s.cliSessionId)
    return ids
  }

  /** The desktop app's id ("local_<uuid>") for a conversation, from any desktop list. */
  private desktopIdFor(cliSessionId: string | undefined): string | undefined {
    if (!cliSessionId) return undefined
    for (const f of this.folders) for (const s of readSessions(f)) if (s.cliSessionId === cliSessionId) return s.sessionId
    return undefined
  }

  /**
   * Newer of two authoritative signals: the app's last usage sample (it writes one for the signed-in account when
   * you sign in and about every 15 minutes after), and the last desktop session that reported its account through
   * the SessionStart / StopFailure hooks. File modification times are deliberately not used: they misled detection
   * right after a switch.
   */
  private detectDesktopCurrent(): { accountUuid?: string; orgUuid?: string; since?: number } {
    const candidates: Array<{ at: number; accountUuid?: string; orgUuid?: string }> = []
    const last = this.samples[this.samples.length - 1]
    if (last) {
      // The account/org pairs Claude Code saved at sign-in are authoritative. Folders are only a fallback, and an
      // org can appear under two account folders: while switching, the app briefly creates a folder pairing the old
      // account with the new org (holding just scheduled-tasks.json). Prefer the folder that has conversations.
      const acct = this.s.accounts.find((a) => a.orgUuid === last.org)
      const folder = this.folders
        .filter((f) => f.orgUuid === last.org)
        .sort((x, y) => sessionFileNames(y.dir).length - sessionFileNames(x.dir).length)[0]
      candidates.push({ at: last.t, orgUuid: last.org, accountUuid: acct?.accountUuid ?? folder?.accountUuid })
    }
    const sig = [...this.s.hookSignals].reverse().find((h) => h.entrypoint === 'claude-desktop' && h.accountUuid)
    if (sig) candidates.push({ at: sig.at, accountUuid: sig.accountUuid, orgUuid: sig.orgUuid })
    candidates.sort((a, b) => b.at - a.at)
    const best = candidates[0]
    return best ? { accountUuid: best.accountUuid, orgUuid: best.orgUuid, since: best.at } : {}
  }

  private ownFolders(): AccountFolder[] {
    if (!this.desktopDir) return []
    return this.s.accounts
      .filter((a) => a.accountUuid && a.orgUuid)
      .map((a) => ({ accountUuid: a.accountUuid!, orgUuid: a.orgUuid!, dir: accountFolder(this.desktopDir!, a.accountUuid!, a.orgUuid!) }))
  }

  private runMerge(manual: boolean, onlyTarget?: string): { copied: number; updated: number; error?: string } {
    this.lastMergeAt = Date.now()
    const own = this.ownFolders()
    if (own.length < 2) return { copied: 0, updated: 0 }
    try {
      const r = mergeDesktopSessions({
        ownFolders: own,
        currentAccountUuid: this.desktopRunning ? this.desktopCurrent.accountUuid : undefined,
        manifest: this.s.manifest,
        backupsRoot: qdPaths().backups,
        onlyTargetAccountUuid: onlyTarget
      })
      this.s.merge = { lastRunAt: Date.now(), lastCopied: r.copied + r.updated, error: r.errors[0] }
      if (r.copied + r.updated > 0 || manual) {
        this.addEvent('merge', this.t('merged'), this.t('mergedDetail', { copied: r.copied, updated: r.updated }))
      }
      saveStateSoon(this.s)
      if (r.copied + r.updated > 0) this.emitState()
      return { copied: r.copied, updated: r.updated, error: r.errors[0] }
    } catch (e) {
      this.s.merge = { ...this.s.merge, lastRunAt: Date.now(), error: (e as Error).message }
      return { copied: 0, updated: 0, error: (e as Error).message }
    }
  }

  // ---------------------------------------------------------------- accounts

  private nextColor(): string {
    const used = new Set(this.s.accounts.map((a) => a.color))
    return DEFAULT_COLORS.find((c) => !used.has(c)) ?? DEFAULT_COLORS[this.s.accounts.length % DEFAULT_COLORS.length]
  }

  /** Pick up plan or email changes Claude Code wrote after a sign-in or a profile refresh. */
  private syncProfilesFromConfig(): void {
    let dirty = false
    for (const a of this.s.accounts) {
      if (!a.cliConfigDir) continue
      const o = readOauthAccount(a.cliConfigDir)
      if (!o || (a.accountUuid && o.accountUuid !== a.accountUuid)) continue
      const plan = planFrom(o) ?? a.plan
      if (o.emailAddress && o.emailAddress !== a.email) {
        a.email = o.emailAddress
        dirty = true
      }
      if (o.organizationUuid && o.organizationUuid !== a.orgUuid) {
        a.orgUuid = o.organizationUuid
        dirty = true
      }
      if (plan && JSON.stringify(plan) !== JSON.stringify(a.plan)) {
        a.plan = plan
        dirty = true
      }
    }
    if (dirty) saveStateSoon(this.s)
  }

  private defaultCandidate(): AppState['defaultCliCandidate'] {
    const o = mainOauthAccount()
    if (!o?.accountUuid || this.s.accounts.some((a) => a.accountUuid === o.accountUuid)) return undefined
    return { email: o.emailAddress, accountUuid: o.accountUuid, plan: planFrom(o) }
  }

  async adoptDefaultCli(): Promise<void> {
    const o = mainOauthAccount()
    if (!o?.accountUuid) return
    const status = await authStatus(undefined)
    const existing = this.s.accounts.find((a) => a.accountUuid === o.accountUuid)
    const dir = mainClaudeDir()
    if (existing) {
      existing.cliConfigDir = dir
      existing.usesDefaultCliDir = true
      existing.cliLoggedIn = status?.loggedIn
    } else {
      const acct: Account = {
        id: o.accountUuid,
        accountUuid: o.accountUuid,
        orgUuid: o.organizationUuid,
        email: o.emailAddress,
        displayName: o.displayName,
        color: this.nextColor(),
        plan: planFrom(o, status?.subscriptionType),
        cliConfigDir: dir,
        usesDefaultCliDir: true,
        cliLoggedIn: status?.loggedIn,
        addedAt: Date.now()
      }
      this.s.accounts.push(acct)
      this.addEvent('login', this.t('adopted', { name: accountName(acct) }), acct.plan?.label, acct.id)
    }
    this.s.settings.acceptedOwnershipNotice = true
    saveStateNow(this.s)
    this.evaluate(false)
    this.emitState()
  }

  async startLogin(email: string | undefined, reloginAccountId?: string): Promise<string> {
    if (!this.settings.acceptedOwnershipNotice) throw new Error(this.t('needOwnership'))
    this.cli = await findClaude(true)
    if (!this.cli.found || !this.cli.path) throw new Error(this.t('noCli'))
    const id = crypto.randomBytes(6).toString('hex')
    const relogin = reloginAccountId ? this.s.accounts.find((a) => a.id === reloginAccountId) : undefined
    const dir = relogin?.cliConfigDir ?? newProfileDir()
    const job: LoginJob = { id, dir, newProfile: !relogin?.cliConfigDir, reloginAccountId, cancelled: false }
    this.logins.set(id, job)
    if (job.newProfile) createProfile(dir)
    const progress = (p: Omit<LoginProgress, 'loginId'>) => this.emit('login-progress', { loginId: id, ...p } satisfies LoginProgress)
    progress({ phase: 'starting' })
    let lastLine = ''
    job.handle = startOfficialLogin(this.cli.path, dir, email ?? relogin?.email, (line) => {
      lastLine = line
      const url = extractUrl(line)
      if (url && /claude\.(ai|com)|anthropic\.com/.test(url)) progress({ phase: 'waiting-browser', url, message: line })
    })
    void job.handle.done.then(async (r) => {
      if (job.cancelled) return
      if (r.code !== 0) {
        progress({ phase: 'failed', message: lastLine || r.stderr.trim().split(/\r?\n/).pop() })
        if (job.newProfile) await this.opts.trash(dir).catch(() => undefined)
        this.logins.delete(id)
        return
      }
      progress({ phase: 'verifying' })
      const result = await this.finishLogin(job)
      progress(result)
      this.logins.delete(id)
    })
    return id
  }

  private async finishLogin(job: LoginJob): Promise<Omit<LoginProgress, 'loginId'>> {
    const o = readOauthAccount(job.dir)
    const status = await authStatus(job.dir)
    if (!o?.accountUuid || status?.loggedIn === false) {
      if (job.newProfile) await this.opts.trash(job.dir).catch(() => undefined)
      return { phase: 'failed', message: this.t('loginFailed') }
    }
    const plan = planFrom(o, status?.subscriptionType)
    const existing = this.s.accounts.find((a) => a.accountUuid === o.accountUuid)
    if (existing) {
      const reusedDir = existing.cliConfigDir && exists(existing.cliConfigDir) && !samePath(existing.cliConfigDir, job.dir)
      if (reusedDir && job.newProfile) await this.opts.trash(job.dir).catch(() => undefined)
      else {
        existing.cliConfigDir = job.dir
        existing.usesDefaultCliDir = samePath(job.dir, mainClaudeDir())
      }
      existing.cliLoggedIn = true
      existing.plan = plan ?? existing.plan
      existing.email = o.emailAddress ?? existing.email
      existing.orgUuid = o.organizationUuid ?? existing.orgUuid
      const name = accountName(existing)
      this.addEvent('login', job.reloginAccountId ? this.t('loginRefreshed', { name }) : this.t('loginDuplicate', { name }), undefined, existing.id)
      saveStateNow(this.s)
      this.evaluate(false)
      this.emitState()
      return { phase: 'done', accountId: existing.id, duplicate: !job.reloginAccountId }
    }
    const acct: Account = {
      id: o.accountUuid,
      accountUuid: o.accountUuid,
      orgUuid: o.organizationUuid,
      email: o.emailAddress,
      displayName: o.displayName,
      color: this.nextColor(),
      plan,
      cliConfigDir: job.dir,
      usesDefaultCliDir: false,
      cliLoggedIn: true,
      addedAt: Date.now()
    }
    this.s.accounts.push(acct)
    this.addEvent('login', this.t('loginAdded', { name: accountName(acct), plan: plan?.label ?? '?' }), acct.email, acct.id)
    saveStateNow(this.s)
    this.evaluate(false)
    this.emitState()
    if (this.settings.autoMergeDesktop) this.runMerge(false)
    return { phase: 'done', accountId: acct.id }
  }

  async cancelLogin(loginId: string): Promise<void> {
    const job = this.logins.get(loginId)
    if (!job) return
    job.cancelled = true
    job.handle?.child.kill()
    this.logins.delete(loginId)
    if (job.newProfile) await this.opts.trash(job.dir).catch(() => undefined)
    this.emit('login-progress', { loginId, phase: 'cancelled' } satisfies LoginProgress)
  }

  /** `claude auth status` for every account, at most daily unless forced. */
  async checkLogins(force: boolean): Promise<void> {
    if (!force && Date.now() - (this.s.lastLoginCheckAt ?? 0) < DAY) return
    this.s.lastLoginCheckAt = Date.now()
    for (const a of this.s.accounts) {
      if (!a.cliConfigDir || !exists(a.cliConfigDir)) continue
      const st = await authStatus(a.usesDefaultCliDir ? undefined : a.cliConfigDir)
      if (!st) continue
      const was = a.cliLoggedIn
      a.cliLoggedIn = st.loggedIn
      if (st.loggedIn && st.subscriptionType) {
        const plan = planFrom(readOauthAccount(a.cliConfigDir), st.subscriptionType)
        if (plan) a.plan = plan
      }
      if (was !== false && st.loggedIn === false) {
        this.addEvent('error', this.t('needsLogin', { name: accountName(a) }), undefined, a.id)
        this.opts.notify({ kind: 'error', title: this.t('needsLogin', { name: accountName(a) }), action: { type: 'navigate', page: 'dashboard' } })
      }
    }
    saveStateSoon(this.s)
    this.emitState()
  }

  updateAccount(id: string, patch: { nickname?: string; color?: string }): void {
    const a = this.s.accounts.find((x) => x.id === id)
    if (!a) return
    if (patch.nickname !== undefined) a.nickname = patch.nickname.trim().slice(0, 24) || undefined
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) a.color = patch.color
    saveStateSoon(this.s)
    this.emitState()
  }

  async removeAccount(id: string, trashProfile: boolean): Promise<void> {
    const a = this.s.accounts.find((x) => x.id === id)
    if (!a) return
    this.s.accounts = this.s.accounts.filter((x) => x.id !== id)
    delete this.s.terminalUsage[id]
    delete this.s.limits[id]
    delete this.s.thresholds[id]
    if (trashProfile && a.cliConfigDir && !a.usesDefaultCliDir && isInside(a.cliConfigDir, qdPaths().profiles)) {
      await this.opts.trash(a.cliConfigDir).catch(() => undefined)
    }
    this.addEvent('info', this.t('accountRemoved', { name: accountName(a) }))
    saveStateNow(this.s)
    this.evaluate(false)
    this.emitState()
  }

  // ---------------------------------------------------------------- inbound from Claude Code

  /**
   * Which account a terminal session belongs to: sessions QuotaDeck started are remembered by id;
   * otherwise the transcript path tells (a profile's transcripts live under its folder).
   */
  private accountForTranscript(transcriptPath: string | undefined, sessionId?: string): Account | undefined {
    const known = sessionId ? this.s.sessionAccounts[sessionId] : undefined
    const byLaunch = known && this.s.accounts.find((a) => a.id === known.accountId)
    if (byLaunch) return byLaunch
    if (transcriptPath) {
      const byProfile = this.s.accounts.find((a) => a.cliConfigDir && !a.usesDefaultCliDir && isInside(transcriptPath, a.cliConfigDir))
      if (byProfile) return byProfile
    }
    const main = mainOauthAccount()
    return this.s.accounts.find((a) => a.usesDefaultCliDir) ?? (main ? this.s.accounts.find((a) => a.accountUuid === main.accountUuid) : undefined)
  }

  onStatusline(body: unknown): string {
    const b = body as {
      transcript_path?: string
      session_id?: string
      rate_limits?: { five_hour?: { used_percentage?: number; resets_at?: number }; seven_day?: { used_percentage?: number; resets_at?: number } }
    }
    const acct = this.accountForTranscript(b.transcript_path, b.session_id)
    const now = Date.now()
    if (acct && b.rate_limits) {
      const win = (w?: { used_percentage?: number; resets_at?: number }) =>
        typeof w?.used_percentage === 'number' ? { pct: w.used_percentage, resetsAt: w.resets_at ? w.resets_at * 1000 : undefined } : undefined
      const snap: UsageSnapshot = { at: now, source: 'terminal', fiveHour: win(b.rate_limits.five_hour), sevenDay: win(b.rate_limits.seven_day) }
      if (snap.fiveHour || snap.sevenDay) {
        this.s.terminalUsage[acct.id] = snap
        saveStateSoon(this.s, 5000)
        this.evaluate(false)
        this.emitStateSoon()
      }
    }
    const view = acct ? this.accountView(acct, now) : undefined
    const best = this.recommend(now, acct?.id)
    return renderStatusLine({
      lang: this.settings.language,
      timezone: this.settings.timezone,
      warnAt: this.settings.warnAt,
      criticalAt: this.settings.criticalAt,
      accountName: acct ? accountName(acct) : undefined,
      planLabel: acct?.plan?.label,
      usage: view?.usage,
      limited: view?.limit ? { resetsAt: view.limit.resetsAt } : undefined,
      suggestion: best ? { name: accountName(best.account), remainingPct: best.remaining } : undefined,
      now
    })
  }

  /** A session started or resumed and told us which account it runs as (desktop sessions only carry this). */
  onSessionStart(headers: http.IncomingHttpHeaders): void {
    const h = (k: string) => {
      const v = headers[k]
      const s = (Array.isArray(v) ? v[0] : v)?.trim()
      return s && !s.startsWith('$') ? s : undefined
    }
    const accountUuid = h('x-qd-account')
    const entrypoint = h('x-qd-entry')
    if (!accountUuid || !entrypoint) return
    const now = Date.now()
    this.s.hookSignals.push({ at: now, accountUuid, orgUuid: h('x-qd-org'), entrypoint })
    this.s.hookSignals = this.s.hookSignals.slice(-20)
    const session = h('x-qd-session')
    const acct = this.s.accounts.find((a) => a.accountUuid === accountUuid)
    if (session && acct) this.s.sessionAccounts[session] = { accountId: acct.id, at: now }
    saveStateSoon(this.s)
    this.readDesktop()
    this.evaluate(false)
    this.emitState()
  }

  onStopFailure(body: unknown, headers: http.IncomingHttpHeaders): void {
    const b = body as { error?: string; error_details?: string; last_assistant_message?: string; session_id?: string; transcript_path?: string; cwd?: string }
    const h = (k: string) => {
      const v = headers[k]
      const s = Array.isArray(v) ? v[0] : v
      return s && !s.startsWith('$') ? s : undefined
    }
    const now = Date.now()
    const accountUuid = h('x-qd-account')
    const entrypoint = h('x-qd-entry')
    if (accountUuid || entrypoint) {
      this.s.hookSignals.push({ at: now, accountUuid, orgUuid: h('x-qd-org'), email: h('x-qd-email'), entrypoint })
      this.s.hookSignals = this.s.hookSignals.slice(-20)
    }
    const acct = (accountUuid && this.s.accounts.find((a) => a.accountUuid === accountUuid)) || this.accountForTranscript(b.transcript_path, b.session_id)
    const message = [b.last_assistant_message, b.error_details].filter(Boolean).join(' · ')
    const name = acct ? accountName(acct) : (h('x-qd-email') ?? '?')

    if (b.error === 'rate_limit') {
      const parsed = parseLimitMessage(message, now)
      if (!isUsageLimitMessage(message) && !parsed?.resetsAt) {
        this.addEvent('info', this.t('rateLimited', { name }), this.t('rateLimitedDetail'), acct?.id)
      } else if (acct) {
        const limit: LimitInfo = { kind: parsed?.kind ?? 'unknown', at: now, resetsAt: parsed?.resetsAt, message }
        this.s.limits[acct.id] = limit
        this.s.lastInterrupted = { accountId: acct.id, cliSessionId: b.session_id, cwd: b.cwd, title: this.titleFor(b.session_id), at: now }
        this.announceLimit(acct, limit, b.session_id, b.cwd)
      }
    } else if (b.error === 'authentication_failed' && acct && entrypoint !== 'claude-desktop') {
      acct.cliLoggedIn = false
      this.addEvent('error', this.t('needsLogin', { name }), message, acct.id)
      this.opts.notify({ kind: 'error', title: this.t('needsLogin', { name }), action: { type: 'navigate', page: 'dashboard' } })
    } else if (b.error === 'billing_error' || b.error === 'account_on_hold') {
      const title = this.t(b.error === 'billing_error' ? 'billingError' : 'accountOnHold', { name })
      this.addEvent('error', title, message, acct?.id)
      this.opts.notify({ kind: 'error', title, body: message })
    }
    saveStateSoon(this.s)
    this.readDesktop()
    this.evaluate(false)
    this.emitState()
  }

  private titleFor(cliSessionId: string | undefined): string | undefined {
    if (!cliSessionId) return undefined
    for (const f of this.folders) {
      for (const s of readSessions(f)) if (s.cliSessionId === cliSessionId && s.title) return s.title
    }
    return listTranscripts().find((t) => t.cliSessionId === cliSessionId)?.title
  }

  private announceLimit(acct: Account, limit: LimitInfo, cliSessionId?: string, cwd?: string): void {
    const now = Date.now()
    const name = accountName(acct)
    const title = this.t('limitHit', { name, window: windowName(this.settings.language, limit.kind) })
    const reset = limit.resetsAt ? this.t('resetsAt', { time: formatClock(limit.resetsAt, this.settings.timezone, this.settings.language, now) }) : this.t('resetUnknown')
    const best = this.recommend(now, acct.id)
    const bestText = best
      ? best.remaining !== undefined
        ? this.t('bestLeft', { name: accountName(best.account), pct: Math.round(best.remaining) })
        : this.t('bestUnknown', { name: accountName(best.account) })
      : this.t('noBest')
    const detail = `${reset} · ${bestText}`
    this.addEvent('limit-hit', title, detail, acct.id, cliSessionId, cwd)
    if (this.settings.notifyOnLimit) {
      this.opts.notify({
        kind: 'limit',
        title,
        body: best ? `${detail}\n${this.t('notify.clickToSwitch')}` : detail,
        action: { type: 'open-switch', fromAccountId: acct.id, toAccountId: best?.account.id, cliSessionId }
      })
    }
  }

  /**
   * The desktop conversation most likely cut off by a limit that was only seen in the usage numbers: the newest
   * desktop transcript written in the last half hour.
   */
  private latestDesktopConversation(now: number): TranscriptMeta | undefined {
    return listTranscripts().find((t) => now - t.lastActivityAt < 30 * MIN && (t.entrypoint === 'claude-desktop' || this.desktopIdFor(t.cliSessionId) !== undefined))
  }

  // ---------------------------------------------------------------- views

  private usageFor(a: Account, now: number): { usage?: UsageSnapshot; history: UsagePoint[] } {
    const fromDesktop = a.orgUuid ? this.samples.filter((s) => s.org === a.orgUuid) : []
    const history: UsagePoint[] = fromDesktop.filter((s) => now - s.t <= 7 * DAY).map((s) => ({ t: s.t, fh: s.fh, sd: s.sd }))
    const term = this.s.terminalUsage[a.id]
    if (term && now - term.at <= 7 * DAY) history.push({ t: term.at, fh: term.fiveHour?.pct, sd: term.sevenDay?.pct })
    history.sort((x, y) => x.t - y.t)

    const lastDesk = fromDesktop[fromDesktop.length - 1]
    const desk: UsageSnapshot | undefined = lastDesk
      ? {
          at: lastDesk.t,
          source: 'desktop',
          fiveHour: lastDesk.fh !== undefined ? { pct: lastDesk.fh } : undefined,
          sevenDay: lastDesk.sd !== undefined ? { pct: lastDesk.sd } : undefined
        }
      : undefined
    let usage = desk && (!term || desk.at >= term.at) ? desk : term
    if (usage && term && usage === desk) {
      // Desktop samples carry no reset times; borrow the terminal's while they are still ahead.
      usage = {
        ...usage,
        fiveHour: usage.fiveHour && term.fiveHour?.resetsAt && term.fiveHour.resetsAt > now ? { ...usage.fiveHour, resetsAt: term.fiveHour.resetsAt } : usage.fiveHour,
        sevenDay: usage.sevenDay && term.sevenDay?.resetsAt && term.sevenDay.resetsAt > now ? { ...usage.sevenDay, resetsAt: term.sevenDay.resetsAt } : usage.sevenDay
      }
    }
    // Desktop samples carry no reset times. When a limit with a known reset (from Claude Code's message or the
    // estimate) was recorded after this reading, that reset applies to the reading too.
    const known = this.s.limits[a.id]
    if (usage && known?.resetsAt && known.resetsAt > usage.at) {
      if (known.kind === 'session' && usage.fiveHour && !usage.fiveHour.resetsAt) usage = { ...usage, fiveHour: { ...usage.fiveHour, resetsAt: known.resetsAt } }
      if (known.kind === 'weekly' && usage.sevenDay && !usage.sevenDay.resetsAt) usage = { ...usage, sevenDay: { ...usage.sevenDay, resetsAt: known.resetsAt } }
    }
    if (usage) {
      // A window whose reset time has passed starts again from zero.
      const fresh = (w?: { pct: number; resetsAt?: number }) => (w && w.resetsAt && w.resetsAt <= now ? { pct: 0 } : w)
      usage = { ...usage, fiveHour: fresh(usage.fiveHour), sevenDay: fresh(usage.sevenDay) }
      // A window cannot still be as full as it was when it was seen longer ago than the window itself.
      if (usage.fiveHour && !usage.fiveHour.resetsAt && now - usage.at > 5 * HOUR) usage = { ...usage, fiveHour: { pct: 0 } }
      if (usage.sevenDay && !usage.sevenDay.resetsAt && now - usage.at > 7 * DAY) usage = { ...usage, sevenDay: { pct: 0 } }
    }
    return { usage, history }
  }

  private activeLimit(a: Account, usage: UsageSnapshot | undefined, now: number, est?: UsageEstimate): LimitInfo | undefined {
    const stored = this.s.limits[a.id]
    if (stored) {
      const expired = stored.resetsAt ? stored.resetsAt <= now : now - stored.at > 5 * HOUR
      const relieved = usage && usage.at > stored.at + MIN && (peakPct(usage) ?? 100) < 100
      if (!expired && !relieved) return stored
    }
    // A full window seen only in the numbers. The estimate knows when a 5-hour window started, hence its reset.
    if (usage?.fiveHour && usage.fiveHour.pct >= 100) return { kind: 'session', at: usage.at, resetsAt: usage.fiveHour.resetsAt ?? est?.fiveHourResetsAt }
    if (usage?.sevenDay && usage.sevenDay.pct >= 100) return { kind: 'weekly', at: usage.at, resetsAt: usage.sevenDay.resetsAt }
    return undefined
  }

  private accountView(a: Account, now: number): AccountView {
    const { usage, history } = this.usageFor(a, now)
    const rawEst = this.estimates.get(a.id)
    const limit = this.activeLimit(a, usage, now, rawEst)
    const isDesktopCurrent = !!a.accountUuid && a.accountUuid === this.desktopCurrent.accountUuid
    const folder = this.desktopDir && a.accountUuid && a.orgUuid ? accountFolder(this.desktopDir, a.accountUuid, a.orgUuid) : undefined
    const desktopSessionCount = folder ? sessionFileNames(folder).length : 0
    const peak = peakPct(usage)
    let status: AccountView['status']
    if (limit) status = 'limited'
    else if (a.cliLoggedIn === false && !isDesktopCurrent) status = 'needs-login'
    else if (peak !== undefined && peak >= this.settings.warnAt) status = 'warn'
    else if (usage) status = 'ok'
    else status = 'unknown'
    // Terminal numbers are live already; the estimate fills the gaps between desktop records.
    const est = rawEst
    const estimate = est && usage?.source !== 'terminal' && (!usage || !est.fromRecordAt || est.fromRecordAt >= usage.at - 1000) ? est : undefined
    const eta = limit
      ? undefined
      : computeEta({
          now,
          fiveHour: estimate?.fiveHour ?? usage?.fiveHour?.pct,
          sevenDay: estimate?.sevenDay ?? usage?.sevenDay?.pct,
          fiveHourResetsAt: usage?.fiveHour?.resetsAt ?? estimate?.fiveHourResetsAt,
          sevenDayResetsAt: usage?.sevenDay?.resetsAt,
          points: history.filter((p) => p.t > now - DAY),
          rate: this.rates.get(a.id),
          events: this.recentEvents.get(a.id)
        })
    return { ...a, usage, estimate, eta, history, limit, isDesktopCurrent, desktopSessionCount, status }
  }

  /** The account with the most usable capacity left (remaining % × plan size), excluding `exceptId`. */
  private recommend(now: number, exceptId?: string): { account: Account; remaining?: number } | undefined {
    let best: { account: Account; remaining?: number; score: number } | undefined
    for (const a of this.s.accounts) {
      if (a.id === exceptId) continue
      const v = this.accountView(a, now)
      if (v.status === 'limited' || v.status === 'needs-login') continue
      const recorded = peakPct(v.usage)
      const estimated = v.estimate ? Math.max(v.estimate.fiveHour ?? 0, v.estimate.sevenDay ?? 0) : undefined
      const peak = estimated !== undefined ? Math.max(estimated, recorded ?? 0) : recorded
      const remaining = peak === undefined ? undefined : 100 - peak
      const score = (remaining ?? 35) * planWeight(a.plan)
      if (!best || score > best.score) best = { account: a, remaining, score }
    }
    return best
  }

  /** Fire threshold / reset notifications by comparing with what was already announced. */
  private evaluate(initial: boolean): void {
    const now = Date.now()
    for (const a of this.s.accounts) {
      const v = this.accountView(a, now)
      const fired = (this.s.thresholds[a.id] ??= {})
      for (const key of ['fh', 'sd'] as const) {
        const pct = key === 'fh' ? v.usage?.fiveHour?.pct : v.usage?.sevenDay?.pct
        if (pct === undefined) continue
        const level = pct >= this.settings.criticalAt ? this.settings.criticalAt : pct >= this.settings.warnAt ? this.settings.warnAt : 0
        const prev = fired[key] ?? 0
        if (level > prev && pct < 100) {
          fired[key] = level
          if (!initial) {
            const title = this.t('threshold', { name: accountName(a), window: windowName(this.settings.language, key), pct: Math.round(pct) })
            this.addEvent('threshold', title, undefined, a.id)
            if (this.settings.notifyOnThreshold) this.opts.notify({ kind: 'threshold', title, action: { type: 'open-switch', fromAccountId: a.id } })
          }
        } else if (pct < this.settings.warnAt - 10 && prev) {
          fired[key] = 0
          if (key === 'fh') fired.eta = undefined
        }
      }
      // "Full in under 30 minutes at this pace", once per 5-hour window.
      if (fired.eta && now - fired.eta > 5 * HOUR) fired.eta = undefined
      const fullAt = v.eta?.fiveHourFullAt
      if (fullAt && !v.limit && fullAt - now <= 30 * MIN && !fired.eta) {
        fired.eta = now
        if (!initial) {
          const time = formatClock(fullAt, this.settings.timezone, this.settings.language, now)
          const title = this.t('etaSoon', { name: accountName(a), window: windowName(this.settings.language, 'fh'), time })
          this.addEvent('threshold', title, this.t('etaSoonBody'), a.id)
          if (this.settings.notifyOnThreshold) {
            this.opts.notify({ kind: 'threshold', title, body: this.t('etaSoonBody'), action: { type: 'open-switch', fromAccountId: a.id, toAccountId: this.recommend(now, a.id)?.account.id } })
          }
        }
      }
      // A limit seen only in the usage numbers (no hook installed, or a desktop sample at 100%) is announced too.
      if (v.limit && !this.s.limits[a.id]) {
        this.s.limits[a.id] = v.limit
        if (!initial) {
          // Without a hook there is no session id; the newest desktop conversation is the one that was cut off.
          const li = this.s.lastInterrupted
          let conv: TranscriptMeta | undefined
          if (v.isDesktopCurrent && !(li && li.accountId === a.id && now - li.at < 30 * MIN)) {
            conv = this.latestDesktopConversation(now)
            if (conv) this.s.lastInterrupted = { accountId: a.id, cliSessionId: conv.cliSessionId, cwd: conv.cwd, title: this.titleFor(conv.cliSessionId) ?? conv.firstPrompt, at: now }
          }
          this.announceLimit(a, v.limit, conv?.cliSessionId ?? (li?.accountId === a.id ? li.cliSessionId : undefined), conv?.cwd)
        }
        continue
      }
      const stored = this.s.limits[a.id]
      if (stored && !v.limit) {
        delete this.s.limits[a.id]
        const name = accountName(a)
        const title = this.t(v.isDesktopCurrent ? 'resetBackCurrent' : 'resetBack', { name })
        this.addEvent('reset', title, this.t('reset', { name, window: windowName(this.settings.language, stored.kind) }), a.id)
        if (this.settings.notifyOnReset && !initial) {
          const current = this.s.accounts.find((x) => x.accountUuid && x.accountUuid === this.desktopCurrent.accountUuid)
          this.opts.notify({
            kind: 'reset',
            title,
            action: v.isDesktopCurrent ? { type: 'navigate', page: 'dashboard' } : { type: 'open-switch', fromAccountId: current?.id, toAccountId: a.id }
          })
        }
      }
    }
    saveStateSoon(this.s)
  }

  getState(): AppState {
    const now = Date.now()
    const accounts = this.s.accounts.map((a) => this.accountView(a, now))
    const limitedCurrent = accounts.find((a) => a.isDesktopCurrent && a.status === 'limited')
    const best = this.recommend(now, limitedCurrent?.id)
    const probe = (() => {
      try {
        return integration.probe(this.integrationConfig())
      } catch {
        return { hooksInstalled: false, statusLineInstalled: false, stale: false }
      }
    })()
    const desktop: DesktopInfo = {
      found: !!this.desktopDir,
      dataDir: this.desktopDir,
      currentAccountUuid: this.desktopCurrent.accountUuid,
      currentOrgUuid: this.desktopCurrent.orgUuid,
      currentSince: this.desktopCurrent.since,
      knownAccountUuids: [...new Set(this.folders.map((f) => f.accountUuid))],
      running: this.desktopRunning
    }
    const merge: MergeStatus = {
      enabled: this.settings.autoMergeDesktop,
      lastRunAt: this.s.merge.lastRunAt,
      lastCopied: this.s.merge.lastCopied,
      totalCopied: this.s.manifest.totalCopied,
      backupsDir: qdPaths().backups,
      error: this.s.merge.error,
      eligibleAccounts: this.ownFolders().length
    }
    const integ: IntegrationStatus = {
      hooksInstalled: probe.hooksInstalled,
      statusLineInstalled: probe.statusLineInstalled,
      statusLineConflict: 'statusLineConflict' in probe ? probe.statusLineConflict : undefined,
      serverPort: this.server?.port ?? this.settings.serverPort,
      serverRunning: !!this.server,
      settingsPath: path.join(mainClaudeDir(), 'settings.json')
    }
    this.view = {
      appVersion: this.opts.appVersion,
      platform: process.platform,
      demo: false,
      accounts,
      recommendedAccountId: best?.account.id,
      defaultCliCandidate: this.defaultCandidate(),
      desktop,
      merge,
      integration: integ,
      settings: this.settings,
      cli: this.cli,
      events: this.s.events.slice(0, 300),
      lastInterrupted: this.s.lastInterrupted,
      needsSetup: !this.s.setupDismissedAt && (this.s.accounts.length === 0 || !probe.hooksInstalled),
      pendingSwitch: this.s.pendingSwitch,
      update: this.s.update
    }
    return this.view
  }

  private emitState(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = undefined
    }
    this.emit('state', this.getState())
  }

  private emitStateSoon(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      this.emit('state', this.getState())
    }, 400)
  }

  refresh(): AppState {
    this.readDesktop()
    this.syncProfilesFromConfig()
    this.evaluate(false)
    void this.checkLogins(true)
    return this.getState()
  }

  // ---------------------------------------------------------------- actions

  async continueInTerminal(req: ContinueRequest): Promise<ActionResult> {
    const acct = this.s.accounts.find((a) => a.id === req.accountId)
    if (!acct) return { ok: false, error: 'unknown account' }
    if (!acct.cliConfigDir) return { ok: false, error: this.t('noProfile') }
    this.cli = await findClaude()
    if (!this.cli.found) return { ok: false, error: this.t('noCli') }
    let cwd = req.cwd
    if (req.cliSessionId && !cwd) cwd = listTranscripts().find((t) => t.cliSessionId === req.cliSessionId)?.cwd
    const prompt = req.sendPrompt ? this.settings.continuePrompt || DEFAULT_CONTINUE_PROMPT[this.settings.language] : undefined
    const name = accountName(acct)
    // Remember which account runs the session, so its status line and limit events are attributed correctly.
    const sessionId = req.cliSessionId ?? crypto.randomUUID()
    this.s.sessionAccounts[sessionId] = { accountId: acct.id, at: Date.now() }
    const ids = Object.entries(this.s.sessionAccounts).sort((x, y) => y[1].at - x[1].at)
    for (const [old] of ids.slice(300)) delete this.s.sessionAccounts[old]
    try {
      if (!acct.usesDefaultCliDir) repairLinks(acct.cliConfigDir)
      await launchInTerminal({
        cliPath: this.cli.path,
        configDir: acct.usesDefaultCliDir ? undefined : acct.cliConfigDir,
        cwd,
        resumeId: req.cliSessionId,
        newSessionId: req.cliSessionId ? undefined : sessionId,
        prompt,
        title: `QuotaDeck · ${name}`,
        banner: req.cliSessionId ? this.t('switchTerminal', { name }) : this.t('switchTerminalNew', { name }),
        terminal: this.settings.terminal
      })
      const title = req.cliSessionId ? this.titleFor(req.cliSessionId) : undefined
      this.addEvent('switch', req.cliSessionId ? this.t('switchTerminal', { name }) : this.t('switchTerminalNew', { name }), title, acct.id, req.cliSessionId, cwd)
      this.emitState()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  prepareDesktopSwitch(toAccountId: string, opts: DesktopSwitchOptions = {}): DesktopSwitchResult {
    const acct = this.s.accounts.find((a) => a.id === toAccountId)
    if (!acct) return { ok: false, copied: 0, error: 'unknown account' }
    if (!this.desktopDir) return { ok: false, copied: 0, error: this.t('noDesktop'), targetEmail: acct.email }
    if (!acct.accountUuid || !acct.orgUuid) return { ok: false, copied: 0, error: this.t('desktopNeedsIds'), targetEmail: acct.email }
    if (acct.accountUuid === this.desktopCurrent.accountUuid) return { ok: true, copied: 0, targetEmail: acct.email }
    const r = this.runMerge(false, acct.accountUuid)
    const copied = r.copied + r.updated
    this.addEvent('switch', this.t('desktopPrepared', { n: copied, name: accountName(acct) }), undefined, acct.id)

    // Watch for the sign-in, so the conversation can be picked up the moment it happens.
    const now = Date.now()
    const from = opts.fromAccountId ?? this.s.accounts.find((a) => a.accountUuid && a.accountUuid === this.desktopCurrent.accountUuid)?.id
    const li = this.s.lastInterrupted && now - this.s.lastInterrupted.at < 2 * HOUR ? this.s.lastInterrupted : undefined
    const cliSessionId = opts.cliSessionId ?? li?.cliSessionId
    const desktopSessionId = this.desktopIdFor(cliSessionId)
    const pending: PendingSwitch = {
      id: crypto.randomBytes(6).toString('hex'),
      fromAccountId: from,
      toAccountId: acct.id,
      conversation: cliSessionId
        ? {
            cliSessionId,
            desktopSessionId,
            title: opts.title ?? this.titleFor(cliSessionId) ?? (li?.cliSessionId === cliSessionId ? li.title : undefined),
            cwd: opts.cwd ?? (li?.cliSessionId === cliSessionId ? li.cwd : undefined),
            inTargetList: !!desktopSessionId && exists(path.join(accountFolder(this.desktopDir, acct.accountUuid, acct.orgUuid), `${desktopSessionId}.json`))
          }
        : undefined,
      startedAt: now,
      phase: 'waiting'
    }
    this.s.pendingSwitch = pending
    saveStateSoon(this.s)
    this.emitState()
    return { ok: !r.error, copied, error: r.error, targetEmail: acct.email, pending }
  }

  cancelPendingSwitch(): void {
    if (!this.s.pendingSwitch) return
    this.s.pendingSwitch = undefined
    saveStateSoon(this.s)
    this.emitState()
  }

  /** Called whenever the desktop account may have changed: finishes, rejects or expires the watched switch. */
  private checkPendingSwitch(): void {
    const p = this.s.pendingSwitch
    if (!p) return
    const now = Date.now()
    if (p.phase !== 'waiting') {
      if (now - (p.finishedAt ?? p.startedAt) > PENDING_SWITCH_SHOW) {
        this.s.pendingSwitch = undefined
        saveStateSoon(this.s)
        this.emitStateSoon()
      }
      return
    }
    const target = this.s.accounts.find((a) => a.id === p.toAccountId)
    if (!target || now - p.startedAt > PENDING_SWITCH_WAIT) {
      this.s.pendingSwitch = undefined
      this.addEvent('info', this.t('switchExpired'), undefined, p.toAccountId)
      this.emit('switch-progress', { ...p, phase: 'expired', finishedAt: now } satisfies PendingSwitch)
      saveStateSoon(this.s)
      this.emitStateSoon()
      return
    }
    const cur = this.desktopCurrent
    if (!cur.accountUuid || !cur.since || cur.since < p.startedAt) return
    const fromAcct = this.s.accounts.find((a) => a.id === p.fromAccountId)
    if (cur.accountUuid === target.accountUuid) this.finishPendingSwitch(p, target)
    else if (cur.accountUuid !== fromAcct?.accountUuid) {
      const actual = this.s.accounts.find((a) => a.accountUuid === cur.accountUuid)
      const done: PendingSwitch = { ...p, phase: 'wrong-account', finishedAt: now, actualAccountId: actual?.id }
      this.s.pendingSwitch = done
      const title = actual ? this.t('switchWrong', { actual: accountName(actual), target: accountName(target) }) : this.t('switchWrongUnknown', { target: accountName(target) })
      this.addEvent('switch', title, undefined, target.id)
      this.opts.notify({ kind: 'info', title, action: { type: 'open-switch', toAccountId: target.id } })
      this.emit('switch-progress', done)
      saveStateSoon(this.s)
      this.emitStateSoon()
    }
  }

  private finishPendingSwitch(p: PendingSwitch, target: Account): void {
    const now = Date.now()
    const conv = p.conversation
    const name = accountName(target)
    const inList =
      !!conv?.desktopSessionId && !!this.desktopDir && !!target.accountUuid && !!target.orgUuid
        ? exists(path.join(accountFolder(this.desktopDir, target.accountUuid, target.orgUuid), `${conv.desktopSessionId}.json`))
        : false
    const prompt = this.settings.continuePrompt.trim()
    const copy = !!conv && inList && !!prompt
    if (copy) this.emit('copy-text', prompt)
    const done: PendingSwitch = { ...p, phase: 'done', finishedAt: now, copiedPrompt: copy, conversation: conv ? { ...conv, inTargetList: inList } : undefined }
    this.s.pendingSwitch = done
    const title = this.t('switchDone', { name })
    const convTitle = conv?.title ?? conv?.cliSessionId?.slice(0, 8) ?? ''
    const body = !conv
      ? this.t('switchDoneNoConv')
      : !inList
        ? this.t('switchNotInList', { title: convTitle, name })
        : copy
          ? this.t('switchDoneBody', { title: convTitle })
          : this.t('switchDoneNoCopy', { title: convTitle })
    this.addEvent('switch', title, body, target.id, conv?.cliSessionId, conv?.cwd)
    this.opts.notify({ kind: 'info', title, body, action: { type: 'navigate', page: 'dashboard' } })
    this.emit('switch-progress', done)
    saveStateSoon(this.s)
    this.emitStateSoon()
  }

  async openDesktopApp(): Promise<ActionResult> {
    const ok = await this.opts.openDesktop()
    return { ok }
  }

  /** The desktop app's own "continue this Code session" link (it also uses it for its jump list). */
  desktopLinkFor(target: { cliSessionId?: string; desktopSessionId?: string }): string | undefined {
    const id = target.desktopSessionId ?? this.desktopIdFor(target.cliSessionId)
    return id && /^local_[A-Za-z0-9-]{1,64}$/.test(id) ? `claude://code/continue?session=${id}` : undefined
  }

  /** Which of your accounts a bucket's replies belong to ("" when unknown); same rules as the live estimate. */
  private bucketAccounts(): (b: UsageBucket) => string {
    const desktopSessions = this.desktopSessionIds()
    const orgToAccount = new Map<string, string>()
    for (const a of this.s.accounts) if (a.orgUuid) orgToAccount.set(a.orgUuid, a.id)
    const def = this.s.accounts.find((a) => a.usesDefaultCliDir)?.id ?? ''
    return (b) => {
      const known = this.s.sessionAccounts[b.s]?.accountId
      if (known) return known
      const desktop = b.e === 'd' || (b.e === undefined && desktopSessions.has(b.s))
      if (!desktop) return def
      return (b.g && orgToAccount.get(b.g)) || ''
    }
  }

  private sessionAccountsCache?: { revision: number; at: number; map: Map<string, string[]> }

  /** For each conversation, the accounts that ran requests in it (whole ledger), most used first. */
  private accountsBySession(): Map<string, string[]> {
    const c = this.sessionAccountsCache
    if (c && c.revision === this.ledger.revision && Date.now() - c.at < MIN) return c.map
    const of = this.ledgerAccounts()
    const units = new Map<string, Map<string, number>>()
    for (const e of this.ledger.entries()) {
      const acct = of(e)
      if (!acct) continue
      const m = units.get(e.s) ?? new Map<string, number>()
      m.set(acct, (m.get(acct) ?? 0) + e.c)
      units.set(e.s, m)
    }
    const map = new Map<string, string[]>()
    for (const [s, m] of units) map.set(s, [...m].sort((x, y) => y[1] - x[1]).map(([id]) => id))
    this.sessionAccountsCache = { revision: this.ledger.revision, at: Date.now(), map }
    return map
  }

  /** Account of a ledger entry: as recorded, or claimed later by an account added since (through its organization). */
  private ledgerAccounts(): (e: LedgerEntry) => string {
    const orgToAccount = new Map<string, string>()
    for (const a of this.s.accounts) if (a.orgUuid) orgToAccount.set(a.orgUuid, a.id)
    return (e) => e.a || (e.g ? (orgToAccount.get(e.g) ?? '') : '')
  }

  /** Row of a ledger entry in the statistics: an account, "org:<uuid>" for an organization not in the panel, or "". */
  private ledgerRows(): (e: LedgerEntry) => string {
    const account = this.ledgerAccounts()
    return (e) => account(e) || (e.g ? `org:${e.g}` : '')
  }

  private orgOrderCache?: { key: string; order: Map<string, number> }

  /** Organizations not in the panel, oldest usage first; their default names are numbered in this order. */
  private orgOrder(): Map<string, number> {
    const key = `${this.ledger.revision}|${this.s.accounts.map((a) => a.orgUuid).join(',')}`
    if (this.orgOrderCache?.key === key) return this.orgOrderCache.order
    const claimed = new Set(this.s.accounts.map((a) => a.orgUuid).filter(Boolean))
    const first = new Map<string, number>()
    for (const e of this.ledger.entries()) {
      if (e.a || !e.g || claimed.has(e.g)) continue
      const seen = first.get(e.g)
      if (seen === undefined || e.h < seen) first.set(e.g, e.h)
    }
    const order = new Map([...first].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0])).map(([org], i) => [org, i]))
    this.orgOrderCache = { key, order }
    return order
  }

  /** Default name of an organization row: "旧号", then "旧号 2", "旧号 3" … */
  private orgDefaultName(org: string): string {
    const i = this.orgOrder().get(org) ?? 0
    return i === 0 ? this.t('stats.oldAccount') : `${this.t('stats.oldAccount')} ${i + 1}`
  }

  setOrgLabel(orgUuid: string, label: string): void {
    const clean = Array.from(label.replace(/\s+/g, ' ').trim()).slice(0, 40).join('').trim()
    if (clean) this.s.orgLabels[orgUuid] = clean
    else delete this.s.orgLabels[orgUuid]
    this.statsCache.clear()
    saveStateSoon(this.s)
    this.emitState()
  }

  private lastLedgerMetaAt = 0

  /**
   * Organization each desktop conversation was started under: the desktop list holding it that QuotaDeck did not
   * copy it into. Used for requests older than the desktop app's usage samples (about 30 days), from before any
   * merging, when a conversation stayed with the account it was started on.
   */
  private originalOrgs(): Map<string, string> {
    const copies = new Set(Object.values(this.s.manifest.entries).map((e) => normalize(e.dest)))
    const map = new Map<string, string>()
    for (const f of this.folders) {
      for (const s of readSessions(f)) if (s.cliSessionId && !map.has(s.cliSessionId) && !copies.has(normalize(s.file))) map.set(s.cliSessionId, f.orgUuid)
    }
    return map
  }

  /** Scanner buckets with the organization filled in where the desktop samples did not reach. */
  private withOrgs(buckets: Iterable<UsageBucket>): UsageBucket[] {
    const orgs = this.originalOrgs()
    const out: UsageBucket[] = []
    for (const b of buckets) out.push(b.g || b.e === 'c' || !orgs.has(b.s) ? b : { ...b, g: orgs.get(b.s) })
    return out
  }

  /** Mirror the scanner's month of buckets into the ledger, and keep account names and conversation titles. */
  private syncLedger(): void {
    const changed = this.ledger.sync(entriesFrom(this.withOrgs(Object.values(this.scanner.buckets)), this.bucketAccounts()), Date.now(), true)
    for (const a of this.s.accounts) this.ledger.setAccount(a.id, { email: a.email, nickname: a.nickname, plan: a.plan?.label })
    if (changed || Date.now() - this.lastLedgerMetaAt > 10 * MIN) {
      this.lastLedgerMetaAt = Date.now()
      const titles = new Map<string, { title?: string; cwd?: string }>()
      for (const f of this.folders) for (const s of readSessions(f)) if (s.cliSessionId && !titles.has(s.cliSessionId)) titles.set(s.cliSessionId, { title: s.title, cwd: s.cwd })
      const metas = new Map(listTranscripts().map((t) => [t.cliSessionId, t]))
      const sessions = new Set(Object.values(this.scanner.buckets).map((b) => b.s))
      for (const id of sessions) {
        const t = metas.get(id)
        const d = titles.get(id)
        this.ledger.setSession(id, { title: d?.title ?? t?.title ?? t?.firstPrompt, cwd: t?.cwd ?? d?.cwd, projectDir: t?.projectDir ?? this.scanner.projectOf(id) })
      }
    }
    this.ledger.save()
  }

  listConversations(query: ConversationQuery = {}): ConversationItem[] {
    const byCli = new Map<string, { title?: string; cwd?: string; desktopId?: string; accounts: Set<string> }>()
    for (const f of this.folders) {
      const acct = this.s.accounts.find((a) => a.accountUuid === f.accountUuid)
      for (const s of readSessions(f)) {
        if (!s.cliSessionId) continue
        const entry = byCli.get(s.cliSessionId) ?? { accounts: new Set<string>() }
        if (s.title && !entry.title) entry.title = s.title
        if (s.cwd && !entry.cwd) entry.cwd = s.cwd
        if (!entry.desktopId) entry.desktopId = s.sessionId
        if (acct) entry.accounts.add(acct.id)
        byCli.set(s.cliSessionId, entry)
      }
    }
    const used = this.accountsBySession()
    const favorites = new Set(this.s.favorites)
    const orgToAccount = new Map<string, string>()
    for (const a of this.s.accounts) if (a.orgUuid) orgToAccount.set(a.orgUuid, a.id)
    const def = this.s.accounts.find((a) => a.usesDefaultCliDir)?.id
    const q = query.search?.trim().toLowerCase()
    const cwdFilter = query.cwd ? normalizeDir(query.cwd) : undefined
    const items: ConversationItem[] = []
    for (const t of listTranscripts()) {
      const d = byCli.get(t.cliSessionId)
      const title = d?.title || t.title || t.firstPrompt || t.cliSessionId.slice(0, 8)
      const entrypoint = t.entrypoint ?? (d ? 'claude-desktop' : undefined)
      // Who ran it: from its replies when they are recent enough, else who started it.
      let accountIds = used.get(t.cliSessionId) ?? []
      if (accountIds.length === 0) {
        const owner =
          this.s.sessionAccounts[t.cliSessionId]?.accountId ??
          (entrypoint === 'claude-desktop' ? orgToAccount.get(this.orgAt(t.createdAt ?? t.lastActivityAt) ?? '') : def)
        if (owner) accountIds = [owner]
      }
      const item: ConversationItem = {
        cliSessionId: t.cliSessionId,
        title,
        firstPrompt: t.firstPrompt,
        cwd: t.cwd ?? d?.cwd,
        projectDir: t.projectDir,
        lastActivityAt: t.lastActivityAt,
        createdAt: t.createdAt,
        lines: t.lines,
        // A conversation in a desktop list was started in the desktop app even if its transcript does not say so.
        entrypoint,
        desktopAccountIds: d ? [...d.accounts] : [],
        accountIds,
        desktopSessionId: d?.desktopId,
        favorite: favorites.has(t.cliSessionId),
        sizeBytes: t.size
      }
      if (q && ![item.title, item.firstPrompt, item.cwd, t.lastPrompt].some((s) => s?.toLowerCase().includes(q))) continue
      if (cwdFilter && (!item.cwd || normalizeDir(item.cwd) !== cwdFilter)) continue
      if (query.accountId && !item.accountIds.includes(query.accountId)) continue
      if (query.entrypoint && (item.entrypoint === 'claude-desktop') !== (query.entrypoint === 'desktop')) continue
      if (query.favoritesOnly && !item.favorite) continue
      items.push(item)
      if (query.limit && items.length >= query.limit) break
    }
    saveHistoryCache()
    return items
  }

  listProjects(): ProjectItem[] {
    const byKey = new Map<string, ProjectItem>()
    for (const t of listTranscripts()) {
      const key = t.cwd ? normalizeDir(t.cwd) : `dir:${t.projectDir}`
      const name = t.cwd ? path.basename(t.cwd.replace(/[\\/]+$/, '')) || t.cwd : t.projectDir
      const p = byKey.get(key) ?? { cwd: t.cwd, projectDir: t.projectDir, name, conversations: 0, lastActivityAt: 0 }
      p.conversations++
      p.lastActivityAt = Math.max(p.lastActivityAt, t.lastActivityAt)
      byKey.set(key, p)
    }
    saveHistoryCache()
    return [...byKey.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }

  setFavorite(cliSessionId: string, favorite: boolean): void {
    const set = new Set(this.s.favorites)
    if (favorite) set.add(cliSessionId)
    else set.delete(cliSessionId)
    this.s.favorites = [...set]
    saveStateSoon(this.s)
  }

  async exportMarkdown(cliSessionId: string): Promise<{ markdown: string; fileName: string } | undefined> {
    const t = listTranscripts().find((x) => x.cliSessionId === cliSessionId)
    if (!t) return undefined
    const title = this.titleFor(cliSessionId) ?? t.title ?? t.firstPrompt ?? cliSessionId.slice(0, 8)
    const markdown = await transcriptToMarkdown(t.file, {
      title,
      cliSessionId,
      cwd: t.cwd,
      createdAt: t.createdAt,
      lastActivityAt: t.lastActivityAt,
      lang: this.settings.language,
      timeZone: this.settings.timezone
    })
    return { markdown, fileName: safeFileName(title) }
  }

  // ---------------------------------------------------------------- statistics

  /** Name of a row in the statistics: the account's nickname or email (or what the ledger remembers), an organization's name, or "其他". */
  private accountLabel = (id: string): AccountLabel => {
    if (!id) return { label: this.t('stats.other'), kind: 'unknown' }
    if (id.startsWith('org:')) {
      const org = id.slice(4)
      return { label: this.s.orgLabels[org] || this.orgDefaultName(org), kind: 'org', orgUuid: org }
    }
    const a = this.s.accounts.find((x) => x.id === id)
    if (a) return { label: accountName(a), email: a.email, kind: 'account' }
    const kept = this.ledger.account(id)
    return { label: kept?.nickname || kept?.email || id.slice(0, 8), email: kept?.email, kind: 'account' }
  }

  async getStats(query: StatsQuery): Promise<UsageStats> {
    // Right after the first start the transcripts are still being read (about 10 s for a month); wait for it.
    if (!this.scanner.complete) await this.refreshEstimates()
    const accountId = query.accountId ?? 'all'
    const key = `${query.range}|${accountId}|${this.settings.timezone}|${this.settings.language}`
    const hit = this.statsCache.get(key)
    if (hit && hit.revision === this.ledger.revision && Date.now() - hit.at < MIN) return hit.value
    const titles = new Map<string, TranscriptMeta>()
    for (const t of listTranscripts()) titles.set(t.cliSessionId, t)
    const desktopTitles = new Map<string, { title?: string; cwd?: string }>()
    for (const f of this.folders) for (const s of readSessions(f)) if (s.cliSessionId && !desktopTitles.has(s.cliSessionId)) desktopTitles.set(s.cliSessionId, { title: s.title, cwd: s.cwd })
    const value = computeStats(this.ledger.entries(), {
      range: query.range,
      accountId,
      now: Date.now(),
      timeZone: this.settings.timezone,
      accountOf: this.ledgerRows(),
      accountLabel: this.accountLabel,
      session: (id) => {
        const t = titles.get(id)
        const d = desktopTitles.get(id)
        const kept = this.ledger.session(id)
        return {
          title: d?.title ?? t?.title ?? t?.firstPrompt ?? kept?.title,
          cwd: t?.cwd ?? d?.cwd ?? kept?.cwd,
          projectDir: t?.projectDir ?? kept?.projectDir ?? this.scanner.projectOf(id),
          lastActivityAt: t?.lastActivityAt
        }
      },
      partial: !this.scanner.complete,
      note: this.t('stats.note', { date: PRICE_LIST_DATE })
    })
    saveHistoryCache()
    if (!value.partial) this.statsCache.set(key, { at: Date.now(), revision: this.ledger.revision, value })
    return value
  }

  async ledgerCsv(query: StatsQuery): Promise<{ csv: string; fileName: string }> {
    if (!this.scanner.complete) await this.refreshEstimates()
    const csv = ledgerCsv(
      this.ledger.entries(),
      { range: query.range, accountId: query.accountId ?? 'all', now: Date.now(), timeZone: this.settings.timezone, accountOf: this.ledgerRows(), accountLabel: this.accountLabel },
      this.t('csv.header').split('|')
    )
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: resolveTimeZone(this.settings.timezone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now())
    return { csv, fileName: this.t('csv.fileName', { day }) }
  }

  // ---------------------------------------------------------------- one-click setup

  async getSetupStatus(): Promise<SetupStatus> {
    this.cli = await findClaude(true)
    const st = this.getState()
    const main = this.s.accounts.find((a) => a.usesDefaultCliDir)
    const current = this.s.accounts.find((a) => a.accountUuid && a.accountUuid === this.desktopCurrent.accountUuid)
    const checks = buildChecks({
      lang: this.settings.language,
      platform: process.platform,
      desktopInstalled: desktopAppInstalled(),
      desktopDataFound: !!this.desktopDir,
      desktopSignedIn: !!this.desktopCurrent.accountUuid || this.samples.length > 0,
      desktopAccountName: current ? accountName(current) : undefined,
      cli: this.cli,
      gitBash: integration.gitBashAvailable(),
      mainInList: main ? { name: accountName(main), plan: main.plan?.label } : undefined,
      mainCandidate: st.defaultCliCandidate?.email,
      accountCount: this.s.accounts.length,
      hooks: st.integration.hooksInstalled,
      statusLine: st.integration.statusLineInstalled,
      statusLineConflict: st.integration.statusLineConflict,
      openAtLogin: this.settings.openAtLogin
    })
    return { checks, ready: isReady(checks), needsSetup: st.needsSetup, running: this.setupRunning }
  }

  /** Every fixable step, in order. Started only from the setup button. */
  async runSetup(opts: SetupOptions): Promise<string> {
    const runId = crypto.randomBytes(6).toString('hex')
    const send = (p: Omit<SetupProgress, 'runId'>) => this.emit('setup-progress', { runId, ...p } satisfies SetupProgress)
    if (this.setupRunning) {
      setImmediate(() => send({ phase: 'done', ok: false, message: this.t('setup.busy') }))
      return runId
    }
    this.setupRunning = true
    void (async () => {
      let ok = true
      const step = async (id: SetupCheckId, run: () => Promise<{ phase: 'ok' | 'failed' | 'skipped'; message?: string }>) => {
        try {
          const r = await run()
          if (r.phase === 'failed') ok = false
          send({ step: id, ...r })
        } catch (e) {
          ok = false
          send({ step: id, phase: 'failed', message: (e as Error).message })
        }
      }
      try {
        await step('cli', async () => {
          this.cli = await findClaude(true)
          if (this.cli.found) return { phase: 'skipped', message: this.t('setup.skipped') }
          if (!opts.installCli) return { phase: 'skipped' }
          send({ step: 'cli', phase: 'running', message: this.t('setup.cliInstalling') })
          const r = await installClaudeCode((line) => send({ step: 'cli', phase: 'running', message: line.slice(0, 300) }), {
            env: envForConfigDir(undefined),
            runner: this.opts.runCommand
          })
          if (!r.ok) return { phase: 'failed', message: this.t('setup.cliFailed', { error: r.error ?? '?' }) }
          this.cli = await findClaude(true)
          return this.cli.found
            ? { phase: 'ok', message: this.t('setup.cliInstalled', { v: this.cli.version ?? '' }).trim() }
            : { phase: 'failed', message: this.t('setup.cliNotFoundAfter') }
        })
        await step('main-account', async () => {
          if (!this.defaultCandidate()) return { phase: 'skipped', message: this.t('setup.skipped') }
          await this.adoptDefaultCli()
          const main = this.s.accounts.find((a) => a.usesDefaultCliDir)
          return { phase: 'ok', message: main ? this.t('setup.mainAdded', { name: accountName(main) }) : undefined }
        })
        await step('integration', async () => {
          const cur = this.getState().integration
          if (!opts.connectIntegration) return { phase: 'skipped' }
          if (cur.hooksInstalled && (cur.statusLineInstalled || cur.statusLineConflict)) return { phase: 'skipped', message: this.t('setup.skipped') }
          const r = this.installIntegration({ hooks: true, statusLine: true, replaceStatusLine: false })
          return { phase: r.hooksInstalled ? 'ok' : 'failed', message: r.statusLineInstalled ? this.t('setup.integrationDone') : this.t('setup.integrationHooksOnly') }
        })
        await step('open-at-login', async () => {
          if (!opts.openAtLogin || this.settings.openAtLogin) return { phase: 'skipped' }
          await this.updateSettings({ openAtLogin: true })
          return { phase: 'ok', message: this.t('setup.loginDone') }
        })
      } finally {
        this.setupRunning = false
      }
      if (ok) this.s.setupDismissedAt = Date.now()
      saveStateNow(this.s)
      this.emitState()
      send({ phase: 'done', ok, status: await this.getSetupStatus() })
    })()
    return runId
  }

  dismissSetup(): void {
    this.s.setupDismissedAt = Date.now()
    saveStateSoon(this.s)
    this.emitState()
  }

  // ---------------------------------------------------------------- updates

  /** Look for a newer release. Without `force`, respects the setting and checks at most every 12 hours. */
  async checkForUpdates(force: boolean): Promise<UpdateInfo> {
    const cached = this.s.update
    const current = this.opts.appVersion
    if (!force && (!this.settings.autoCheckUpdates || (cached && Date.now() - (cached.checkedAt ?? 0) < UPDATE_EVERY))) {
      return cached ?? { current, available: false }
    }
    if (this.updateChecking) return this.updateChecking
    this.updateChecking = (async () => {
      try {
        const rel = await (this.opts.fetchRelease ?? fetchLatestRelease)(current)
        const info: UpdateInfo = {
          current,
          latest: rel.version,
          available: compareVersions(rel.version, current) > 0,
          url: rel.url,
          notes: rel.notes,
          publishedAt: rel.publishedAt,
          checkedAt: Date.now()
        }
        this.s.update = info
        if (info.available && this.s.updateNotified !== rel.version) {
          this.s.updateNotified = rel.version
          const title = this.t('updateAvailable', { v: rel.version })
          this.addEvent('info', title, rel.url)
          this.opts.notify({ kind: 'info', title, body: this.t('updateBody'), action: { type: 'navigate', page: 'about' } })
        }
        saveStateSoon(this.s)
        this.emitStateSoon()
        return info
      } catch (e) {
        // Offline or GitHub unreachable: say nothing, try again later.
        console.warn('[quotadeck] update check failed:', (e as Error).message)
        const info: UpdateInfo = { ...(cached ?? { current, available: false }), current, checkedAt: Date.now() }
        this.s.update = info
        return info
      } finally {
        this.updateChecking = undefined
      }
    })()
    return this.updateChecking
  }

  runMergeNow(): MergeStatus {
    this.readDesktop()
    this.runMerge(true)
    return this.getState().merge
  }

  async undoMergeNow(): Promise<MergeStatus> {
    const r = await undoMerge(this.s.manifest, this.opts.trash)
    this.s.manifest.folderBackups = {}
    this.addEvent('merge', this.t('mergeUndone'), this.t('mergeUndoneDetail', { removed: r.removed, restored: r.restored, kept: r.kept }))
    saveStateNow(this.s)
    this.readDesktop()
    this.emitState()
    return this.getState().merge
  }

  private integrationConfig(): integration.IntegrationConfig {
    return { port: this.server?.port ?? this.settings.serverPort, key: this.s.integration.key }
  }

  installIntegration(opts: { hooks: boolean; statusLine: boolean; replaceStatusLine?: boolean }): IntegrationStatus {
    const r = integration.install(this.integrationConfig(), opts)
    if (r.replacedStatusLine) this.s.integration.savedStatusLine = r.replacedStatusLine
    const parts = [opts.hooks && this.t('integrationDetailHooks'), opts.statusLine && !r.statusLineConflict && this.t('integrationDetailStatus')].filter(Boolean)
    this.addEvent('integration', this.t('integrationInstalled'), parts.join(' · '))
    saveStateNow(this.s)
    this.emitState()
    return this.getState().integration
  }

  uninstallIntegration(): IntegrationStatus {
    integration.uninstall(this.s.integration.savedStatusLine)
    this.s.integration.savedStatusLine = undefined
    this.addEvent('integration', this.t('integrationRemoved'))
    saveStateNow(this.s)
    this.emitState()
    return this.getState().integration
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const prevPort = this.settings.serverPort
    const prevLang = this.settings.language
    this.s.settings = { ...this.settings, ...sanitizeSettings(patch) }
    if (this.settings.language !== prevLang && this.settings.continuePrompt === DEFAULT_CONTINUE_PROMPT[prevLang]) {
      this.s.settings.continuePrompt = DEFAULT_CONTINUE_PROMPT[this.settings.language]
    }
    if (patch.serverPort && patch.serverPort !== prevPort) {
      await this.server?.close()
      await this.startServer()
      const p = integration.probe({ port: prevPort, key: this.s.integration.key })
      if (p.hooksInstalled || p.statusLineInstalled) integration.install(this.integrationConfig(), { hooks: p.hooksInstalled, statusLine: p.statusLineInstalled })
    }
    if (patch.desktopDataDirOverride !== undefined) this.readDesktop()
    saveStateNow(this.s)
    this.evaluate(true)
    this.emitState()
  }

  clearEvents(): void {
    this.s.events = []
    saveStateSoon(this.s)
    this.emitState()
  }

  addEvent(type: ActivityType, title: string, detail?: string, accountId?: string, cliSessionId?: string, cwd?: string): void {
    const ev: ActivityEvent = { id: crypto.randomBytes(6).toString('hex'), at: Date.now(), type, title, detail, accountId, cliSessionId, cwd }
    this.s.events.unshift(ev)
    if (this.s.events.length > 300) this.s.events.length = 300
    saveStateSoon(this.s)
  }
}

/** A folder path in a form two spellings of the same folder agree on. */
function normalizeDir(p: string): string {
  return p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
}

function sanitizeSettings(p: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = { ...p }
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))
  if (out.warnAt !== undefined) out.warnAt = clamp(out.warnAt, 10, 99)
  if (out.criticalAt !== undefined) out.criticalAt = clamp(out.criticalAt, 11, 100)
  if (out.serverPort !== undefined) out.serverPort = clamp(out.serverPort, 1024, 65535)
  if (out.soundVolume !== undefined) out.soundVolume = Math.min(1, Math.max(0, out.soundVolume))
  if (out.continuePrompt !== undefined) out.continuePrompt = out.continuePrompt.slice(0, 500)
  if (out.desktopDataDirOverride === '') out.desktopDataDirOverride = undefined
  return out
}
