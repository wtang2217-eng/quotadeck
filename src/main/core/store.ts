// QuotaDeck's own state, kept in ~/.quotadeck/state.json. It never contains credentials.

import crypto from 'node:crypto'
import { defaultSettings } from '@shared/defaults'
import type { Account, ActivityEvent, AppState, LimitInfo, Settings, UsageSnapshot } from '@shared/types'
import { readJson, writeJsonAtomic } from './jsonfile'
import { emptyManifest, type MergeManifest } from './merge'
import { qdPaths } from './paths'

export interface HookSignal {
  at: number
  accountUuid?: string
  orgUuid?: string
  email?: string
  entrypoint?: string
}

export interface PersistedState {
  version: 1
  settings: Settings
  accounts: Account[]
  /** Latest usage reported by the status line of terminal sessions, per account id. */
  terminalUsage: Record<string, UsageSnapshot>
  /** Active limits per account id. */
  limits: Record<string, LimitInfo>
  events: ActivityEvent[]
  manifest: MergeManifest
  merge: { lastRunAt?: number; lastCopied: number; error?: string }
  integration: {
    /** Shared secret between Claude Code's hook/status line and QuotaDeck's local server. */
    key: string
    /** A status line QuotaDeck replaced, restored on uninstall. */
    savedStatusLine?: unknown
  }
  /** Recent StopFailure calls from desktop sessions, used to tell which account the app is signed in with. */
  hookSignals: HookSignal[]
  /** Thresholds already announced, per account id and window, so each fires once. */
  thresholds: Record<string, { fh?: number; sd?: number }>
  lastInterrupted?: AppState['lastInterrupted']
  /** Last daily `claude auth status` sweep. */
  lastLoginCheckAt?: number
  /** Sessions QuotaDeck opened in a terminal, and as which account. */
  sessionAccounts: Record<string, { accountId: string; at: number }>
}

export function freshState(locale: string): PersistedState {
  return {
    version: 1,
    settings: defaultSettings(locale),
    accounts: [],
    terminalUsage: {},
    limits: {},
    events: [],
    manifest: emptyManifest(),
    merge: { lastCopied: 0 },
    integration: { key: crypto.randomBytes(18).toString('base64url') },
    hookSignals: [],
    thresholds: {},
    sessionAccounts: {}
  }
}

export function loadState(locale: string): PersistedState {
  const base = freshState(locale)
  const saved = readJson<Partial<PersistedState>>(qdPaths().state)
  if (!saved || saved.version !== 1) return base
  return {
    ...base,
    ...saved,
    settings: { ...base.settings, ...saved.settings },
    manifest: { ...emptyManifest(), ...saved.manifest },
    merge: { ...base.merge, ...saved.merge },
    integration: { ...base.integration, ...saved.integration },
    accounts: saved.accounts ?? [],
    terminalUsage: saved.terminalUsage ?? {},
    limits: saved.limits ?? {},
    events: saved.events ?? [],
    hookSignals: saved.hookSignals ?? [],
    thresholds: saved.thresholds ?? {},
    sessionAccounts: saved.sessionAccounts ?? {}
  }
}

let timer: NodeJS.Timeout | undefined

/** Save soon (coalesces bursts, e.g. status line updates). */
export function saveStateSoon(state: PersistedState, delayMs = 1500): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    saveStateNow(state)
  }, delayMs)
}

export function saveStateNow(state: PersistedState): void {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
  writeJsonAtomic(qdPaths().state, state)
}
