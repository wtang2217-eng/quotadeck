// Opens a new terminal window that runs the official `claude` as a given account, optionally resuming a
// conversation. The command is written to a small script first so paths and Chinese text need no quoting tricks.

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { TerminalChoice } from '@shared/types'
import { exists, HOME, IS_MAC, IS_WIN, qdPaths, samePath } from './paths'

export interface LaunchRequest {
  cliPath?: string
  /** CLAUDE_CONFIG_DIR for the account. The default ~/.claude runs with the variable unset. */
  configDir?: string
  cwd?: string
  resumeId?: string
  /** Id to give a new conversation (`--session-id`), so QuotaDeck knows which account runs it. */
  newSessionId?: string
  prompt?: string
  /** Window title, e.g. "QuotaDeck · Main". */
  title: string
  /** Line printed before Claude Code starts. */
  banner: string
  terminal: TerminalChoice
}

/** Variables a Claude session may have passed to QuotaDeck that must not reach the new terminal. */
const SCRUB = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ACCOUNT_UUID', 'CLAUDE_CODE_ORGANIZATION_UUID', 'CLAUDE_CODE_USER_EMAIL', 'CLAUDE_CODE_OAUTH_SCOPES', 'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_AGENT_SDK_VERSION']

function launchEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of SCRUB) delete env[k]
  delete env.CLAUDE_CONFIG_DIR
  return env
}

function scriptPath(ext: string): string {
  const dir = qdPaths().launch
  fs.mkdirSync(dir, { recursive: true })
  // Keep the folder small: drop scripts older than a day.
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > 86_400_000) fs.rmSync(p, { force: true })
    } catch {
      /* in use */
    }
  }
  return path.join(dir, `launch-${Date.now()}${ext}`)
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

function claudeArgs(req: LaunchRequest): string[] {
  const args: string[] = []
  if (req.resumeId) args.push('--resume', req.resumeId)
  else if (req.newSessionId) args.push('--session-id', req.newSessionId)
  if (req.prompt) args.push(req.prompt)
  return args
}

function useDefaultDir(configDir: string | undefined): boolean {
  return !configDir || samePath(configDir, path.join(HOME, '.claude'))
}

export async function launchInTerminal(req: LaunchRequest): Promise<void> {
  const cwd = req.cwd && exists(req.cwd) ? req.cwd : HOME
  if (IS_WIN) return launchWindows(req, cwd)
  if (IS_MAC) return launchMac(req, cwd)
  return launchLinux(req, cwd)
}

async function launchWindows(req: LaunchRequest, cwd: string): Promise<void> {
  const file = scriptPath('.ps1')
  const exe = req.cliPath && exists(req.cliPath) ? req.cliPath : 'claude'
  const lines = [
    `$Host.UI.RawUI.WindowTitle = ${psQuote(req.title)}`,
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    useDefaultDir(req.configDir) ? 'Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue' : `$env:CLAUDE_CONFIG_DIR = ${psQuote(req.configDir!)}`,
    `Set-Location -LiteralPath ${psQuote(cwd)}`,
    `Write-Host ${psQuote(req.banner)} -ForegroundColor Cyan`,
    `& ${psQuote(exe)} ${claudeArgs(req).map(psQuote).join(' ')}`
  ]
  // UTF-8 with BOM so Windows PowerShell 5.1 reads non-ASCII text correctly.
  fs.writeFileSync(file, '﻿' + lines.join('\r\n') + '\r\n', 'utf8')
  const psArgs = ['-NoExit', '-ExecutionPolicy', 'Bypass', '-File', file]
  const wantWt = req.terminal === 'wt' || (req.terminal === 'auto' && (await hasWindowsTerminal()))
  if (wantWt) {
    spawnDetached('wt.exe', ['-w', 'new', 'new-tab', '--title', req.title, '-d', cwd, 'powershell.exe', ...psArgs], cwd)
  } else {
    spawnDetached('powershell.exe', psArgs, cwd)
  }
}

function hasWindowsTerminal(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('where.exe', ['wt.exe'], { windowsHide: true, timeout: 4000 }, (err) => resolve(!err))
  })
}

function shellScript(req: LaunchRequest, cwd: string): string {
  const exe = req.cliPath && exists(req.cliPath) ? req.cliPath : 'claude'
  return [
    '#!/bin/bash',
    `printf '\\033]0;%s\\007' ${shQuote(req.title)}`,
    useDefaultDir(req.configDir) ? 'unset CLAUDE_CONFIG_DIR' : `export CLAUDE_CONFIG_DIR=${shQuote(req.configDir!)}`,
    `cd ${shQuote(cwd)} || exit 1`,
    `printf '\\033[36m%s\\033[0m\\n' ${shQuote(req.banner)}`,
    `${shQuote(exe)} ${claudeArgs(req).map(shQuote).join(' ')}`,
    'exec "${SHELL:-/bin/bash}" -l'
  ].join('\n')
}

/** iTerm2 installs as iTerm.app in /Applications or ~/Applications. */
export function hasITerm(): boolean {
  return ['/Applications/iTerm.app', path.join(HOME, 'Applications', 'iTerm.app')].some((p) => exists(p))
}

async function launchMac(req: LaunchRequest, cwd: string): Promise<void> {
  const file = scriptPath('.command')
  fs.writeFileSync(file, shellScript(req, cwd) + '\n', { mode: 0o755 })
  // Terminal.app is always there; iTerm only when it is installed.
  const app = req.terminal === 'iterm' && hasITerm() ? 'iTerm' : 'Terminal'
  spawnDetached('open', ['-a', app, file], cwd)
}

async function launchLinux(req: LaunchRequest, cwd: string): Promise<void> {
  const file = scriptPath('.sh')
  fs.writeFileSync(file, shellScript(req, cwd) + '\n', { mode: 0o755 })
  const order: Array<[string, string[]]> = [
    ['x-terminal-emulator', ['-e', file]],
    ['gnome-terminal', ['--', file]],
    ['konsole', ['-e', file]],
    ['xfce4-terminal', ['-x', file]],
    ['xterm', ['-e', file]]
  ]
  if (req.terminal === 'gnome-terminal') order.unshift(['gnome-terminal', ['--', file]])
  for (const [bin, args] of order) {
    if (await which(bin)) {
      spawnDetached(bin, args, cwd)
      return
    }
  }
  throw new Error('No terminal emulator found (tried x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm)')
}

function which(bin: string): Promise<boolean> {
  return new Promise((resolve) => execFile('which', [bin], { timeout: 3000 }, (err) => resolve(!err)))
}

function spawnDetached(file: string, args: string[], cwd: string): void {
  const child = spawn(file, args, { cwd, env: launchEnv(), detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', () => {
    /* reported by the caller's timeout-free fire-and-forget; nothing to clean up */
  })
  child.unref()
}
