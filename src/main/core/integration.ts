// Adds (and removes) QuotaDeck's two entries in Claude Code's user settings (~/.claude/settings.json):
//   - a StopFailure HTTP hook, so a session that stops because of a usage limit tells QuotaDeck at once
//     (this works in desktop, terminal and IDE sessions alike);
//   - a status line that shows the account and its live 5-hour / weekly usage in terminal sessions.
// Both only talk to QuotaDeck on 127.0.0.1. Everything else in the file is left as it is.

import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeTextInPlace } from './jsonfile'
import { exists, IS_WIN, qdPaths, userSettingsFile } from './paths'

export interface IntegrationConfig {
  port: number
  key: string
}

type Json = Record<string, unknown>

const HOOK_PATH = '/qd/hook/stop-failure'
const PING_PATH = '/qd/hook/session-start'
const OUR_HOOKS = '/qd/hook/'
const STATUS_PATH = '/qd/statusline'
const ENV_HEADERS = ['CLAUDE_CODE_USER_EMAIL', 'CLAUDE_CODE_ACCOUNT_UUID', 'CLAUDE_CODE_ORGANIZATION_UUID', 'CLAUDE_CODE_ENTRYPOINT']

export function hookGroup(cfg: IntegrationConfig): Json {
  return {
    matcher: 'rate_limit|billing_error|account_on_hold|authentication_failed',
    hooks: [
      {
        type: 'http',
        url: `http://127.0.0.1:${cfg.port}${HOOK_PATH}`,
        timeout: 3,
        headers: {
          'X-QuotaDeck-Key': cfg.key,
          // Desktop sessions carry the signed-in account in these variables; terminal sessions leave them empty.
          'X-QD-Email': '$CLAUDE_CODE_USER_EMAIL',
          'X-QD-Account': '$CLAUDE_CODE_ACCOUNT_UUID',
          'X-QD-Org': '$CLAUDE_CODE_ORGANIZATION_UUID',
          'X-QD-Entry': '$CLAUDE_CODE_ENTRYPOINT'
        },
        allowedEnvVars: ENV_HEADERS
      }
    ]
  }
}

/**
 * SessionStart ping: when a session starts or resumes, Claude Code reports which account it runs as (desktop
 * sessions carry it in their environment). It is an async command hook, so it never slows a session down and
 * stays silent when QuotaDeck is not running.
 */
export function sessionStartGroup(cfg: IntegrationConfig): Json {
  const url = `http://127.0.0.1:${cfg.port}${PING_PATH}`
  if (IS_WIN) {
    // PowerShell expands $env:...; curl.exe (part of Windows) avoids PowerShell's own curl alias.
    const command =
      `curl.exe -s -m 2 -o NUL -X POST -H 'X-QuotaDeck-Key: ${cfg.key}' -H "X-QD-Account: $env:CLAUDE_CODE_ACCOUNT_UUID" ` +
      `-H "X-QD-Org: $env:CLAUDE_CODE_ORGANIZATION_UUID" -H "X-QD-Entry: $env:CLAUDE_CODE_ENTRYPOINT" -H "X-QD-Session: $env:CLAUDE_CODE_SESSION_ID" ${url}`
    return { hooks: [{ type: 'command', command, shell: 'powershell', async: true, timeout: 5 }] }
  }
  const command =
    `curl -s -m 2 -o /dev/null -X POST -H 'X-QuotaDeck-Key: ${cfg.key}' -H "X-QD-Account: $CLAUDE_CODE_ACCOUNT_UUID" ` +
    `-H "X-QD-Org: $CLAUDE_CODE_ORGANIZATION_UUID" -H "X-QD-Entry: $CLAUDE_CODE_ENTRYPOINT" -H "X-QD-Session: $CLAUDE_CODE_SESSION_ID" ${url}`
  return { hooks: [{ type: 'command', command, async: true, timeout: 5 }] }
}

/** Claude Code runs status line commands through Git Bash on Windows when it is installed, else PowerShell. */
export function gitBashAvailable(): boolean {
  if (!IS_WIN) return true
  const fromEnv = process.env.CLAUDE_CODE_GIT_BASH_PATH
  if (fromEnv && exists(fromEnv)) return true
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
  return pf.some((base) => base && exists(path.join(base, 'Git', 'bin', 'bash.exe')))
}

export function statusLineEntry(cfg: IntegrationConfig): Json {
  const url = `http://127.0.0.1:${cfg.port}${STATUS_PATH}`
  let command: string
  if (!IS_WIN) {
    command = `curl -s -m 2 --data-binary @- -H 'X-QuotaDeck-Key: ${cfg.key}' ${url}`
  } else if (gitBashAvailable()) {
    // curl.exe ships with Windows 10+ and Git; the explicit .exe avoids PowerShell's curl alias.
    command = `curl.exe -s -m 2 --data-binary '@-' -H 'X-QuotaDeck-Key: ${cfg.key}' ${url}`
  } else {
    writeStatusLineScript(cfg)
    command = `powershell -NoProfile -ExecutionPolicy Bypass -File ${qdPaths().statuslinePs1.replace(/\\/g, '/')}`
  }
  return { type: 'command', command, padding: 0, refreshInterval: 30 }
}

function writeStatusLineScript(cfg: IntegrationConfig): void {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$payload = [Console]::In.ReadToEnd()',
    'try {',
    `  $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:${cfg.port}${STATUS_PATH}' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -Headers @{ 'X-QuotaDeck-Key' = '${cfg.key}' } -TimeoutSec 2`,
    '  [Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '  [Console]::Out.Write($r.Content)',
    '} catch {}'
  ].join('\r\n')
  fs.mkdirSync(path.dirname(qdPaths().statuslinePs1), { recursive: true })
  fs.writeFileSync(qdPaths().statuslinePs1, '﻿' + script, 'utf8')
}

function isOurHookGroup(group: unknown): boolean {
  const hooks = (group as { hooks?: Array<{ url?: unknown; command?: unknown }> })?.hooks
  return (
    Array.isArray(hooks) &&
    hooks.some((h) => (typeof h?.url === 'string' && h.url.includes(OUR_HOOKS)) || (typeof h?.command === 'string' && h.command.includes(OUR_HOOKS)))
  )
}

/** Replace QuotaDeck's group for one event, keeping every other group. */
function putGroup(hooks: Record<string, unknown[]>, event: string, group: Json | undefined): void {
  const kept = Array.isArray(hooks[event]) ? hooks[event].filter((g) => !isOurHookGroup(g)) : []
  if (group) kept.push(group)
  if (kept.length) hooks[event] = kept
  else delete hooks[event]
}

export function isOurStatusLine(entry: unknown): boolean {
  const command = (entry as { command?: unknown })?.command
  return typeof command === 'string' && (command.includes(STATUS_PATH) || command.replace(/\\/g, '/').includes('.quotadeck/statusline.ps1'))
}

function readSettings(file: string): { json: Json; raw: string } {
  if (!exists(file)) return { json: {}, raw: '' }
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = readJson<Json>(file)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not valid JSON; fix it first, QuotaDeck will not overwrite it`)
  }
  return { json: parsed, raw }
}

function backup(raw: string): void {
  if (!raw) return
  const dir = path.join(qdPaths().backups, 'settings')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), raw, 'utf8')
}

export interface InstallOptions {
  hooks: boolean
  statusLine: boolean
  /** Replace a status line that is not QuotaDeck's (it is saved and restored on uninstall). */
  replaceStatusLine?: boolean
}

export interface InstallResult {
  /** A foreign status line that was replaced, to be restored later. */
  replacedStatusLine?: unknown
  statusLineConflict?: string
}

export function install(cfg: IntegrationConfig, opts: InstallOptions, file = userSettingsFile()): InstallResult {
  const { json, raw } = readSettings(file)
  const result: InstallResult = {}
  if (opts.hooks) {
    const hooks = (json.hooks && typeof json.hooks === 'object' ? json.hooks : {}) as Record<string, unknown[]>
    putGroup(hooks, 'StopFailure', hookGroup(cfg))
    putGroup(hooks, 'SessionStart', sessionStartGroup(cfg))
    json.hooks = hooks
  }
  if (opts.statusLine) {
    const current = json.statusLine
    if (current && !isOurStatusLine(current) && !opts.replaceStatusLine) {
      result.statusLineConflict = String((current as { command?: unknown }).command ?? JSON.stringify(current))
    } else {
      if (current && !isOurStatusLine(current)) result.replacedStatusLine = current
      json.statusLine = statusLineEntry(cfg)
    }
  }
  backup(raw)
  writeTextInPlace(file, JSON.stringify(json, null, 2) + '\n')
  return result
}

/** Remove QuotaDeck's entries. `restoreStatusLine` is put back if QuotaDeck had replaced it. */
export function uninstall(restoreStatusLine: unknown, file = userSettingsFile()): void {
  if (!exists(file)) return
  const { json, raw } = readSettings(file)
  const hooks = json.hooks as Record<string, unknown[]> | undefined
  if (hooks && typeof hooks === 'object') {
    putGroup(hooks, 'StopFailure', undefined)
    putGroup(hooks, 'SessionStart', undefined)
    if (Object.keys(hooks).length === 0) delete json.hooks
  }
  if (isOurStatusLine(json.statusLine)) {
    if (restoreStatusLine) json.statusLine = restoreStatusLine
    else delete json.statusLine
  }
  backup(raw)
  writeTextInPlace(file, JSON.stringify(json, null, 2) + '\n')
}

export interface IntegrationProbe {
  hooksInstalled: boolean
  statusLineInstalled: boolean
  statusLineConflict?: string
  /** Installed, but pointing at another port or key (needs a re-install). */
  stale: boolean
}

export function probe(cfg: IntegrationConfig, file = userSettingsFile()): IntegrationProbe {
  const json = readJson<Json>(file) ?? {}
  const groups = ((json.hooks as Record<string, unknown[]> | undefined)?.StopFailure ?? []).filter(isOurHookGroup)
  const pings = ((json.hooks as Record<string, unknown[]> | undefined)?.SessionStart ?? []).filter(isOurHookGroup)
  const hooksInstalled = groups.length > 0
  const pingOk = pings.some((g) =>
    ((g as { hooks?: Array<{ command?: string }> }).hooks ?? []).some((h) => h.command?.includes(`:${cfg.port}${PING_PATH}`) && h.command.includes(cfg.key))
  )
  const statusLineInstalled = isOurStatusLine(json.statusLine)
  const expectedUrl = `http://127.0.0.1:${cfg.port}${HOOK_PATH}`
  const hookOk = groups.some((g) =>
    ((g as { hooks?: Array<{ url?: string; headers?: Record<string, string> }> }).hooks ?? []).some(
      (h) => h.url === expectedUrl && h.headers?.['X-QuotaDeck-Key'] === cfg.key
    )
  )
  const statusOk = statusLineInstalled && String((json.statusLine as { command?: string }).command).includes(`:${cfg.port}`)
  const conflict = json.statusLine && !statusLineInstalled ? String((json.statusLine as { command?: unknown }).command ?? '') : undefined
  return {
    hooksInstalled,
    statusLineInstalled,
    statusLineConflict: conflict || undefined,
    // Installed by an older version (no SessionStart ping) or for another port/key: needs a re-install.
    stale: (hooksInstalled && (!hookOk || !pingOk)) || (statusLineInstalled && !statusOk && !String((json.statusLine as { command?: string }).command).includes('statusline.ps1'))
  }
}
