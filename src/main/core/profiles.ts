// Profile folders: one CLAUDE_CONFIG_DIR per extra account, the method Claude Code documents for
// "Log in with multiple accounts". Claude Code keeps each account's sign-in inside its own folder;
// QuotaDeck links the rest (history, settings, memory, skills) back to the main folder so every
// account sees the same conversations and setup.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeJsonAtomic } from './jsonfile'
import { exists, globalConfigFile, IS_WIN, mainClaudeDir, qdPaths } from './paths'

/** Folders shared with the main config folder through a junction (Windows) or symlink. */
export const SHARED_DIRS = ['projects', 'file-history', 'todos', 'plans', 'paste-cache', 'skills', 'agents', 'commands', 'output-styles', 'plugins', 'hooks']
/** Files shared through a symlink, or a hard link when symlinks need admin rights (Windows without Developer Mode). */
export const SHARED_FILES = ['CLAUDE.md', 'settings.json', 'keybindings.json', 'history.jsonl']

/** Keys copied from the main .claude.json so a new profile does not walk through first-run setup again. */
const SEED_KEYS = ['hasCompletedOnboarding', 'theme', 'mcpServers', 'editorMode', 'preferredNotifChannel', 'autoCompactEnabled', 'lastOnboardingVersion']

export function newProfileDir(): string {
  const id = crypto.randomBytes(4).toString('hex')
  return path.join(qdPaths().profiles, `p-${id}`)
}

export interface LinkReport {
  linked: string[]
  repaired: string[]
  problems: string[]
}

export function createProfile(dir: string): LinkReport {
  fs.mkdirSync(dir, { recursive: true })
  seedGlobalConfig(dir)
  return repairLinks(dir)
}

function seedGlobalConfig(dir: string): void {
  const target = path.join(dir, '.claude.json')
  if (exists(target)) return
  const main = readJson<Record<string, unknown>>(globalConfigFile(mainClaudeDir())) ?? {}
  const seed: Record<string, unknown> = {}
  for (const key of SEED_KEYS) if (key in main) seed[key] = main[key]
  const projects: Record<string, unknown> = {}
  const mainProjects = (main.projects ?? {}) as Record<string, { hasTrustDialogAccepted?: boolean; mcpServers?: unknown }>
  for (const [p, v] of Object.entries(mainProjects)) {
    if (v?.hasTrustDialogAccepted) projects[p] = { hasTrustDialogAccepted: true, ...(v.mcpServers ? { mcpServers: v.mcpServers } : {}) }
  }
  seed.projects = projects
  writeJsonAtomic(target, seed)
}

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

function linkTarget(p: string): string | undefined {
  try {
    return fs.realpathSync(p)
  } catch {
    return undefined
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(a, { bigint: true })
    const sb = fs.statSync(b, { bigint: true })
    return sa.ino === sb.ino && sa.dev === sb.dev
  } catch {
    return false
  }
}

/** Create missing links and re-join files that drifted apart (an editor replaced a hard link with a new file). */
export function repairLinks(dir: string): LinkReport {
  const main = mainClaudeDir()
  const report: LinkReport = { linked: [], repaired: [], problems: [] }

  for (const name of SHARED_DIRS) {
    const target = path.join(main, name)
    const link = path.join(dir, name)
    try {
      fs.mkdirSync(target, { recursive: true })
      if (!exists(link) && !isLink(link)) {
        fs.symlinkSync(target, link, IS_WIN ? 'junction' : 'dir')
        report.linked.push(name)
      } else if (linkTarget(link) !== linkTarget(target)) {
        report.problems.push(`${name}: a separate folder exists in the profile`)
      }
    } catch (e) {
      report.problems.push(`${name}: ${(e as Error).message}`)
    }
  }

  for (const name of SHARED_FILES) {
    const target = path.join(main, name)
    const link = path.join(dir, name)
    try {
      if (!exists(target)) {
        // Claude Code may create it later in the profile first; adopt it into the main folder.
        if (exists(link) && !isLink(link)) {
          fs.copyFileSync(link, target)
          replaceWithLink(target, link)
          report.repaired.push(name)
        }
        continue
      }
      if (!exists(link) && !isLink(link)) {
        report.linked.push(`${name} (${makeFileLink(target, link)})`)
        continue
      }
      if (isLink(link) ? linkTarget(link) === linkTarget(target) : sameFile(link, target)) continue
      // Drifted apart: keep the newer content in the main file (written in place so other links survive).
      backupFile(link)
      backupFile(target)
      if (fs.statSync(link).mtimeMs > fs.statSync(target).mtimeMs) fs.writeFileSync(target, fs.readFileSync(link))
      replaceWithLink(target, link)
      report.repaired.push(name)
    } catch (e) {
      report.problems.push(`${name}: ${(e as Error).message}`)
    }
  }
  return report
}

function makeFileLink(target: string, link: string): 'symlink' | 'hardlink' | 'copy' {
  try {
    fs.symlinkSync(target, link, 'file')
    return 'symlink'
  } catch {
    /* needs admin or Developer Mode on Windows */
  }
  try {
    fs.linkSync(target, link)
    return 'hardlink'
  } catch {
    fs.copyFileSync(target, link)
    return 'copy'
  }
}

function replaceWithLink(target: string, link: string): void {
  const tmp = `${link}.qd-old`
  fs.renameSync(link, tmp)
  try {
    makeFileLink(target, link)
    fs.rmSync(tmp, { force: true })
  } catch (e) {
    fs.renameSync(tmp, link)
    throw e
  }
}

function backupFile(file: string): void {
  const dir = path.join(qdPaths().backups, 'profile-files')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(file, path.join(dir, `${stamp}-${path.basename(path.dirname(file))}-${path.basename(file)}`))
}
