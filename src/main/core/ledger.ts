// QuotaDeck's own usage ledger: every request Claude Code made on this computer, summed per hour, account,
// conversation and model, with tokens and the list-price cost. Kept in ~/.quotadeck/ledger/<YYYY-MM>.json (one file
// per UTC month) plus meta.json for conversation titles and account names, so the history survives Claude Code
// deleting transcripts older than `cleanupPeriodDays` (30 days by default) and survives removing an account.
//
// The transcript scanner is the only source. It counts each request once (message id + request id) and keeps a
// month of hourly buckets; the ledger mirrors the last two days of those and freezes anything older the first time it
// sees it, so reading the same transcripts again can never count a request twice.

import fs from 'node:fs'
import path from 'node:path'
import type { UsageBucket } from './estimate'
import { readJson, writeJsonAtomic } from './jsonfile'
import { qdPaths, safeReaddir } from './paths'

const HOUR = 3_600_000
/** Hours this recent are replaced on every sync (their requests may still be arriving). */
export const MIRROR_MS = 48 * HOUR

export interface LedgerEntry {
  /** Start of the hour (UTC). */
  h: number
  /** Account id; "" when the request could not be attributed to one of your accounts. */
  a: string
  /** Organization the desktop app was signed in with, kept so an account added later can claim the request. */
  g?: string
  /** Claude Code session id. */
  s: string
  /** Model id. */
  m: string
  /** Tokens: input, output, cache writes (5 min, 1 h), cache read. */
  i: number
  o: number
  w5: number
  w1: number
  r: number
  /** Requests. */
  n: number
  /** US dollars at list price. */
  c: number
  /** Usage units (what the live estimate counts). */
  u: number
  /** Time of the last request. */
  t: number
}

export interface LedgerSession {
  title?: string
  cwd?: string
  projectDir?: string
}

export interface LedgerAccount {
  email?: string
  nickname?: string
  plan?: string
}

interface MonthFile {
  version: 1
  month: string
  entries: LedgerEntry[]
}

interface MetaFile {
  version: 1
  sessions: Record<string, LedgerSession>
  accounts: Record<string, LedgerAccount>
}

const keyOf = (e: Pick<LedgerEntry, 'a' | 's' | 'm'>) => `${e.a}|${e.s}|${e.m}`
const monthOf = (h: number) => new Date(h).toISOString().slice(0, 7)

function sameEntries(a: Map<string, LedgerEntry>, b: Map<string, LedgerEntry>): boolean {
  if (a.size !== b.size) return false
  for (const [k, x] of a) {
    const y = b.get(k)
    if (!y || x.n !== y.n || x.i !== y.i || x.o !== y.o || x.w5 !== y.w5 || x.w1 !== y.w1 || x.r !== y.r || x.g !== y.g) return false
  }
  return true
}

/** Sum scanner buckets of one hour into ledger entries, attributing each to an account. */
export function entriesFrom(buckets: Iterable<UsageBucket>, accountOf: (b: UsageBucket) => string): Map<number, LedgerEntry[]> {
  const byHour = new Map<number, Map<string, LedgerEntry>>()
  for (const b of buckets) {
    const a = accountOf(b)
    const hour = byHour.get(b.h) ?? new Map<string, LedgerEntry>()
    const k = keyOf({ a, s: b.s, m: b.m })
    const e = hour.get(k) ?? { h: b.h, a, g: a ? undefined : b.g, s: b.s, m: b.m, i: 0, o: 0, w5: 0, w1: 0, r: 0, n: 0, c: 0, u: 0, t: 0 }
    e.i += b.i
    e.o += b.o
    e.w5 += b.w5
    e.w1 += b.w1
    e.r += b.r
    e.n += b.n
    e.c += b.c
    e.u += b.u
    e.t = Math.max(e.t, b.t)
    if (!e.g && !a && b.g) e.g = b.g
    hour.set(k, e)
    byHour.set(b.h, hour)
  }
  const out = new Map<number, LedgerEntry[]>()
  for (const [h, m] of byHour) out.set(h, [...m.values()])
  return out
}

export class Ledger {
  private hours = new Map<number, Map<string, LedgerEntry>>()
  private meta: MetaFile = { version: 1, sessions: {}, accounts: {} }
  private dirtyMonths = new Set<string>()
  private metaDirty = false
  private lastSave = 0
  /** Bumped on every change, so derived results can be cached. */
  revision = 0

  constructor(readonly dir = path.join(qdPaths().root, 'ledger')) {
    for (const name of safeReaddir(dir)) {
      if (!/^\d{4}-\d{2}\.json$/.test(name)) continue
      const f = readJson<MonthFile>(path.join(dir, name))
      if (f?.version !== 1 || !Array.isArray(f.entries)) continue
      for (const e of f.entries) {
        if (typeof e?.h !== 'number' || typeof e.s !== 'string' || typeof e.m !== 'string') continue
        const hour = this.hours.get(e.h) ?? new Map<string, LedgerEntry>()
        hour.set(keyOf(e), { ...e, a: e.a ?? '' })
        this.hours.set(e.h, hour)
      }
    }
    const meta = readJson<MetaFile>(path.join(dir, 'meta.json'))
    if (meta?.version === 1) this.meta = { version: 1, sessions: meta.sessions ?? {}, accounts: meta.accounts ?? {} }
  }

  hasHour(h: number): boolean {
    return this.hours.has(h)
  }

  /** Replace what is recorded for an hour. Returns true when that changed anything. */
  setHour(h: number, entries: LedgerEntry[]): boolean {
    const next = new Map(entries.map((e) => [keyOf(e), e]))
    const prev = this.hours.get(h)
    if (prev ? sameEntries(prev, next) : next.size === 0) return false
    if (next.size === 0) this.hours.delete(h)
    else this.hours.set(h, next)
    this.dirtyMonths.add(monthOf(h))
    this.revision++
    return true
  }

  /**
   * Bring the ledger up to date with the scanner. Recent hours are replaced (`mirror`: the scanner covers them
   * completely); older hours are only added when the ledger has nothing for them yet, then never touched again.
   */
  sync(byHour: Map<number, LedgerEntry[]>, now: number, mirror = true): boolean {
    const from = Math.floor((now - MIRROR_MS) / HOUR) * HOUR
    let changed = false
    for (const [h, entries] of byHour) {
      if ((mirror && h >= from) || !this.hasHour(h)) changed = this.setHour(h, entries) || changed
    }
    return changed
  }

  /** Every entry, optionally only hours from `from` on. */
  *entries(from = -Infinity): Iterable<LedgerEntry> {
    for (const [h, m] of this.hours) if (h >= from) yield* m.values()
  }

  get firstHour(): number | undefined {
    let first: number | undefined
    for (const h of this.hours.keys()) if (first === undefined || h < first) first = h
    return first
  }

  get size(): number {
    let n = 0
    for (const m of this.hours.values()) n += m.size
    return n
  }

  session(id: string): LedgerSession | undefined {
    return this.meta.sessions[id]
  }

  setSession(id: string, info: LedgerSession): void {
    const prev = this.meta.sessions[id]
    const next = { ...prev, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== '')) }
    if (JSON.stringify(prev) === JSON.stringify(next)) return
    this.meta.sessions[id] = next
    this.metaDirty = true
  }

  account(id: string): LedgerAccount | undefined {
    return this.meta.accounts[id]
  }

  setAccount(id: string, info: LedgerAccount): void {
    const prev = this.meta.accounts[id]
    const next = { ...prev, ...info }
    if (JSON.stringify(prev) === JSON.stringify(next)) return
    this.meta.accounts[id] = next
    this.metaDirty = true
  }

  /** Write the months that changed, each file atomically. Without `force`, at most once a minute. */
  save(force = false): void {
    if (!this.dirtyMonths.size && !this.metaDirty) return
    if (!force && Date.now() - this.lastSave < 60_000) return
    fs.mkdirSync(this.dir, { recursive: true })
    for (const month of this.dirtyMonths) {
      const entries: LedgerEntry[] = []
      for (const [h, m] of this.hours) if (monthOf(h) === month) entries.push(...m.values())
      entries.sort((x, y) => x.h - y.h || x.a.localeCompare(y.a) || x.s.localeCompare(y.s) || x.m.localeCompare(y.m))
      const round = (e: LedgerEntry) => ({ ...e, c: Math.round(e.c * 1e6) / 1e6, u: Math.round(e.u * 1e4) / 1e4 })
      writeJsonAtomic(path.join(this.dir, `${month}.json`), { version: 1, month, entries: entries.map(round) } satisfies MonthFile)
    }
    if (this.metaDirty) writeJsonAtomic(path.join(this.dir, 'meta.json'), this.meta)
    this.dirtyMonths.clear()
    this.metaDirty = false
    this.lastSave = Date.now()
  }
}
