// Read-only view of the Claude desktop app's local data. Only two things are read:
//   claude-code-sessions/<accountUuid>/<orgUuid>/local_*.json   the Code tab's conversation list, per account
//   plan-usage-history.json                                     the app's own 5-hour / 7-day usage samples
// Nothing else in the folder is touched (sign-in data, cookies and caches are never opened).

import fs from 'node:fs'
import path from 'node:path'
import { readJson } from './jsonfile'
import { desktopDataDirCandidates, exists, IS_WIN, safeReaddir } from './paths'

export interface AccountFolder {
  accountUuid: string
  orgUuid: string
  dir: string
}

export interface DesktopSession {
  file: string
  accountUuid: string
  orgUuid: string
  /** "local_<uuid>" */
  sessionId: string
  cliSessionId?: string
  title?: string
  cwd?: string
  createdAt?: number
  lastActivityAt?: number
  isArchived?: boolean
  mtimeMs: number
  size: number
}

export interface UsageSample {
  t: number
  org: string
  fh?: number
  sd?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function findDesktopDataDir(override?: string): string | undefined {
  if (override && exists(override)) return override
  return desktopDataDirCandidates()[0]
}

export function sessionsRoot(dataDir: string): string {
  return path.join(dataDir, 'claude-code-sessions')
}

export function accountFolder(dataDir: string, accountUuid: string, orgUuid: string): string {
  return path.join(sessionsRoot(dataDir), accountUuid, orgUuid)
}

export function listAccountFolders(dataDir: string): AccountFolder[] {
  const root = sessionsRoot(dataDir)
  const out: AccountFolder[] = []
  for (const acct of safeReaddir(root)) {
    if (!UUID.test(acct)) continue
    for (const org of safeReaddir(path.join(root, acct))) {
      if (!UUID.test(org)) continue
      out.push({ accountUuid: acct, orgUuid: org, dir: path.join(root, acct, org) })
    }
  }
  return out
}

const sessionCache = new Map<string, { mtimeMs: number; size: number; session: DesktopSession }>()

export function readSessionFile(file: string, accountUuid: string, orgUuid: string): DesktopSession | undefined {
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch {
    return undefined
  }
  const hit = sessionCache.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.session
  const json = readJson<Record<string, unknown>>(file)
  if (!json) return undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const session: DesktopSession = {
    file,
    accountUuid,
    orgUuid,
    sessionId: str(json.sessionId) ?? path.basename(file, '.json'),
    cliSessionId: str(json.cliSessionId),
    title: str(json.title),
    cwd: str(json.cwd),
    createdAt: num(json.createdAt),
    lastActivityAt: num(json.lastActivityAt),
    isArchived: json.isArchived === true,
    mtimeMs: st.mtimeMs,
    size: st.size
  }
  sessionCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, session })
  return session
}

export function sessionFileNames(folderDir: string): string[] {
  return safeReaddir(folderDir).filter((n) => /^local_[0-9a-f-]+\.json$/i.test(n))
}

export function readSessions(folder: AccountFolder): DesktopSession[] {
  const out: DesktopSession[] = []
  for (const name of sessionFileNames(folder.dir)) {
    const s = readSessionFile(path.join(folder.dir, name), folder.accountUuid, folder.orgUuid)
    if (s) out.push(s)
  }
  return out
}

/** Ids the user deleted in this folder ("deleted_<uuid>" markers). */
export function deletedIds(folderDir: string): Set<string> {
  const ids = new Set<string>()
  for (const n of safeReaddir(folderDir)) {
    const m = /^deleted_([0-9a-f-]+)$/i.exec(n)
    if (m) ids.add(m[1].toLowerCase())
  }
  return ids
}

export function readUsageSamples(dataDir: string): UsageSample[] {
  const json = readJson<{ samples?: Array<{ t?: number; org?: string; u?: { fh?: number; sd?: number } }> }>(
    path.join(dataDir, 'plan-usage-history.json')
  )
  if (!json?.samples || !Array.isArray(json.samples)) return []
  return json.samples
    .filter((s) => typeof s?.t === 'number' && typeof s?.org === 'string')
    .map((s) => ({ t: s.t!, org: s.org!, fh: numOrUndef(s.u?.fh), sd: numOrUndef(s.u?.sd) }))
    .sort((a, b) => a.t - b.t)
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Is the desktop app running with this data folder? Uses Chromium's profile lock, no process listing. */
export function isDesktopRunning(dataDir: string): boolean {
  if (IS_WIN) {
    const lock = path.join(dataDir, 'lockfile')
    if (!exists(lock)) return false
    try {
      // The running app holds the lock file open for writing without sharing write access, so a
      // second write-open fails with EBUSY. Nothing is ever written; the handle is closed at once.
      fs.closeSync(fs.openSync(lock, 'r+'))
      return false
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EBUSY' || (e as NodeJS.ErrnoException).code === 'EPERM'
    }
  }
  const lock = path.join(dataDir, 'SingletonLock')
  try {
    const target = fs.readlinkSync(lock)
    const pid = Number(/-(\d+)$/.exec(target)?.[1])
    if (!pid) return true
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
