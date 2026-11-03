// QuotaDeck's own usage ledger: every request Claude Code made on this computer, summed per hour, account,
// conversation, model and price tier, with tokens and the list-price cost. Kept in ~/.quotadeck/ledger/<YYYY-MM>.json
// (one file per UTC month) plus meta.json for conversation titles and account names, so the history survives Claude
// Code deleting transcripts older than `cleanupPeriodDays` (30 days by default) and survives removing an account.
//
// The transcript scanner is the only source. It counts each request once (message id + request id) and keeps a
// month of hourly buckets; the ledger mirrors the last two days of those and freezes anything older the first time it
// sees it, so reading the same transcripts again can never count a request twice.
//
// Dollars are always computed from the stored tokens with the current price table. Each file records the price
// version it was computed with; when the table changes, the costs are computed again on load.

import fs from 'node:fs'
import path from 'node:path'
import type { UsageBucket } from './estimate'
import { readJson, writeJsonAtomic } from './jsonfile'
import { qdPaths, safeReaddir } from './paths'
import { costOfTokens, PRICE_VERSION } from './pricing'

const HOUR = 3_600_000
/** Hours this recent are replaced on every sync (their requests may still be arriving). */
export const MIRROR_MS = 48 * HOUR
/** 2: entries carry their price tier and web searches. Older ledgers are rebuilt from transcripts where possible. */
export const LEDGER_SCHEMA = 2

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
  /** Price tier (pricing.tierOf): "" or absent = standard; "f" fast, "l" long context, "u" US-only inference. */
  p?: string
  /**
   * "b": Claude Code's background requests of one run (compacting context, titles, web search, …), from its
   * cost-state; `run` is "<session>@<start>". Absent: requests from the transcripts.
   */
  k?: 'b'
  run?: string
  /** Tokens: input, output, cache writes (5 min, 1 h), cache read. */
  i: number
  o: number
  w5: number
  w1: number
  r: number
  /** Requests, and server-side web searches. */
  n: number
  ws?: number
  /** US dollars at list price (computed from the tokens; never trusted from an older price table). */
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
  version: 1 | 2
  month: string
  /** Price table the costs in this file were computed with (version 2). */
  priceVersion?: string
  entries: LedgerEntry[]
}

interface MetaFile {
  version: 1
  /** LEDGER_SCHEMA the entries were last rebuilt for. */
  schema?: number
  sessions: Record<string, LedgerSession>
  accounts: Record<string, LedgerAccount>
}

const keyOf = (e: Pick<LedgerEntry, 'a' | 's' | 'm' | 'p' | 'k' | 'run'>) => `${e.a}|${e.s}|${e.m}|${e.p ?? ''}|${e.k ?? ''}|${e.run ?? ''}`
const isBackground = (e: LedgerEntry) => e.k === 'b'
const monthOf = (h: number) => new Date(h).toISOString().slice(0, 7)

/** The list-price cost of an entry's tokens with the current price table. */
export function priceEntry(e: LedgerEntry): number {
  return costOfTokens(e.m, e.p ?? '', e, e.ws ?? 0)
}

function sameEntries(a: Map<string, LedgerEntry>, b: Map<string, LedgerEntry>): boolean {
  if (a.size !== b.size) return false
  for (const [k, x] of a) {
    const y = b.get(k)
    if (!y || x.n !== y.n || x.i !== y.i || x.o !== y.o || x.w5 !== y.w5 || x.w1 !== y.w1 || x.r !== y.r || x.g !== y.g || (x.ws ?? 0) !== (y.ws ?? 0)) return false
  }
  return true
}

/** Sum scanner buckets of one hour into ledger entries, attributing each to an account and pricing it. */
export function entriesFrom(buckets: Iterable<UsageBucket>, accountOf: (b: UsageBucket) => string): Map<number, LedgerEntry[]> {
  const byHour = new Map<number, Map<string, LedgerEntry>>()
  for (const b of buckets) {
    const a = accountOf(b)
    const hour = byHour.get(b.h) ?? new Map<string, LedgerEntry>()
    const k = keyOf({ a, s: b.s, m: b.m, p: b.p })
    const e = hour.get(k) ?? { h: b.h, a, g: a ? undefined : b.g, s: b.s, m: b.m, p: b.p || undefined, i: 0, o: 0, w5: 0, w1: 0, r: 0, n: 0, c: 0, u: 0, t: 0 }
    e.i += b.i
    e.o += b.o
    e.w5 += b.w5
    e.w1 += b.w1
    e.r += b.r
    e.n += b.n
    if (b.ws) e.ws = (e.ws ?? 0) + b.ws
    e.u += b.u
    e.t = Math.max(e.t, b.t)
    if (!e.g && !a && b.g) e.g = b.g
    hour.set(k, e)
    byHour.set(b.h, hour)
  }
  const out = new Map<number, LedgerEntry[]>()
  for (const [h, m] of byHour) {
    const list = [...m.values()]
    for (const e of list) e.c = priceEntry(e)
    out.set(h, list)
  }
  return out
}

export class Ledger {
  private hours = new Map<number, Map<string, LedgerEntry>>()
  /** Hours holding each run's background entries. */
  private runHours = new Map<string, Set<number>>()
  private meta: MetaFile = { version: 1, sessions: {}, accounts: {} }
  private dirtyMonths = new Set<string>()
  private metaDirty = false
  private lastSave = 0
  /** Bumped on every change, so derived results can be cached. */
  revision = 0
  /** Entries whose costs were computed again on load because the price table changed. */
  readonly repriced: number = 0

  constructor(readonly dir = path.join(qdPaths().root, 'ledger')) {
    let repriced = 0
    for (const name of safeReaddir(dir)) {
      if (!/^\d{4}-\d{2}\.json$/.test(name)) continue
      const f = readJson<MonthFile>(path.join(dir, name))
      if ((f?.version !== 1 && f?.version !== 2) || !Array.isArray(f.entries)) continue
      const stale = f.priceVersion !== PRICE_VERSION
      for (const raw of f.entries) {
        if (typeof raw?.h !== 'number' || typeof raw.s !== 'string' || typeof raw.m !== 'string') continue
        const e: LedgerEntry = { ...raw, a: raw.a ?? '' }
        if (stale) {
          e.c = priceEntry(e)
          repriced++
        }
        const hour = this.hours.get(e.h) ?? new Map<string, LedgerEntry>()
        hour.set(keyOf(e), e)
        this.hours.set(e.h, hour)
        if (e.run) this.runHours.set(e.run, (this.runHours.get(e.run) ?? new Set<number>()).add(e.h))
      }
      if (stale) this.dirtyMonths.add(f.month ?? name.slice(0, 7))
    }
    this.repriced = repriced
    const meta = readJson<MetaFile>(path.join(dir, 'meta.json'))
    if (meta?.version === 1) this.meta = { version: 1, schema: meta.schema, sessions: meta.sessions ?? {}, accounts: meta.accounts ?? {} }
    else if (this.hours.size === 0) this.meta.schema = LEDGER_SCHEMA
  }

  /** The entries predate price tiers; the next full read of the transcripts should rebuild them. */
  get needsRebuild(): boolean {
    return this.hours.size > 0 && (this.meta.schema ?? 1) < LEDGER_SCHEMA
  }

  markRebuilt(): void {
    if (this.meta.schema === LEDGER_SCHEMA) return
    this.meta.schema = LEDGER_SCHEMA
    this.metaDirty = true
  }

  /** The hour holds transcript requests (background entries alone do not count: they are booked separately). */
  hasHour(h: number): boolean {
    for (const e of this.hours.get(h)?.values() ?? []) if (!isBackground(e)) return true
    return false
  }

  /** Replace the transcript requests recorded for an hour (background entries stay). Returns true when that changed anything. */
  setHour(h: number, entries: LedgerEntry[]): boolean {
    const prev = this.hours.get(h)
    const next = new Map(entries.filter((e) => !isBackground(e)).map((e) => [keyOf(e), e]))
    const prevRequests = new Map([...(prev ?? new Map<string, LedgerEntry>())].filter(([, e]) => !isBackground(e)))
    if (prev ? sameEntries(prevRequests, next) : next.size === 0) return false
    for (const [k, e] of prev ?? []) if (isBackground(e)) next.set(k, e)
    if (next.size === 0) this.hours.delete(h)
    else this.hours.set(h, next)
    this.dirtyMonths.add(monthOf(h))
    this.revision++
    return true
  }

  /**
   * Replace the background entries of one run, wherever its earlier version was (the hour of its latest record can
   * move while a conversation is still going). Returns true when that changed anything.
   */
  setBackground(run: string, given: LedgerEntry[]): boolean {
    const entries: LedgerEntry[] = given.map((e) => ({ ...e, k: 'b', run }))
    const old: LedgerEntry[] = []
    for (const h of this.runHours.get(run) ?? []) for (const e of this.hours.get(h)?.values() ?? []) if (e.run === run) old.push(e)
    const same =
      old.length === entries.length &&
      entries.every((e) => {
        const o = old.find((x) => keyOf(x) === keyOf(e) && x.h === e.h)
        return !!o && o.i === e.i && o.o === e.o && o.w5 === e.w5 && o.w1 === e.w1 && o.r === e.r && (o.ws ?? 0) === (e.ws ?? 0) && o.a === e.a
      })
    if (same) return false
    for (const h of this.runHours.get(run) ?? []) {
      const hour = this.hours.get(h)
      if (!hour) continue
      for (const [k, e] of hour) if (e.run === run) hour.delete(k)
      if (hour.size === 0) this.hours.delete(h)
      this.dirtyMonths.add(monthOf(h))
    }
    const hours = new Set<number>()
    for (const e of entries) {
      const hour = this.hours.get(e.h) ?? new Map<string, LedgerEntry>()
      hour.set(keyOf(e), e)
      this.hours.set(e.h, hour)
      hours.add(e.h)
      this.dirtyMonths.add(monthOf(e.h))
    }
    if (hours.size) this.runHours.set(run, hours)
    else this.runHours.delete(run)
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

  /**
   * Rebuild frozen hours from a fresh full read of the transcripts (after an upgrade that stores more detail). A
   * conversation's part of an hour is replaced only when the transcripts still hold at least as many requests as the
   * ledger counted; otherwise it is kept as it was (its transcript was deleted). Returns the requests rebuilt.
   */
  rebuild(byHour: Map<number, LedgerEntry[]>): { rebuilt: number; kept: number } {
    let rebuilt = 0
    let kept = 0
    const count = (list: LedgerEntry[], s: string) => list.reduce((sum, e) => (e.s === s ? sum + e.n : sum), 0)
    for (const [h, fresh] of byHour) {
      // Background entries are not part of a rebuild; setHour keeps them.
      const prev = [...(this.hours.get(h)?.values() ?? [])].filter((e) => !isBackground(e))
      const sessions = new Set([...prev, ...fresh].map((e) => e.s))
      const next: LedgerEntry[] = []
      for (const s of sessions) {
        const freshN = count(fresh, s)
        const oldN = count(prev, s)
        if (freshN >= oldN) {
          next.push(...fresh.filter((e) => e.s === s))
          rebuilt += freshN
        } else {
          next.push(...prev.filter((e) => e.s === s))
          kept += oldN
        }
      }
      this.setHour(h, next)
    }
    return { rebuilt, kept }
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
      entries.sort((x, y) => x.h - y.h || x.a.localeCompare(y.a) || x.s.localeCompare(y.s) || x.m.localeCompare(y.m) || (x.p ?? '').localeCompare(y.p ?? ''))
      const round = (e: LedgerEntry) => ({ ...e, c: Math.round(e.c * 1e6) / 1e6, u: Math.round(e.u * 1e4) / 1e4 })
      writeJsonAtomic(path.join(this.dir, `${month}.json`), { version: 2, month, priceVersion: PRICE_VERSION, entries: entries.map(round) } satisfies MonthFile)
    }
    if (this.metaDirty) writeJsonAtomic(path.join(this.dir, 'meta.json'), this.meta)
    this.dirtyMonths.clear()
    this.metaDirty = false
    this.lastSave = Date.now()
  }
}
