import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildChecks, desktopAppInstalled, installClaudeCode, installerCommand, isReady, type SetupFacts } from '../src/main/core/setup'

const base: SetupFacts = {
  lang: 'zh-CN',
  platform: 'win32',
  desktopInstalled: true,
  desktopDataFound: true,
  desktopSignedIn: true,
  desktopAccountName: '副号',
  cli: { found: true, path: 'C:\\Users\\a\\.local\\bin\\claude.exe', version: '2.1.283' },
  gitBash: true,
  mainInList: { name: '主号', plan: 'Max 5x' },
  accountCount: 2,
  hooks: true,
  statusLine: true,
  openAtLogin: false
}

const state = (f: SetupFacts) => Object.fromEntries(buildChecks(f).map((c) => [c.id, c.state]))

describe('buildChecks', () => {
  it('is ready when everything required is in place, with the optional login item still offered', () => {
    const checks = buildChecks(base)
    expect(isReady(checks)).toBe(true)
    expect(state(base)).toEqual({
      'desktop-installed': 'ok',
      'desktop-signed-in': 'ok',
      cli: 'ok',
      'git-bash': 'ok',
      'main-account': 'ok',
      integration: 'ok',
      'open-at-login': 'fixable'
    })
    expect(checks.find((c) => c.id === 'desktop-signed-in')?.detail).toContain('副号')
  })

  it('offers the right fix for each missing piece', () => {
    const f: SetupFacts = {
      ...base,
      desktopInstalled: false,
      desktopDataFound: false,
      desktopSignedIn: false,
      cli: { found: false },
      gitBash: false,
      mainInList: undefined,
      mainCandidate: 'alice@example.com',
      accountCount: 0,
      hooks: false,
      statusLine: false
    }
    const checks = buildChecks(f)
    expect(isReady(checks)).toBe(false)
    const by = Object.fromEntries(checks.map((c) => [c.id, c]))
    expect(by['desktop-installed']).toMatchObject({ state: 'manual', action: 'download-desktop', url: 'https://claude.ai/download' })
    expect(by.cli).toMatchObject({ state: 'fixable', action: 'install-cli' })
    expect(by['git-bash']).toMatchObject({ state: 'manual', optional: true, action: 'download-git' })
    expect(by['main-account']).toMatchObject({ state: 'fixable', action: 'adopt-main' })
    expect(by.integration).toMatchObject({ state: 'fixable', action: 'connect' })
  })

  it('asks to add an account when nothing is signed in, and keeps another tool’s status line', () => {
    const f = { ...base, mainInList: undefined, accountCount: 0, statusLine: false, statusLineConflict: 'bash ~/sl.sh' }
    const by = Object.fromEntries(buildChecks(f).map((c) => [c.id, c]))
    expect(by['main-account']).toMatchObject({ state: 'manual', action: 'add-account' })
    expect(by.integration.state).toBe('ok')
    // Git for Windows is only a question on Windows.
    expect(buildChecks({ ...base, platform: 'darwin' }).some((c) => c.id === 'git-bash')).toBe(false)
  })
})

describe('installer', () => {
  it('uses the official install commands', () => {
    expect(installerCommand('win32')).toEqual({ file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'irm https://claude.ai/install.ps1 | iex'] })
    expect(installerCommand('darwin')).toEqual({ file: '/bin/bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] })
  })

  it('reports output lines and the result of the run', async () => {
    const lines: string[] = []
    const ok = await installClaudeCode((l) => lines.push(l), {
      platform: 'darwin',
      runner: async (file, args, _env, onLine) => {
        onLine(`${file} ${args[1]}`)
        return { code: 0 }
      }
    })
    expect(ok).toEqual({ ok: true })
    expect(lines).toEqual(['/bin/bash curl -fsSL https://claude.ai/install.sh | bash'])
    expect(await installClaudeCode(() => {}, { runner: async () => ({ code: 1 }) })).toEqual({ ok: false, error: 'exit code 1' })
    expect(await installClaudeCode(() => {}, { runner: async () => ({ code: null, error: 'timeout after 600s' }) })).toEqual({ ok: false, error: 'timeout after 600s' })
  })
})

describe('desktopAppInstalled', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('finds the Microsoft Store package folder on Windows', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-setup-'))
    expect(desktopAppInstalled('win32', { LOCALAPPDATA: dir }, dir)).toBe(false)
    fs.mkdirSync(path.join(dir, 'Packages', 'Claude_pzs8sxrjxfjjc'), { recursive: true })
    expect(desktopAppInstalled('win32', { LOCALAPPDATA: dir }, dir)).toBe(true)
  })

  it('finds Claude.app in the user’s Applications folder on macOS', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-setup-'))
    fs.mkdirSync(path.join(dir, 'Applications', 'Claude.app'), { recursive: true })
    expect(desktopAppInstalled('darwin', {}, dir)).toBe(true)
  })
})
