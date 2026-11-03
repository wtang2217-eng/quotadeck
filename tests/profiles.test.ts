import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile, repairLinks } from '../src/main/core/profiles'

let dir: string
let main: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-prof-'))
  main = path.join(dir, 'main-claude')
  fs.mkdirSync(path.join(main, 'projects', 'p1'), { recursive: true })
  fs.writeFileSync(path.join(main, 'projects', 'p1', 's.jsonl'), '{}\n')
  fs.writeFileSync(path.join(main, 'settings.json'), '{"a":1}')
  fs.writeFileSync(path.join(main, 'CLAUDE.md'), '# memory')
  fs.writeFileSync(path.join(main, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', oauthAccount: { accountUuid: 'x' }, projects: { 'D:/p': { hasTrustDialogAccepted: true, history: [1] } } }))
  process.env.QUOTADECK_CLAUDE_DIR = main
  process.env.QUOTADECK_HOME = path.join(dir, 'qd')
})
afterEach(() => {
  delete process.env.QUOTADECK_CLAUDE_DIR
  delete process.env.QUOTADECK_HOME
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('profiles', () => {
  it('links history and settings, and seeds the config without the sign-in', () => {
    const profile = path.join(dir, 'profile')
    const report = createProfile(profile)
    expect(report.problems).toEqual([])
    expect(fs.readFileSync(path.join(profile, 'projects', 'p1', 's.jsonl'), 'utf8')).toBe('{}\n')
    expect(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).toBe('{"a":1}')
    const seeded = JSON.parse(fs.readFileSync(path.join(profile, '.claude.json'), 'utf8'))
    expect(seeded.oauthAccount).toBeUndefined()
    expect(seeded.theme).toBe('dark')
    expect(seeded.projects['D:/p']).toEqual({ hasTrustDialogAccepted: true })
    // New files in the shared folder show up in the profile.
    fs.writeFileSync(path.join(main, 'projects', 'p1', 't.jsonl'), 'x')
    expect(fs.existsSync(path.join(profile, 'projects', 'p1', 't.jsonl'))).toBe(true)
  })

  it('re-joins a settings file that an editor replaced', () => {
    const profile = path.join(dir, 'profile')
    createProfile(profile)
    // Simulate an atomic save in the profile: the link becomes a separate, newer file.
    const p = path.join(profile, 'settings.json')
    fs.rmSync(p)
    fs.writeFileSync(p, '{"a":2}')
    const future = new Date(Date.now() + 5000)
    fs.utimesSync(p, future, future)
    const report = repairLinks(profile)
    expect(report.repaired).toContain('settings.json')
    expect(fs.readFileSync(path.join(main, 'settings.json'), 'utf8')).toBe('{"a":2}')
    fs.writeFileSync(path.join(main, 'settings.json'), '{"a":3}')
    expect(fs.readFileSync(p, 'utf8')).toBe('{"a":3}')
  })
})
