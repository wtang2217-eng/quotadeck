// Bring the Claude desktop app to the front (or start it). QuotaDeck never signs in or out for you.

import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { shell } from 'electron'
import { exists, HOME, IS_MAC, IS_WIN } from './core/paths'

function startAppsId(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', "(Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1).AppID"],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined)
    )
  })
}

let cachedId: string | undefined

export async function openClaudeDesktop(): Promise<boolean> {
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
    const classic = path.join(local, 'AnthropicClaude', 'claude.exe')
    if (exists(classic)) {
      spawn(classic, [], { detached: true, stdio: 'ignore' }).unref()
      return true
    }
    cachedId ??= await startAppsId()
    if (cachedId) {
      spawn('explorer.exe', [`shell:AppsFolder\\${cachedId}`], { detached: true, stdio: 'ignore' }).unref()
      return true
    }
  } else if (IS_MAC) {
    spawn('open', ['-a', 'Claude'], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  try {
    await shell.openExternal('claude://')
    return true
  } catch {
    return false
  }
}
