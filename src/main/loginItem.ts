// Start QuotaDeck when the user logs in, hidden in the tray / menu bar.
//   Windows: a Run entry with --hidden (the portable build points at the original .exe, not its temp copy)
//   macOS:   the system login item; a launch at login is detected with wasOpenedAtLogin (args are not passed there)
//   Linux:   an XDG autostart entry with --hidden (the AppImage path when run as an AppImage)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const AUTOSTART_NAME = 'quotadeck.desktop'

function linuxAutostartFile(): string {
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(config, 'autostart', AUTOSTART_NAME)
}

/**
 * Quote one argument of a desktop entry's Exec key (XDG Desktop Entry spec): % is doubled, and inside
 * double quotes " ` $ get a backslash while a backslash itself takes four (string escaping applies first).
 */
export function desktopExecArg(arg: string): string {
  const escaped = arg.replace(/%/g, '%%')
  if (!/[\s"'\\$`<>~|&;*?#()]/.test(escaped)) return escaped
  return `"${escaped.replace(/\\/g, '\\\\\\\\').replace(/(["`$])/g, '\\$1')}"`
}

export function linuxAutostartEntry(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=QuotaDeck',
    'Comment=Claude multi-account panel',
    `Exec=${desktopExecArg(executable)} --hidden`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

export function applyLoginItem(openAtLogin: boolean): void {
  if (process.platform === 'win32') {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
    app.setLoginItemSettings({ openAtLogin, path: exe, args: ['--hidden'] })
  } else if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin })
  } else {
    const file = linuxAutostartFile()
    try {
      if (openAtLogin) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, linuxAutostartEntry(process.env.APPIMAGE || process.execPath))
      } else {
        fs.rmSync(file, { force: true })
      }
    } catch (e) {
      console.warn('[login item]', (e as Error).message)
    }
  }
}

/** True when this launch came from the login item (Windows and Linux pass --hidden instead). */
export function openedAtLogin(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin
  } catch {
    return false
  }
}
