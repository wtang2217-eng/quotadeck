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

const MAC_BUNDLE_ID = 'com.anthropic.claudefordesktop'

/** `open` exits non-zero when it cannot find the app, so this tells whether the desktop app is installed. */
function openMac(args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile('open', args, { timeout: 8000 }, (err) => resolve(!err)))
}

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
    // By name first, then by bundle id (the app may have been renamed), then the URL scheme below.
    if ((await openMac(['-a', 'Claude'])) || (await openMac(['-b', MAC_BUNDLE_ID]))) return true
  }
  try {
    await shell.openExternal('claude://')
    return true
  } catch {
    return false
  }
}
