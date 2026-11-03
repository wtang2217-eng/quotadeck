// Keeps the desktop Code tab's conversation lists of your own accounts merged, so that after you sign
// in with another account the same conversations are still in the sidebar and can be continued.
//
// Rules, chosen to be safe while the desktop app is running:
//   - Only files named local_<uuid>.json are copied, only between folders of accounts you added.
//   - Nothing is ever deleted. A conversation you deleted in one account (deleted_<uuid> marker) is not
//     copied back into that account.
//   - The folder of the account the app is signed in with is never written, and neither is any folder
//     the app touched in the last few minutes.
//   - Every folder is backed up before its first change; every replaced file is backed up too.
//   - A manifest records what QuotaDeck wrote, so the merge can be undone.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { deletedIds, readSessionFile, sessionFileNames, type AccountFolder, type DesktopSession } from './desktop'
import { exists, mtime, normalize } from './paths'

export interface ManifestEntry {
  dest: string
  source: string
  sessionId: string
  hash: string
  writtenAt: number
  /** mtime of dest right after the copy, to tell our writes from the app's. */
  destMtime: number
  /** A previous version of dest was replaced; its backup is here. */
  backup?: string
}

export interface MergeManifest {
  entries: Record<string, ManifestEntry>
  /** Folder → backup made before QuotaDeck first wrote to it. */
  folderBackups: Record<string, string>
  totalCopied: number
}

export function emptyManifest(): MergeManifest {
  return { entries: {}, folderBackups: {}, totalCopied: 0 }
}

export interface MergeOptions {
  /** Folders of your accounts. A folder that does not exist yet is created when something is copied into it. */
  ownFolders: AccountFolder[]
  /** Account the desktop app is signed in with. Its folder is never written. */
  currentAccountUuid?: string
  manifest: MergeManifest
  backupsRoot: string
  now?: number
  /** Write only into this account's folder (used right before switching to it). */
  onlyTargetAccountUuid?: string
  /** A folder whose files the app changed within this window counts as in use. Default 10 minutes. */
  activeWindowMs?: number
}

export interface MergeResult {
  copied: number
  updated: number
  /** Folders skipped because the app is using them. */
  skipped: string[]
  errors: string[]
}

function sha1(file: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
}

function activity(s: DesktopSession): number {
  return s.lastActivityAt ?? s.mtimeMs
}

function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}

/** The app changed a file in this folder recently (and it was not QuotaDeck's own copy). */
export function folderInUse(folder: AccountFolder, manifest: MergeManifest, now: number, windowMs: number): boolean {
  for (const name of sessionFileNames(folder.dir)) {
    const file = path.join(folder.dir, name)
    const m = mtime(file)
    if (now - m > windowMs) continue
    const ours = manifest.entries[normalize(file)]
    if (ours && Math.abs(ours.destMtime - m) < 2000) continue
    return true
  }
  return false
}

export function mergeDesktopSessions(opts: MergeOptions): MergeResult {
  const now = opts.now ?? Date.now()
  const windowMs = opts.activeWindowMs ?? 10 * 60_000
  const result: MergeResult = { copied: 0, updated: 0, skipped: [], errors: [] }

  // Newest version of every conversation across your folders.
  const latest = new Map<string, { session: DesktopSession; folder: AccountFolder }>()
  for (const folder of opts.ownFolders) {
    for (const name of sessionFileNames(folder.dir)) {
      const s = readSessionFile(path.join(folder.dir, name), folder.accountUuid, folder.orgUuid)
      if (!s) continue
      const key = name.toLowerCase()
      const prev = latest.get(key)
      if (!prev || activity(s) > activity(prev.session)) latest.set(key, { session: s, folder })
    }
  }

  for (const target of opts.ownFolders) {
    if (opts.onlyTargetAccountUuid && target.accountUuid !== opts.onlyTargetAccountUuid) continue
    if (opts.currentAccountUuid && target.accountUuid === opts.currentAccountUuid) continue
    if (exists(target.dir) && folderInUse(target, opts.manifest, now, windowMs)) {
      result.skipped.push(target.dir)
      continue
    }
    const deleted = deletedIds(target.dir)
    for (const [name, { session, folder }] of latest) {
      if (folder.dir === target.dir) continue
      const id = name.replace(/^local_/, '').replace(/\.json$/, '')
      if (deleted.has(id)) continue
      const dest = path.join(target.dir, path.basename(session.file))
      try {
        const existing = exists(dest) ? readSessionFile(dest, target.accountUuid, target.orgUuid) : undefined
        if (existing && activity(existing) >= activity(session)) continue
        backupFolderOnce(target, opts.manifest, opts.backupsRoot, now)
        let backup: string | undefined
        if (existing) {
          const dir = path.join(opts.backupsRoot, 'desktop-sessions', 'replaced')
          fs.mkdirSync(dir, { recursive: true })
          backup = path.join(dir, `${stamp(now)}-${target.accountUuid.slice(0, 8)}-${path.basename(dest)}`)
          fs.copyFileSync(dest, backup)
        }
        fs.mkdirSync(target.dir, { recursive: true })
        fs.copyFileSync(session.file, dest)
        opts.manifest.entries[normalize(dest)] = {
          dest,
          source: session.file,
          sessionId: session.sessionId,
          hash: sha1(dest),
          writtenAt: now,
          destMtime: mtime(dest),
          backup: backup ?? opts.manifest.entries[normalize(dest)]?.backup
        }
        if (existing) result.updated++
        else result.copied++
      } catch (e) {
        result.errors.push(`${path.basename(dest)}: ${(e as Error).message}`)
      }
    }
  }
  opts.manifest.totalCopied += result.copied
  return result
}

function backupFolderOnce(folder: AccountFolder, manifest: MergeManifest, backupsRoot: string, now: number): void {
  const key = normalize(folder.dir)
  if (manifest.folderBackups[key]) return
  const dest = path.join(backupsRoot, 'desktop-sessions', stamp(now), folder.accountUuid, folder.orgUuid)
  fs.mkdirSync(dest, { recursive: true })
  if (exists(folder.dir)) fs.cpSync(folder.dir, dest, { recursive: true, preserveTimestamps: true })
  manifest.folderBackups[key] = dest
}

export interface UndoResult {
  removed: number
  restored: number
  kept: number
  errors: string[]
}

/**
 * Undo QuotaDeck's copies. A copy that is unchanged since it was written goes to the recycle bin (via
 * `trash`); a replaced file gets its backup back. Copies the app has changed since are kept.
 */
export async function undoMerge(manifest: MergeManifest, trash: (file: string) => Promise<void>): Promise<UndoResult> {
  const result: UndoResult = { removed: 0, restored: 0, kept: 0, errors: [] }
  for (const [key, entry] of Object.entries(manifest.entries)) {
    try {
      if (!exists(entry.dest)) {
        delete manifest.entries[key]
        continue
      }
      if (sha1(entry.dest) !== entry.hash) {
        result.kept++
        delete manifest.entries[key]
        continue
      }
      if (entry.backup && exists(entry.backup)) {
        fs.copyFileSync(entry.backup, entry.dest)
        result.restored++
      } else {
        await trash(entry.dest)
        result.removed++
      }
      delete manifest.entries[key]
    } catch (e) {
      result.errors.push(`${path.basename(entry.dest)}: ${(e as Error).message}`)
    }
  }
  return result
}
