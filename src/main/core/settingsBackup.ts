// Settings export, import and the daily backup. Only preferences travel: settings, account nicknames and colors,
// favorites and organization names. No credentials, no ledger.

import fs from 'node:fs'
import path from 'node:path'
import { defaultSettings } from '@shared/defaults'
import type { Account, Settings, SettingsBackup } from '@shared/types'
import { writeJsonAtomic } from './jsonfile'

const KEEP_DAILY = 10

export function makeBackup(settings: Settings, accounts: Account[], favorites: string[], orgLabels: Record<string, string>, now = Date.now()): SettingsBackup {
  return {
    kind: 'quotadeck-settings',
    version: 1,
    exportedAt: now,
    settings: { ...settings },
    accounts: accounts.map((a) => ({ id: a.id, email: a.email, nickname: a.nickname, color: a.color })),
    favorites: [...favorites],
    orgLabels: { ...orgLabels }
  }
}

export interface ImportPlan {
  settings: Partial<Settings>
  /** Nickname / color per existing account id. */
  accounts: Array<{ id: string; nickname?: string; color?: string }>
  favorites: string[]
  orgLabels: Record<string, string>
  /** Fields left out: unknown, or the wrong type. */
  dropped: string[]
}

const UUID = /^[0-9a-f-]{36}$/i

/**
 * Check a file the user picked and keep only what QuotaDeck knows: setting keys of the right type, nicknames and
 * colors of accounts that exist here (matched by id, then email), session ids, and organization names. Throws when
 * the file is not a QuotaDeck settings export at all.
 */
export function planImport(data: unknown, accounts: Account[], locale = 'en'): ImportPlan {
  const d = data as Partial<SettingsBackup> | undefined
  if (!d || typeof d !== 'object' || d.kind !== 'quotadeck-settings') throw new Error('not a QuotaDeck settings file')
  const dropped: string[] = []
  const defaults = defaultSettings(locale) as unknown as Record<string, unknown>
  const settings: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d.settings && typeof d.settings === 'object' ? d.settings : {})) {
    // Optional settings have no default; they are strings when set.
    const optionalString = k === 'desktopDataDirOverride' && (v === undefined || typeof v === 'string')
    if ((k in defaults && typeof v === typeof defaults[k] && v !== null) || optionalString) settings[k] = v
    else dropped.push(`settings.${k}`)
  }
  for (const k of Object.keys(d)) if (!['kind', 'version', 'exportedAt', 'settings', 'accounts', 'favorites', 'orgLabels'].includes(k)) dropped.push(k)
  const out: ImportPlan['accounts'] = []
  for (const a of Array.isArray(d.accounts) ? d.accounts : []) {
    const here = accounts.find((x) => x.id === a?.id) ?? accounts.find((x) => !!a?.email && x.email === a.email)
    if (!here) {
      dropped.push(`accounts.${typeof a?.email === 'string' ? a.email : (a?.id ?? '?')}`)
      continue
    }
    out.push({
      id: here.id,
      nickname: typeof a.nickname === 'string' ? a.nickname.slice(0, 24) : undefined,
      color: typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : undefined
    })
  }
  const favorites = (Array.isArray(d.favorites) ? d.favorites : []).filter((x): x is string => typeof x === 'string' && UUID.test(x))
  const orgLabels: Record<string, string> = {}
  for (const [org, label] of Object.entries(d.orgLabels && typeof d.orgLabels === 'object' ? d.orgLabels : {})) {
    if (UUID.test(org) && typeof label === 'string' && label.trim()) orgLabels[org] = Array.from(label.trim()).slice(0, 40).join('')
    else dropped.push(`orgLabels.${org}`)
  }
  return { settings: settings as Partial<Settings>, accounts: out, favorites, orgLabels, dropped }
}

/** Write a backup into `dir` as settings-YYYYMMDD.json (one per day) and keep the newest ten. */
export function dailyBackup(dir: string, backup: SettingsBackup, now = Date.now()): string {
  const d = new Date(now)
  const name = `settings-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`
  const file = path.join(dir, name)
  writeJsonAtomic(file, backup)
  const all = fs.readdirSync(dir).filter((n) => /^settings-\d{8}\.json$/.test(n)).sort()
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_DAILY))) fs.rmSync(path.join(dir, old), { force: true })
  return file
}
