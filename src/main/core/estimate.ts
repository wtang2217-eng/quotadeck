// Live usage estimate between the desktop app's records (it writes one about every 15 minutes).
//
// Every reply in a Claude Code transcript carries its token usage. QuotaDeck turns those into cost-weighted
// "units" (prices relative to input tokens, heavier models weigh more), learns from each account's own history how
// many percent one unit is worth, and adds what was used since the last real record. Nothing leaves the computer
// and no API is called; the result is always labeled as an estimate.

import fs from 'node:fs'
import path from 'node:path'
import type { UsageEstimate } from '@shared/types'
import type { UsageSample } from './desktop'
import { readJson, writeJsonAtomic } from './jsonfile'
import { projectsDir, qdPaths, safeReaddir } from './paths'
import { costOf, priceOf, tierOf, tokensOf, WEB_SEARCH_USD, webSearchesOf, type ReplyUsage } from './pricing'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WINDOW = 5 * HOUR
/** Single replies are kept for a week (the estimate needs no more). */
const KEEP = 7 * DAY
/** Hourly totals for the statistics page are kept a little longer than its 30-day range. */
export const STATS_KEEP = 31 * DAY
const CHUNK = 1024 * 1024

export interface UsageEvent {
  /** When the reply was written (transcript timestamp). */
  t: number
  /** Cost-weighted token units. */
  u: number
  /** "d" started in the desktop app, "c" in a terminal, undefined when the transcript does not say. */
  e?: 'd' | 'c'
  /** Claude Code session id. */
  s: string
}

interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }
}

const FAMILY: Array<[RegExp, number]> = [
  [/fable/i, 5],
  [/opus/i, 5],
  [/sonnet/i, 1],
  [/haiku/i, 1 / 3]
]

/** Units of one reply: token counts weighted like API prices, in millions of Sonnet input tokens. */
export function unitsOf(usage: Usage, model: string | undefined): number {
  const weight = FAMILY.find(([re]) => re.test(model ?? ''))?.[1] ?? 1
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (usage.cache_creation_input_tokens ?? 0) - write1h)
  return (weight * (input + 1.25 * write5m + 2 * write1h + 0.1 * read + 5 * output)) / 1e6
}

// ---------------------------------------------------------------------------------------------- scanning

/** Replies of one conversation and model within one hour, for the statistics page. */
export interface UsageBucket {
  /** Start of the hour. */
  h: number
  /** Claude Code session id. */
  s: string
  /** Model id. */
  m: string
  e?: 'd' | 'c'
  /** Organization the desktop app was signed in with when the replies were written. */
  g?: string
  /** Price tier of the requests (see pricing.tierOf): "" standard, letters f / l / u for fast, long context, US-only. */
  p?: string
  /** Units and requests, then tokens: input, output, cache read, cache writes (5 min, 1 h); then list-price US dollars. */
  u: number
  n: number
  i: number
  o: number
  r: number
  w5: number
  w1: number
  c: number
  /** Server-side web searches. */
  ws?: number
  /** Time of the last reply. */
  t: number
}

/** One run of a conversation as Claude Code reports it in its "cost-state" records (the latest record wins). */
export interface CostStateRun {
  s: string
  /** The run's start (cost-state startTime). */
  start: number
  /** When the latest record was written: start + Claude Code's total duration of the run. */
  at: number
  total: number
  /** Per model: input, output, cache read, cache write (5 min + 1 h together), web searches, Claude Code's dollars. */
  usage: Record<string, { i: number; o: number; r: number; w: number; ws: number; c: number }>
  file: string
  /** The background part still has to be computed for this record. */
  pending?: boolean
}

/**
 * What Claude Code counted in a run beyond the requests its transcripts hold (compacting context, titles, web
 * search, …): the latest cost-state minus the transcript's requests since the run started, per model, never below 0.
 */
export interface BackgroundRun {
  /** "<session>@<start>". */
  key: string
  s: string
  start: number
  at: number
  /** Where the run's requests came from, for attributing it like them. */
  e?: 'd' | 'c'
  models: Record<string, { i: number; o: number; r: number; w5: number; w1: number; ws: number }>
  /** Token categories where the transcript held more than Claude Code counted (taken as 0). */
  negatives: number
  computedAt: number
}

export interface ScanOptions {
  /** Desktop organization signed in at a time, for attributing desktop replies. */
  orgAt?: OrgAt
  /** On the very first scan, read the whole history rather than the last month (fills the ledger once). */
  deep?: boolean
  /** Buckets about to be dropped because they are older than a month; the ledger keeps them. */
  onDrop?: (buckets: UsageBucket[]) => void
  /** Background parts of runs about to be dropped for the same reason. */
  onDropBackground?: (runs: BackgroundRun[]) => void
}

interface ScanState {
  version: 5
  cursors: Record<string, { size: number }>
  events: UsageEvent[]
  /** Reply ids already counted (one reply spans several transcript lines), with their time for pruning. */
  seen: Record<string, number>
  buckets: Record<string, UsageBucket>
  /** Project folder (under ~/.claude/projects) of each session. */
  projects: Record<string, string>
  /** Claude Code's cost-state per run, and the background part computed from it, by "<session>@<start>". */
  runs: Record<string, CostStateRun>
  background: Record<string, BackgroundRun>
  /** Every transcript was read at least once. */
  complete?: boolean
}

/** A run whose background part was computed this recently waits for the next record before reading it again. */
const BACKGROUND_EVERY = 5 * MIN

/** Desktop organization signed in at a given time, from the app's usage samples. */
export type OrgAt = (t: number) => string | undefined

function splitLines(buf: Buffer): Buffer[] {
  const out: Buffer[] = []
  let start = 0
  for (let i = buf.indexOf(0x0a); i !== -1; i = buf.indexOf(0x0a, start)) {
    out.push(buf.subarray(start, i))
    start = i + 1
  }
  out.push(buf.subarray(start))
  return out
}

/** Transcripts of the last week: top-level sessions and their subagents. */
function transcriptFiles(cutoff: number): string[] {
  const out: string[] = []
  const root = projectsDir()
  for (const proj of safeReaddir(root)) {
    const dir = path.join(root, proj)
    for (const name of safeReaddir(dir)) {
      const p = path.join(dir, name)
      if (name.endsWith('.jsonl')) out.push(p)
      else if (/^[0-9a-f-]{36}$/i.test(name)) {
        for (const sub of safeReaddir(path.join(p, 'subagents'))) if (sub.endsWith('.jsonl')) out.push(path.join(p, 'subagents', sub))
      }
    }
  }
  return out.filter((f) => {
    try {
      return fs.statSync(f).mtimeMs >= cutoff
    } catch {
      return false
    }
  })
}

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r))

interface RunTokens {
  i: number
  o: number
  r: number
  w5: number
  w1: number
  ws: number
  /** Dollars the way Claude Code prices them (its Sonnet 5.5 cache reads are $0.20), for splitting cache writes. */
  cc: number
}

/** Requests of a run from its transcript and its subagents' (each once), per model, from the run's start on. */
export async function readRunRequests(run: Pick<CostStateRun, 'file' | 'start'>): Promise<{ models: Record<string, RunTokens>; e?: 'd' | 'c' }> {
  const session = path.basename(run.file, '.jsonl')
  const subDir = path.join(path.dirname(run.file), session, 'subagents')
  const files = [run.file, ...safeReaddir(subDir).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(subDir, n))]
  const models: Record<string, RunTokens> = {}
  const seen = new Set<string>()
  let e: 'd' | 'c' | undefined
  for (const f of files) {
    let text: string
    try {
      text = await fs.promises.readFile(f, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"') || !line.includes('"type":"assistant"')) continue
      let j: { timestamp?: string; requestId?: string; entrypoint?: string; message?: { id?: string; model?: string; usage?: ReplyUsage } }
      try {
        j = JSON.parse(line)
      } catch {
        continue
      }
      const model = j.message?.model
      const u = j.message?.usage
      const t = Date.parse(j.timestamp ?? '')
      if (!model || !u || model === '<synthetic>' || !Number.isFinite(t) || t < run.start) continue
      const id = `${j.message!.id ?? ''}:${j.requestId ?? ''}`
      if (seen.has(id)) continue
      seen.add(id)
      if (f === run.file && j.entrypoint) e = j.entrypoint === 'claude-desktop' ? 'd' : 'c'
      const tok = tokensOf(u)
      const m = (models[model] ??= { i: 0, o: 0, r: 0, w5: 0, w1: 0, ws: 0, cc: 0 })
      m.i += tok.input
      m.o += tok.output
      m.r += tok.cacheRead
      m.w5 += tok.write5m
      m.w1 += tok.write1h
      m.ws += webSearchesOf(u)
      m.cc += costOf(u, model) + (/sonnet-5-5/i.test(model) ? (tok.cacheRead * 0.1) / 1e6 : 0)
    }
    await yieldToLoop()
  }
  return { models, e }
}

/**
 * Claude Code reports cache writes as one number. The 5-minute / 1-hour split of the background part follows from
 * its dollars: what it charged beyond the transcript's requests, minus everything else, is the 1-hour premium.
 */
function splitCacheWrite(model: string, d: { i: number; o: number; r: number; w: number; ws: number }, cc: { c: number }, ours: RunTokens | undefined): { w5: number; w1: number } {
  if (!d.w) return { w5: 0, w1: 0 }
  const p = priceOf(model)
  const read = /sonnet-5-5/i.test(model) ? 0.2 : (p.cacheRead ?? p.input * 0.1)
  const extra = cc.c - (ours?.cc ?? 0)
  const rest = (d.i * p.input + d.o * p.output + d.r * read + d.w * p.input * 1.25) / 1e6 + d.ws * WEB_SEARCH_USD
  const w1 = Math.round(Math.min(d.w, Math.max(0, ((extra - rest) * 1e6) / (p.input * 0.75))))
  return { w5: d.w - w1, w1 }
}

export class UsageScanner {
  private state: ScanState
  private busy = false
  private lastSave = 0
  private dirty = false
  private orgAt?: OrgAt
  /** Bumped whenever new replies were counted, so derived results can be cached. */
  revision = 0

  constructor(private readonly file = path.join(qdPaths().root, 'usage-scan.json')) {
    const saved = readJson<ScanState>(file)
    // Older versions kept no statistics, price tiers or cost-state runs; reading the transcripts again fills them in.
    this.state = saved?.version === 5 ? saved : { version: 5, cursors: {}, events: [], seen: {}, buckets: {}, projects: {}, runs: {}, background: {} }
  }

  /** Background parts of the runs seen in the last month. */
  get backgroundRuns(): readonly BackgroundRun[] {
    return Object.values(this.state.background)
  }

  get events(): readonly UsageEvent[] {
    return this.state.events
  }

  get buckets(): Readonly<Record<string, UsageBucket>> {
    return this.state.buckets
  }

  projectOf(session: string): string | undefined {
    return this.state.projects[session]
  }

  /** The first full read of the transcripts has finished. */
  get complete(): boolean {
    return !!this.state.complete
  }

  get scanning(): boolean {
    return this.busy
  }

  /** Write the cache now if anything changed since the last write. */
  save(): void {
    if (!this.dirty) return
    writeJsonAtomic(this.file, this.state)
    this.dirty = false
    this.lastSave = Date.now()
  }

  /** Read whatever was added to the transcripts since the last call. Returns true when new replies were found. */
  async scan(now = Date.now(), opts: ScanOptions = {}): Promise<boolean> {
    if (this.busy) return false
    this.busy = true
    this.orgAt = opts.orgAt
    const before = this.state.events.length
    const revisionBefore = this.revision
    let touched = false
    try {
      const cutoff = now - STATS_KEEP
      // The first scan may read everything; older buckets go to `onDrop` at the end of it.
      const readFrom = opts.deep && !this.state.complete ? -Infinity : cutoff
      const live = new Set<string>()
      for (const file of transcriptFiles(readFrom)) {
        live.add(file)
        let size: number
        try {
          size = fs.statSync(file).size
        } catch {
          continue
        }
        const cursor = this.state.cursors[file]
        if (cursor && cursor.size === size) continue
        const sub = path.basename(file).startsWith('agent-')
        const session = sub ? path.basename(path.dirname(path.dirname(file))) : path.basename(file, '.jsonl')
        if (!this.state.projects[session]) this.state.projects[session] = path.basename(path.dirname(sub ? path.dirname(path.dirname(file)) : file))
        const end = !cursor || size < cursor.size ? await this.readBackward(file, size, readFrom, session) : await this.readForward(file, cursor.size, size, readFrom, session)
        this.state.cursors[file] = { size: end }
        touched = true
        await yieldToLoop()
      }
      for (const f of Object.keys(this.state.cursors)) {
        if (!live.has(f)) {
          delete this.state.cursors[f]
          touched = true
        }
      }
      if (!this.state.complete) {
        this.state.complete = true
        touched = true
      }
      // A run whose last record arrived while it was being waited on is computed now, even if nothing else changed.
      const revisionBeforeBackground = this.revision
      await this.computeBackground(now)
      if (this.revision !== revisionBeforeBackground) touched = true
      if (!touched) return false
      const droppedRuns: BackgroundRun[] = []
      for (const [key, run] of Object.entries(this.state.runs)) {
        if (run.at >= cutoff) continue
        if (this.state.background[key]) droppedRuns.push(this.state.background[key])
        delete this.state.runs[key]
        delete this.state.background[key]
      }
      if (droppedRuns.length) opts.onDropBackground?.(droppedRuns)
      const keepEvents = now - KEEP
      this.state.events = this.state.events.filter((e) => e.t >= keepEvents).sort((a, b) => a.t - b.t)
      for (const [id, t] of Object.entries(this.state.seen)) if (t < cutoff) delete this.state.seen[id]
      const dropped: UsageBucket[] = []
      for (const [key, b] of Object.entries(this.state.buckets)) {
        if (b.h + HOUR > cutoff) continue
        dropped.push(b)
        delete this.state.buckets[key]
      }
      if (dropped.length) opts.onDrop?.(dropped)
      const sessions = new Set(Object.values(this.state.buckets).map((b) => b.s))
      for (const s of Object.keys(this.state.projects)) if (!sessions.has(s)) delete this.state.projects[s]
      this.dirty = true
      // The cache is only a speed-up for the next start; writing it at most once a minute is plenty.
      if (Date.now() - this.lastSave > 60_000) this.save()
      return this.state.events.length !== before || this.revision !== revisionBefore
    } finally {
      this.busy = false
    }
  }

  /** Add one reply to its hourly bucket (one per price tier, so costs can be recomputed exactly). */
  private addToBucket(when: number, session: string, model: string, e: 'd' | 'c' | undefined, usage: ReplyUsage, units: number): void {
    const h = Math.floor(when / HOUR) * HOUR
    const g = this.orgAt?.(when)
    const p = tierOf(usage, model)
    const key = `${h}|${session}|${model}|${e ?? ''}|${g ?? ''}|${p}`
    const b = (this.state.buckets[key] ??= { h, s: session, m: model, e, g, p: p || undefined, u: 0, n: 0, i: 0, o: 0, r: 0, w5: 0, w1: 0, c: 0, t: when })
    const ws = webSearchesOf(usage)
    if (ws) b.ws = (b.ws ?? 0) + ws
    const tok = tokensOf(usage)
    b.u += units
    b.n++
    b.i += tok.input
    b.o += tok.output
    b.r += tok.cacheRead
    b.w5 += tok.write5m
    b.w1 += tok.write1h
    b.c += costOf(usage, model)
    if (when > b.t) b.t = when
    this.revision++
  }

  /** Keep the latest cost-state record of a run (Claude Code rewrites its running total during the run). */
  private takeCostState(text: string, file: string, session: string, cutoff: number): void {
    let j: { sessionId?: string; startTime?: number; totalCostUSD?: number; totalDuration?: number; modelUsage?: Record<string, Record<string, number>> }
    try {
      j = JSON.parse(text)
    } catch {
      return
    }
    if (typeof j.startTime !== 'number' || typeof j.totalCostUSD !== 'number' || !j.modelUsage) return
    const at = j.startTime + (typeof j.totalDuration === 'number' && j.totalDuration > 0 ? j.totalDuration : 0)
    if (at < cutoff) return
    const s = j.sessionId ?? session
    const key = `${s}@${j.startTime}`
    const prev = this.state.runs[key]
    if (prev && prev.total > j.totalCostUSD) return
    if (prev && prev.total === j.totalCostUSD && prev.at >= at) return
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
    const usage: CostStateRun['usage'] = {}
    for (const [model, u] of Object.entries(j.modelUsage)) {
      usage[model] = { i: num(u.inputTokens), o: num(u.outputTokens), r: num(u.cacheReadInputTokens), w: num(u.cacheCreationInputTokens), ws: num(u.webSearchRequests), c: num(u.costUSD) }
    }
    this.state.runs[key] = { s, start: j.startTime, at, total: j.totalCostUSD, usage, file, pending: true }
  }

  /**
   * The background part of a run: the latest cost-state minus the requests its transcripts (and its subagents')
   * hold since the run started. Reads the conversation's files once per new record, at most every 5 minutes.
   */
  private async computeBackground(now: number): Promise<void> {
    for (const [key, run] of Object.entries(this.state.runs)) {
      const done = this.state.background[key]
      if (!run.pending || (done && now - done.computedAt < BACKGROUND_EVERY)) continue
      const ours = await readRunRequests(run)
      const models: BackgroundRun['models'] = {}
      let negatives = 0
      const diff = (a: number, b: number) => {
        if (a < b) negatives++
        return Math.max(0, a - b)
      }
      for (const [model, cc] of Object.entries(run.usage)) {
        const o = ours.models[model] ?? { i: 0, o: 0, r: 0, w5: 0, w1: 0, ws: 0 }
        const d = { i: diff(cc.i, o.i), o: diff(cc.o, o.o), r: diff(cc.r, o.r), w: diff(cc.w, o.w5 + o.w1), ws: diff(cc.ws, o.ws) }
        if (!d.i && !d.o && !d.r && !d.w && !d.ws) continue
        models[model] = { i: d.i, o: d.o, r: d.r, ...splitCacheWrite(model, d, cc, o), ws: d.ws }
      }
      // Requests the transcript holds for a model Claude Code did not list count as negative differences too.
      for (const model of Object.keys(ours.models)) if (!run.usage[model]) negatives++
      this.state.background[key] = { key, s: run.s, start: run.start, at: run.at, e: ours.e, models, negatives, computedAt: now }
      run.pending = false
      this.revision++
      await yieldToLoop()
    }
  }

  /** Count one transcript line; returns its timestamp when it has one. */
  private take(line: Buffer, cutoff: number, session: string, file: string): number | undefined {
    if (line.length < 40) return undefined
    const text = line.toString('utf8')
    if (text.includes('"type":"cost-state"')) {
      this.takeCostState(text, file, session, cutoff)
      return undefined
    }
    const ts = /"timestamp":"([^"]+)"/.exec(text)
    const t = ts ? Date.parse(ts[1]) : NaN
    if (!text.includes('"usage"') || !text.includes('"type":"assistant"')) return Number.isFinite(t) ? t : undefined
    let j: { type?: string; timestamp?: string; requestId?: string; entrypoint?: string; sessionId?: string; message?: { id?: string; model?: string; usage?: ReplyUsage } }
    try {
      j = JSON.parse(text)
    } catch {
      return Number.isFinite(t) ? t : undefined
    }
    const when = Date.parse(j.timestamp ?? '')
    if (j.type !== 'assistant' || !j.message?.usage || j.message.model === '<synthetic>' || !Number.isFinite(when)) return Number.isFinite(when) ? when : undefined
    if (when < cutoff) return when
    const id = `${j.message.id ?? ''}:${j.requestId ?? ''}`
    if (this.state.seen[id]) return when
    this.state.seen[id] = when
    const u = unitsOf(j.message.usage, j.message.model)
    if (u > 0) {
      const e = j.entrypoint === 'claude-desktop' ? 'd' : j.entrypoint ? 'c' : undefined
      const s = j.sessionId ?? session
      // Single replies only matter to the estimate for a week; the statistics keep hourly totals for a month.
      if (when >= Date.now() - KEEP) this.state.events.push({ t: when, u, e, s })
      this.addToBucket(when, s, j.message.model ?? '', e, j.message.usage, u)
    }
    return when
  }

  /** First read of a file: walk back from its end until replies are older than the cutoff. */
  private async readBackward(file: string, size: number, cutoff: number, session: string): Promise<number> {
    const fd = await fs.promises.open(file, 'r')
    try {
      // Only complete lines count; a line still being written is picked up by the next forward read.
      let end = size
      while (end > 0) {
        const start = Math.max(0, end - 64 * 1024)
        const buf = Buffer.alloc(end - start)
        await fd.read(buf, 0, buf.length, start)
        const nl = buf.lastIndexOf(0x0a)
        if (nl !== -1) {
          end = start + nl + 1
          break
        }
        end = start
      }
      let pos = end
      let carry: Buffer = Buffer.alloc(0)
      while (pos > 0) {
        const start = Math.max(0, pos - CHUNK)
        const buf = Buffer.alloc(pos - start)
        await fd.read(buf, 0, buf.length, start)
        const parts = splitLines(Buffer.concat([buf, carry]))
        const first = parts.shift()!
        carry = start > 0 ? first : Buffer.alloc(0)
        if (start === 0) parts.unshift(first)
        let oldest = Infinity
        for (let i = parts.length - 1; i >= 0; i--) {
          const t = this.take(parts[i], cutoff, session, file)
          if (t !== undefined && t < oldest) oldest = t
        }
        if (oldest < cutoff) break
        pos = start
        await yieldToLoop()
      }
      return end
    } finally {
      await fd.close()
    }
  }

  private async readForward(file: string, from: number, size: number, cutoff: number, session: string): Promise<number> {
    const fd = await fs.promises.open(file, 'r')
    try {
      const buf = Buffer.alloc(size - from)
      await fd.read(buf, 0, buf.length, from)
      const nl = buf.lastIndexOf(0x0a)
      if (nl === -1) return from
      for (const line of splitLines(buf.subarray(0, nl))) this.take(line, cutoff, session, file)
      return from + nl + 1
    } finally {
      await fd.close()
    }
  }
}

// ---------------------------------------------------------------------------------------------- estimating

export interface AccountRef {
  id: string
  orgUuid?: string
  /** Relative plan size (Pro = 1, Max 5x = 5, ...). */
  weight: number
}

export interface Attribution {
  samples: UsageSample[]
  /** Sessions whose account is known (started by QuotaDeck, or reported by the SessionStart hook). */
  sessionAccounts: Record<string, { accountId: string }>
  /** Conversation ids that appear in a desktop list, for transcripts that do not record where they started. */
  desktopSessions: Set<string>
  /** Account of terminal sessions in the default ~/.claude folder. */
  defaultCliAccountId?: string
  orgToAccount: Map<string, string>
}

/** Which account a reply belongs to. Desktop replies go to the account the app was signed in with at that time. */
export function attribute(events: readonly UsageEvent[], a: Attribution): Array<{ t: number; u: number; account?: string }> {
  const samples = a.samples
  return events.map((ev) => {
    const known = a.sessionAccounts[ev.s]?.accountId
    if (known) return { t: ev.t, u: ev.u, account: known }
    const desktop = ev.e === 'd' || (ev.e === undefined && a.desktopSessions.has(ev.s))
    if (!desktop) return { t: ev.t, u: ev.u, account: a.defaultCliAccountId }
    let lo = 0
    let hi = samples.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (samples[mid].t <= ev.t) {
        idx = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return { t: ev.t, u: ev.u, account: idx >= 0 ? a.orgToAccount.get(samples[idx].org) : undefined }
  })
}

interface Rate {
  fh?: number
  sd?: number
  pairs: number
}

const sumUnits = (evs: Array<{ t: number; u: number }>, from: number, to: number) => {
  let s = 0
  for (const e of evs) if (e.t > from && e.t <= to) s += e.u
  return s
}

/** Percent per unit for one account, from consecutive records with local replies in between. */
export function learnRate(samples: UsageSample[], evs: Array<{ t: number; u: number }>, now: number, skip?: number): Rate {
  let dfh = 0
  let ufh = 0
  let dsd = 0
  let usd = 0
  let pairs = 0
  for (let i = 1; i < samples.length; i++) {
    if (i === skip) continue
    const a = samples[i - 1]
    const b = samples[i]
    if (now - b.t > KEEP || b.t - a.t > 40 * MIN) continue
    const u = sumUnits(evs, a.t, b.t)
    if (u <= 0) continue
    pairs++
    if (a.fh !== undefined && b.fh !== undefined && b.fh >= a.fh) {
      dfh += b.fh - a.fh
      ufh += u
    }
    if (a.sd !== undefined && b.sd !== undefined && b.sd >= a.sd) {
      dsd += b.sd - a.sd
      usd += u
    }
  }
  return { fh: ufh > 0 && dfh > 0 ? dfh / ufh : undefined, sd: usd > 0 && dsd > 0 ? dsd / usd : undefined, pairs }
}

/** Start of the 5-hour window that is open now, from the account's replies and the records that read 0%. */
export function windowStart(samples: UsageSample[], evs: Array<{ t: number }>, now: number): number | undefined {
  let ws: number | undefined
  const zeros = samples.filter((s) => s.fh === 0).map((s) => s.t)
  for (const e of evs) {
    if (ws !== undefined && (e.t >= ws + WINDOW || zeros.some((z) => z > ws! && z < e.t))) ws = undefined
    if (ws === undefined) ws = e.t
  }
  return ws !== undefined && ws + WINDOW > now ? ws : undefined
}

/** `rates`, when given, receives the percent-per-unit each account's estimate used (for the run-out forecast). */
export function estimateUsage(
  accounts: AccountRef[],
  samples: UsageSample[],
  events: Array<{ t: number; u: number; account?: string }>,
  now = Date.now(),
  rates?: Map<string, { fh?: number; sd?: number }>
): Map<string, UsageEstimate> {
  const out = new Map<string, UsageEstimate>()
  const per = new Map<string, { samples: UsageSample[]; evs: Array<{ t: number; u: number }>; rate: Rate; ref: AccountRef }>()
  for (const ref of accounts) {
    const own = ref.orgUuid ? samples.filter((s) => s.org === ref.orgUuid) : []
    const evs = events.filter((e) => e.account === ref.id)
    per.set(ref.id, { samples: own, evs, rate: learnRate(own, evs, now), ref })
  }
  // The best-trained account lends its rate to new ones, scaled by plan size.
  const teacher = [...per.values()].filter((p) => p.rate.fh && p.rate.pairs >= 3).sort((a, b) => b.rate.pairs - a.rate.pairs)[0]

  for (const { samples: own, evs, rate, ref } of per.values()) {
    let basis: UsageEstimate['basis'] = 'own-history'
    let kfh = rate.pairs >= 3 ? rate.fh : undefined
    let ksd = rate.pairs >= 3 ? rate.sd : undefined
    if (kfh === undefined && teacher && teacher.ref.id !== ref.id) {
      const scale = teacher.ref.weight / Math.max(0.1, ref.weight)
      kfh = teacher.rate.fh! * scale
      ksd = teacher.rate.sd !== undefined ? teacher.rate.sd * scale : undefined
      basis = 'plan-ratio'
    }
    if (kfh === undefined) continue
    rates?.set(ref.id, { fh: kfh, sd: ksd })
    const last = own[own.length - 1]
    const since = last?.t ?? now - WINDOW
    const usedSince = sumUnits(evs, since, now)
    const ws = windowStart(own, evs, now)
    if (usedSince <= 0 && ws === undefined) continue

    let fiveHour: number | undefined
    if (ws !== undefined && (!last || ws > last.t)) fiveHour = kfh * sumUnits(evs, ws - 1, now)
    else if (last?.fh !== undefined) fiveHour = last.fh + kfh * usedSince
    let sevenDay: number | undefined
    if (ksd !== undefined && last?.sd !== undefined) sevenDay = last.sd + ksd * usedSince
    const clamp = (v: number | undefined) => (v === undefined ? undefined : Math.min(100, Math.max(0, Math.round(v))))
    out.set(ref.id, {
      at: now,
      fiveHour: clamp(fiveHour),
      sevenDay: clamp(sevenDay),
      fiveHourResetsAt: ws !== undefined ? ws + WINDOW : undefined,
      basis,
      fromRecordAt: last?.t
    })
  }
  return out
}

/** Leave-one-out check of the 5-hour rate on an account's own history: mean absolute error in points. */
export function backtest(samples: UsageSample[], evs: Array<{ t: number; u: number }>, now = Date.now()): { pairs: number; mae: number; bias: number } {
  let n = 0
  let abs = 0
  let bias = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if (now - b.t > KEEP || b.t - a.t > 40 * MIN || a.fh === undefined || b.fh === undefined || b.fh < a.fh) continue
    const u = sumUnits(evs, a.t, b.t)
    if (u <= 0) continue
    const k = learnRate(samples, evs, now, i).fh
    if (!k) continue
    const err = a.fh + k * u - b.fh
    n++
    abs += Math.abs(err)
    bias += err
  }
  return { pairs: n, mae: n ? abs / n : NaN, bias: n ? bias / n : NaN }
}
