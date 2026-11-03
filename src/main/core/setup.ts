// One-click setup: what QuotaDeck needs on this computer, and the official installer for Claude Code.
// Checks only look at files and settings; nothing is installed or changed until the user presses the button.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { CliInfo, Language, SetupCheck, SetupCheckId } from '@shared/types'
import { tr } from '../i18n'
import { HOME, safeReaddir } from './paths'

export const DESKTOP_DOWNLOAD = 'https://claude.ai/download'
export const GIT_DOWNLOAD = 'https://git-scm.com/downloads/win'

/** Everything the checklist is built from; gathered by the engine so this module stays pure. */
export interface SetupFacts {
  lang: Language
  platform: NodeJS.Platform
  desktopInstalled: boolean
  desktopDataFound: boolean
  /** Name of the account the desktop app is signed in with, when known. */
  desktopAccountName?: string
  desktopSignedIn: boolean
  cli: CliInfo
  /** Windows only: Git for Windows (Git Bash) is installed. */
  gitBash: boolean
  /** Name and plan of the account that already stands for ~/.claude, when it is in the list. */
  mainInList?: { name: string; plan?: string }
  /** Email of the account signed in at ~/.claude that is not in the list yet. */
  mainCandidate?: string
  accountCount: number
  hooks: boolean
  statusLine: boolean
  /** Another tool's status line, which is kept. */
  statusLineConflict?: string
  openAtLogin: boolean
}

/** The desktop app's files exist on this computer, whether or not it was opened yet. */
export function desktopAppInstalled(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = HOME): boolean {
  const has = (p: string | undefined) => {
    try {
      return !!p && fs.existsSync(p)
    } catch {
      return false
    }
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    if (has(path.join(local, 'AnthropicClaude', 'claude.exe'))) return true
    if (has(path.join(local, 'Microsoft', 'WindowsApps', 'claude-desktop.exe'))) return true
    return safeReaddir(path.join(local, 'Packages')).some((n) => /^Claude_[a-z0-9]+$/i.test(n))
  }
  if (platform === 'darwin') return has('/Applications/Claude.app') || has(path.join(home, 'Applications', 'Claude.app'))
  return ['/usr/bin/claude-desktop', '/opt/Claude/claude-desktop', path.join(home, '.local', 'bin', 'claude-desktop')].some(has)
}

export function buildChecks(f: SetupFacts): SetupCheck[] {
  const t = (key: Parameters<typeof tr>[1], vars?: Record<string, string | number>) => tr(f.lang, key, vars)
  const checks: SetupCheck[] = []
  const add = (c: SetupCheck) => checks.push(c)
  const installed = f.desktopInstalled || f.desktopDataFound

  add(
    installed
      ? { id: 'desktop-installed', state: 'ok', optional: false, title: t('setup.desktop'), detail: t('setup.desktopOk') }
      : { id: 'desktop-installed', state: 'manual', optional: false, action: 'download-desktop', url: DESKTOP_DOWNLOAD, title: t('setup.desktop'), detail: t('setup.desktopMissing') }
  )
  add(
    f.desktopSignedIn
      ? {
          id: 'desktop-signed-in',
          state: 'ok',
          optional: false,
          title: t('setup.desktopLogin'),
          detail: f.desktopAccountName ? t('setup.desktopLoginAs', { name: f.desktopAccountName }) : t('setup.desktopLoginOk')
        }
      : { id: 'desktop-signed-in', state: 'manual', optional: false, action: 'open-desktop', title: t('setup.desktopLogin'), detail: t('setup.desktopLoginMissing') }
  )
  add(
    f.cli.found
      ? { id: 'cli', state: 'ok', optional: false, title: t('setup.cli'), detail: f.cli.version ? t('setup.cliVersion', { v: f.cli.version }) : t('setup.cliOk') }
      : { id: 'cli', state: 'fixable', optional: false, action: 'install-cli', title: t('setup.cli'), detail: t('setup.cliMissing') }
  )
  if (f.platform === 'win32') {
    add(
      f.gitBash
        ? { id: 'git-bash', state: 'ok', optional: true, title: 'Git for Windows', detail: t('setup.gitOk') }
        : { id: 'git-bash', state: 'manual', optional: true, action: 'download-git', url: GIT_DOWNLOAD, title: 'Git for Windows', detail: t('setup.gitMissing') }
    )
  }
  if (f.mainInList) {
    add({ id: 'main-account', state: 'ok', optional: false, title: t('setup.main'), detail: t('setup.mainOk', { name: f.mainInList.name, plan: f.mainInList.plan ?? '?' }) })
  } else if (f.mainCandidate) {
    add({ id: 'main-account', state: 'fixable', optional: false, action: 'adopt-main', title: t('setup.main'), detail: t('setup.mainFound', { email: f.mainCandidate }) })
  } else if (f.accountCount > 0) {
    add({ id: 'main-account', state: 'ok', optional: false, title: t('setup.main'), detail: t('setup.mainSome', { n: f.accountCount }) })
  } else {
    add({ id: 'main-account', state: 'manual', optional: false, action: 'add-account', title: t('setup.main'), detail: t('setup.mainNone') })
  }
  if (f.hooks && (f.statusLine || f.statusLineConflict)) {
    add({ id: 'integration', state: 'ok', optional: false, title: t('setup.integration'), detail: f.statusLine ? t('setup.integrationOk') : t('setup.integrationHooksOnly') })
  } else {
    add({ id: 'integration', state: 'fixable', optional: false, action: 'connect', title: t('setup.integration'), detail: t('setup.integrationMissing') })
  }
  add(
    f.openAtLogin
      ? { id: 'open-at-login', state: 'ok', optional: true, title: t('setup.login'), detail: t('setup.loginOk') }
      : { id: 'open-at-login', state: 'fixable', optional: true, action: 'open-at-login', title: t('setup.login'), detail: t('setup.loginMissing') }
  )
  return checks
}

export function isReady(checks: SetupCheck[]): boolean {
  return checks.every((c) => c.optional || c.state === 'ok')
}

export function checkState(checks: SetupCheck[], id: SetupCheckId): SetupCheck | undefined {
  return checks.find((c) => c.id === id)
}

/** The official native installer, as documented at code.claude.com/docs/en/setup. */
export function installerCommand(platform: NodeJS.Platform = process.platform): { file: string; args: string[] } {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'irm https://claude.ai/install.ps1 | iex'] }
  return { file: '/bin/bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] }
}

export interface CommandRunner {
  (file: string, args: string[], env: NodeJS.ProcessEnv, onLine: (line: string) => void, timeoutMs: number): Promise<{ code: number | null; error?: string }>
}

/** Runs a command without a window and reports its output line by line. */
export const spawnRunner: CommandRunner = (file, args, env, onLine, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false
    const done = (r: { code: number | null; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ code: null, error: (e as Error).message })
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      done({ code: null, error: `timeout after ${Math.round(timeoutMs / 1000)}s` })
    }, timeoutMs)
    let carry = ''
    const feed = (chunk: Buffer) => {
      const text = carry + chunk.toString()
      const lines = text.split(/\r?\n|\r/)
      carry = lines.pop() ?? ''
      for (const l of lines) {
        const clean = l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()
        if (clean) onLine(clean)
      }
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.on('error', (e) => done({ code: null, error: e.message }))
    child.on('close', (code) => {
      const last = carry.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()
      if (last) onLine(last)
      done({ code })
    })
  })

/** Install Claude Code with the official script. Only ever called after the user pressed the setup button. */
export async function installClaudeCode(
  onLine: (line: string) => void,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; runner?: CommandRunner; timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string }> {
  const { file, args } = installerCommand(opts.platform)
  const r = await (opts.runner ?? spawnRunner)(file, args, opts.env ?? process.env, onLine, opts.timeoutMs ?? 10 * 60_000)
  if (r.error) return { ok: false, error: r.error }
  return r.code === 0 ? { ok: true } : { ok: false, error: `exit code ${r.code}` }
}

/** Where the native installer puts the launcher, so it can be found before PATH is refreshed. */
export function installedCliPath(platform: NodeJS.Platform = process.platform, home = HOME): string {
  return platform === 'win32' ? path.join(home, '.local', 'bin', 'claude.exe') : path.join(home, '.local', 'bin', 'claude')
}
