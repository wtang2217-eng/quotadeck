// Where things live on disk. Everything is derived at runtime, nothing is specific to one machine.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HOME = os.homedir()
export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

/** QuotaDeck's own folder. QUOTADECK_HOME moves it (used by tests). */
export function qdHome(): string {
  return process.env.QUOTADECK_HOME || path.join(HOME, '.quotadeck')
}

export function qdPaths() {
  const root = qdHome()
  return {
    root,
    state: path.join(root, 'state.json'),
    profiles: path.join(root, 'profiles'),
    backups: path.join(root, 'backups'),
    launch: path.join(root, 'launch'),
    statuslinePs1: path.join(root, 'statusline.ps1'),
    historyCache: path.join(root, 'history-cache.json')
  }
}

/**
 * Claude Code's main configuration folder: CLAUDE_CONFIG_DIR when QuotaDeck itself was started with it,
 * otherwise ~/.claude. Desktop sessions, the VS Code extension and plain `claude` all use this one.
 */
export function mainClaudeDir(): string {
  const fromEnv = process.env.QUOTADECK_CLAUDE_DIR || process.env.CLAUDE_CONFIG_DIR
  return fromEnv ? path.resolve(fromEnv) : path.join(HOME, '.claude')
}

/** Claude Code's global config file for a config folder (~/.claude.json for the default folder). */
export function globalConfigFile(configDir: string): string {
  const isDefault = samePath(configDir, path.join(HOME, '.claude')) && !process.env.QUOTADECK_CLAUDE_DIR
  return isDefault ? path.join(HOME, '.claude.json') : path.join(configDir, '.claude.json')
}

export function userSettingsFile(): string {
  return path.join(mainClaudeDir(), 'settings.json')
}

export function projectsDir(): string {
  return path.join(mainClaudeDir(), 'projects')
}

export function normalize(p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '')
  return IS_WIN ? resolved.toLowerCase().replace(/\//g, '\\') : resolved
}

export function samePath(a: string, b: string): boolean {
  return normalize(a) === normalize(b)
}

/** True when `child` is `parent` or inside it. */
export function isInside(child: string, parent: string): boolean {
  const c = normalize(child)
  const p = normalize(parent)
  return c === p || c.startsWith(p + path.sep)
}

export function exists(p: string): boolean {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

export function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Candidate data folders of the Claude desktop app, newest first. Only folders that contain the
 * Code tab's session store or the local usage history are returned.
 */
export function desktopDataDirCandidates(): string[] {
  const roots: string[] = []
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
    const roaming = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
    for (const base of ['Claude-Data', 'Claude-3p']) {
      const dir = path.join(local, base)
      roots.push(dir)
      for (const child of safeReaddir(dir)) roots.push(path.join(dir, child))
    }
    roots.push(path.join(roaming, 'Claude'), path.join(local, 'Claude'))
    // Older Microsoft Store builds kept their data in the package's virtualized folder.
    const packages = path.join(local, 'Packages')
    for (const pkg of safeReaddir(packages)) {
      if (/^Claude_/i.test(pkg)) roots.push(path.join(packages, pkg, 'LocalCache', 'Roaming', 'Claude'))
    }
  } else if (IS_MAC) {
    const support = path.join(HOME, 'Library', 'Application Support')
    roots.push(path.join(support, 'Claude'), path.join(support, 'Claude-3p'))
  } else {
    const config = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config')
    roots.push(path.join(config, 'Claude'), path.join(config, 'Claude-3p'))
  }
  const scored = roots
    .filter((dir) => exists(path.join(dir, 'claude-code-sessions')) || exists(path.join(dir, 'plan-usage-history.json')))
    .map((dir) => ({
      dir,
      score: Math.max(mtime(path.join(dir, 'claude-code-sessions')), mtime(path.join(dir, 'plan-usage-history.json')))
    }))
    .sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  return scored.map((s) => s.dir).filter((d) => (seen.has(normalize(d)) ? false : (seen.add(normalize(d)), true)))
}

export function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}
