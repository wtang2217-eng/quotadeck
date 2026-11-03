// Talking to the official Claude Code CLI. QuotaDeck never reads credentials itself: it asks
// `claude auth status` and reads the account profile Claude Code keeps in .claude.json.

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { CliInfo } from '@shared/types'
import { readJson } from './jsonfile'
import { globalConfigFile, HOME, IS_WIN, mainClaudeDir, samePath } from './paths'
import type { OauthAccountLike } from './plan'

let cachedCli: CliInfo | undefined

/** Locate the `claude` executable the user would get in a terminal. */
export async function findClaude(force = false): Promise<CliInfo> {
  if (cachedCli && !force) return cachedCli
  const candidates: string[] = []
  if (IS_WIN) {
    candidates.push(path.join(HOME, '.local', 'bin', 'claude.exe'))
    const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
    candidates.push(path.join(appData, 'npm', 'claude.cmd'))
  } else {
    candidates.push(path.join(HOME, '.local', 'bin', 'claude'), path.join(HOME, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude')
  }
  let found = candidates.find((c) => fs.existsSync(c))
  if (!found) found = await whichClaude()
  // Apps opened from Finder or a desktop launcher get a minimal PATH; the user's login shell knows the real one.
  if (!found && !IS_WIN) found = await loginShellClaude()
  if (!found) return (cachedCli = { found: false })
  const version = await run(found, ['--version'], envForConfigDir(undefined), 15_000)
    .then((r) => /(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1])
    .catch(() => undefined)
  return (cachedCli = { found: true, path: found, version })
}

/** `command -v claude` in the user's login shell (macOS / Linux), with a 3 second limit. */
export function loginShellClaude(shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), timeoutMs = 3000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', 'command -v claude'], { windowsHide: true, timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' } }, (err, stdout) => {
      if (err) return resolve(undefined)
      const line = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .reverse()
        .find((s) => s.startsWith('/'))
      resolve(line && fs.existsSync(line) ? line : undefined)
    })
  })
}

function whichClaude(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(IS_WIN ? 'where.exe' : 'which', ['claude'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(undefined)
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
      resolve(first || undefined)
    })
  })
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Environment for running Claude Code as a given profile. The default folder runs with CLAUDE_CONFIG_DIR unset. */
export function envForConfigDir(configDir: string | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CLAUDE_CONFIG_DIR
  // Variables a desktop session would pass down; never let them leak into a terminal we start.
  for (const key of Object.keys(env)) {
    if (/^CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|HOST_SESSION_ID|ACCOUNT_UUID|ORGANIZATION_UUID|USER_EMAIL|OAUTH|MESSAGING|SDK|CHILD_SESSION)/.test(key) || key === 'CLAUDECODE' || key === 'CLAUDE_PID') {
      delete env[key]
    }
  }
  if (configDir && !samePath(configDir, path.join(HOME, '.claude'))) env.CLAUDE_CONFIG_DIR = configDir
  return env
}

/** Run a command with exactly `env` as its environment. */
export function run(file: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const useShell = IS_WIN && /\.(cmd|bat)$/i.test(file)
    const child = spawn(file, args, { env, windowsHide: true, shell: useShell })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`timeout after ${timeoutMs}ms: ${path.basename(file)} ${args.join(' ')}`))
    }, timeoutMs)
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

export interface AuthStatus {
  loggedIn: boolean
  authMethod?: string
  email?: string
  orgId?: string
  orgName?: string
  subscriptionType?: string
}

/** `claude auth status --json` for a config folder. */
export async function authStatus(configDir: string | undefined): Promise<AuthStatus | undefined> {
  const cli = await findClaude()
  if (!cli.found || !cli.path) return undefined
  try {
    const env = envForConfigDir(configDir)
    const r = await run(cli.path, ['auth', 'status', '--json'], env, 20_000)
    const json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    return {
      loggedIn: !!json.loggedIn,
      authMethod: json.authMethod,
      email: json.email,
      orgId: json.orgId,
      orgName: json.orgName,
      subscriptionType: json.subscriptionType
    }
  } catch {
    return undefined
  }
}

/** The account profile Claude Code saved after the last sign-in in this config folder. No secrets live here. */
export function readOauthAccount(configDir: string): OauthAccountLike | undefined {
  const cfg = readJson<{ oauthAccount?: OauthAccountLike }>(globalConfigFile(configDir))
  return cfg?.oauthAccount && cfg.oauthAccount.accountUuid ? cfg.oauthAccount : undefined
}

export function mainOauthAccount(): OauthAccountLike | undefined {
  return readOauthAccount(mainClaudeDir())
}

export interface LoginHandle {
  child: ChildProcess
  done: Promise<RunResult>
}

/**
 * Start the official `claude auth login` for a config folder. Claude Code opens the browser on Anthropic's
 * sign-in page; QuotaDeck only watches the output for the URL and the exit code.
 */
export function startOfficialLogin(cliPath: string, configDir: string, email: string | undefined, onOutput: (line: string) => void): LoginHandle {
  const args = ['auth', 'login', '--claudeai']
  if (email) args.push('--email', email)
  const env = { ...envForConfigDir(configDir), BROWSER: process.env.BROWSER }
  if (!env.BROWSER) delete env.BROWSER
  const useShell = IS_WIN && /\.(cmd|bat)$/i.test(cliPath)
  const child = spawn(cliPath, args, { env, windowsHide: true, shell: useShell, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  const feed = (chunk: Buffer, sink: 'out' | 'err') => {
    const text = chunk.toString()
    if (sink === 'out') stdout += text
    else stderr += text
    for (const line of text.split(/\r?\n/)) {
      const clean = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()
      if (clean) onOutput(clean)
    }
  }
  child.stdout?.on('data', (d: Buffer) => feed(d, 'out'))
  child.stderr?.on('data', (d: Buffer) => feed(d, 'err'))
  const done = new Promise<RunResult>((resolve) => {
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  return { child, done }
}

/** First https URL in a line of CLI output. */
export function extractUrl(line: string): string | undefined {
  const m = /(https:\/\/[^\s"'<>]+)/.exec(line)
  return m?.[1]
}
