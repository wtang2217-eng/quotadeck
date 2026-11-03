import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountFolder } from '../src/main/core/desktop'
import { emptyManifest, mergeDesktopSessions, undoMerge } from '../src/main/core/merge'

const A = { accountUuid: '11111111-1111-4111-8111-111111111111', orgUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const B = { accountUuid: '22222222-2222-4222-8222-222222222222', orgUuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`

let root: string
let folders: AccountFolder[]
const OLD = Date.now() - 3600_000

function writeSession(folder: AccountFolder, n: number, lastActivityAt: number, title = `s${n}`): string {
  fs.mkdirSync(folder.dir, { recursive: true })
  const file = path.join(folder.dir, `local_${id(n)}.json`)
  fs.writeFileSync(file, JSON.stringify({ sessionId: `local_${id(n)}`, cliSessionId: id(n + 5), title, lastActivityAt }))
  fs.utimesSync(file, new Date(OLD), new Date(OLD))
  return file
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-merge-'))
  folders = [A, B].map((x) => ({ ...x, dir: path.join(root, 'claude-code-sessions', x.accountUuid, x.orgUuid) }))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('mergeDesktopSessions', () => {
  it('copies conversations both ways and backs up first', () => {
    writeSession(folders[0], 1, 100)
    writeSession(folders[1], 2, 200)
    const manifest = emptyManifest()
    const r = mergeDesktopSessions({ ownFolders: folders, manifest, backupsRoot: path.join(root, 'backups') })
    expect(r.copied).toBe(2)
    expect(fs.existsSync(path.join(folders[1].dir, `local_${id(1)}.json`))).toBe(true)
    expect(fs.existsSync(path.join(folders[0].dir, `local_${id(2)}.json`))).toBe(true)
    expect(Object.keys(manifest.folderBackups)).toHaveLength(2)
    // Second run has nothing to do.
    expect(mergeDesktopSessions({ ownFolders: folders, manifest, backupsRoot: path.join(root, 'backups') }).copied).toBe(0)
  })

  it('never writes the current account and creates a missing target folder', () => {
    writeSession(folders[0], 1, 100)
    const r = mergeDesktopSessions({ ownFolders: folders, currentAccountUuid: A.accountUuid, manifest: emptyManifest(), backupsRoot: path.join(root, 'b') })
    expect(r.copied).toBe(1)
    expect(fs.readdirSync(folders[0].dir)).toEqual([`local_${id(1)}.json`])
  })

  it('respects deletions and newer versions', () => {
    writeSession(folders[0], 1, 100)
    writeSession(folders[0], 3, 500, 'new')
    writeSession(folders[1], 3, 300, 'old')
    fs.writeFileSync(path.join(folders[1].dir, `deleted_${id(1)}`), 'deleted')
    const r = mergeDesktopSessions({ ownFolders: folders, manifest: emptyManifest(), backupsRoot: path.join(root, 'b') })
    expect(fs.existsSync(path.join(folders[1].dir, `local_${id(1)}.json`))).toBe(false)
    expect(r.updated).toBe(1)
    expect(JSON.parse(fs.readFileSync(path.join(folders[1].dir, `local_${id(3)}.json`), 'utf8')).title).toBe('new')
  })

  it('skips a folder the app touched a moment ago', () => {
    writeSession(folders[0], 1, 100)
    const busy = writeSession(folders[1], 2, 100)
    fs.utimesSync(busy, new Date(), new Date())
    const r = mergeDesktopSessions({ ownFolders: folders, manifest: emptyManifest(), backupsRoot: path.join(root, 'b') })
    expect(r.skipped).toEqual([folders[1].dir])
  })

  it('undo removes untouched copies and keeps edited ones', async () => {
    writeSession(folders[0], 1, 100)
    writeSession(folders[0], 2, 100)
    const manifest = emptyManifest()
    mergeDesktopSessions({ ownFolders: folders, manifest, backupsRoot: path.join(root, 'b') })
    fs.appendFileSync(path.join(folders[1].dir, `local_${id(2)}.json`), ' ')
    const trashed: string[] = []
    const r = await undoMerge(manifest, async (p) => {
      trashed.push(p)
      fs.rmSync(p)
    })
    expect(r).toMatchObject({ removed: 1, kept: 1 })
    expect(trashed.map((p) => path.basename(p))).toEqual([`local_${id(1)}.json`])
  })
})
