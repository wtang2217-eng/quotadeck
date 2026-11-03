import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attribute, estimateUsage, learnRate, unitsOf, UsageScanner, windowStart } from '../src/main/core/estimate'

const MIN = 60_000
const HOUR = 60 * MIN
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('unitsOf', () => {
  it('weighs output, cache and model family like prices', () => {
    expect(unitsOf({ input_tokens: 1_000_000 }, 'claude-sonnet-5-5')).toBeCloseTo(1)
    expect(unitsOf({ output_tokens: 1_000_000 }, 'claude-sonnet-5-5')).toBeCloseTo(5)
    expect(unitsOf({ cache_read_input_tokens: 1_000_000 }, 'claude-sonnet-5-5')).toBeCloseTo(0.1)
    expect(unitsOf({ input_tokens: 1_000_000 }, 'claude-opus-5-5')).toBeCloseTo(5)
    expect(unitsOf({ cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } }, 'claude-sonnet-5-5')).toBeCloseTo(2)
  })
})

describe('learning and estimating', () => {
  const now = Date.UTC(2026, 10, 3, 12, 0)
  // Account A: 2 points per unit, records every 15 minutes, one unit of replies between records.
  const samplesA = Array.from({ length: 8 }, (_, i) => ({ t: now - (8 - i) * 15 * MIN, org: ORG_A, fh: 10 + i * 2, sd: 40 }))
  const evsA = samplesA.slice(1).map((s) => ({ t: s.t - 5 * MIN, u: 1, account: 'A' }))

  it('learns the rate from consecutive records', () => {
    const r = learnRate(samplesA, evsA, now)
    expect(r.fh).toBeCloseTo(2)
    expect(r.pairs).toBe(7)
  })

  it('adds what was used since the last record, and lends the rate to a new account by plan size', () => {
    const events = [...evsA, { t: now - 5 * MIN, u: 3, account: 'A' }, { t: now - 20 * MIN, u: 1, account: 'B' }, { t: now - 2 * MIN, u: 1, account: 'B' }]
    const samples = [...samplesA, { t: now - 25 * MIN, org: ORG_B, fh: 0, sd: 0 }].sort((x, y) => x.t - y.t)
    const est = estimateUsage(
      [
        { id: 'A', orgUuid: ORG_A, weight: 5 },
        { id: 'B', orgUuid: ORG_B, weight: 1 }
      ],
      samples,
      events,
      now
    )
    expect(est.get('A')).toMatchObject({ fiveHour: 30, basis: 'own-history' })
    // B started a window after its 0% record: 2 units × (2 × 5) points.
    expect(est.get('B')).toMatchObject({ fiveHour: 20, basis: 'plan-ratio', fiveHourResetsAt: now - 20 * MIN + 5 * HOUR })
  })

  it('finds the open 5-hour window and restarts it after a 0% record', () => {
    // The window opened 7 h ago covers the reply 3 h ago; the reply 1 h ago opens the current one.
    expect(windowStart([], [{ t: now - 7 * HOUR }, { t: now - 3 * HOUR }, { t: now - HOUR }], now)).toBe(now - HOUR)
    const evs = [{ t: now - 4 * HOUR }, { t: now - HOUR }]
    expect(windowStart([], evs, now)).toBe(now - 4 * HOUR)
    // A 0% record in between means the earlier window had already closed.
    expect(windowStart([{ t: now - 2 * HOUR, org: ORG_A, fh: 0 }], evs, now)).toBe(now - HOUR)
    expect(windowStart([], [{ t: now - 6 * HOUR }], now)).toBeUndefined()
  })

  it('attributes desktop replies to the account signed in at the time', () => {
    const samples = [
      { t: 100, org: ORG_A, fh: 1 },
      { t: 200, org: ORG_B, fh: 0 }
    ]
    const out = attribute(
      [
        { t: 150, u: 1, e: 'd', s: 'x' },
        { t: 250, u: 1, e: 'd', s: 'y' },
        { t: 260, u: 1, e: 'c', s: 'z' },
        { t: 270, u: 1, e: 'c', s: 'known' }
      ],
      { samples, sessionAccounts: { known: { accountId: 'B' } }, desktopSessions: new Set(), defaultCliAccountId: 'A', orgToAccount: new Map([[ORG_A, 'A'], [ORG_B, 'B']]) }
    )
    expect(out.map((e) => e.account)).toEqual(['A', 'B', 'A', 'B'])
  })
})

describe('UsageScanner', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-scan-'))
    process.env.QUOTADECK_CLAUDE_DIR = path.join(dir, 'claude')
    fs.mkdirSync(path.join(dir, 'claude', 'projects', 'p'), { recursive: true })
  })
  afterEach(() => {
    delete process.env.QUOTADECK_CLAUDE_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const line = (id: string, t: number, out: number) =>
    JSON.stringify({ type: 'assistant', timestamp: new Date(t).toISOString(), requestId: 'r' + id, entrypoint: 'claude-desktop', sessionId: 's1', message: { id, model: 'claude-sonnet-5-5', usage: { output_tokens: out } } })

  it('counts each reply once, skips a half-written last line, and picks up appended lines', async () => {
    const now = Date.now()
    const file = path.join(dir, 'claude', 'projects', 'p', 's1.jsonl')
    // The same reply appears on two lines (one per content block); the last line is still being written.
    fs.writeFileSync(file, [line('m1', now - 60_000, 200_000), line('m1', now - 60_000, 200_000), '{"type":"user","timestamp":"x"}', ''].join('\n') + line('m2', now, 100_000).slice(0, 30))
    const scanner = new UsageScanner(path.join(dir, 'scan.json'))
    await scanner.scan(now)
    expect(scanner.events.map((e) => [e.u, e.e, e.s])).toEqual([[1, 'd', 's1']])
    // Finish the half-written line and add another reply.
    fs.writeFileSync(file, [line('m1', now - 60_000, 200_000), line('m1', now - 60_000, 200_000), '{"type":"user","timestamp":"x"}', line('m2', now, 100_000), line('m3', now, 100_000), ''].join('\n'))
    await scanner.scan(now)
    expect(scanner.events.map((e) => e.u)).toEqual([1, 0.5, 0.5])
    // A new scanner continues from the saved cursor without counting anything twice.
    const again = new UsageScanner(path.join(dir, 'scan.json'))
    await again.scan(now)
    expect(again.events).toHaveLength(3)
  })

  it('keeps hourly totals with tokens, cost and the desktop organization for the statistics', async () => {
    const now = Date.now()
    const file = path.join(dir, 'claude', 'projects', 'p', 's1.jsonl')
    fs.writeFileSync(file, [line('m1', now - 60_000, 1_000_000), line('m1', now - 60_000, 1_000_000), line('m2', now - 30_000, 1_000_000), ''].join('\n'))
    const scanner = new UsageScanner(path.join(dir, 'scan.json'))
    await scanner.scan(now, () => ORG_A)
    const buckets = Object.values(scanner.buckets)
    const sum = (k: 'o' | 'c' | 'n' | 'u') => buckets.reduce((s, b) => s + b[k], 0)
    expect(sum('n')).toBe(2)
    expect(sum('o')).toBe(2_000_000)
    // Sonnet 5.5 output is $10 per million tokens.
    expect(sum('c')).toBeCloseTo(20)
    expect(sum('u')).toBeCloseTo(10)
    expect(buckets.every((b) => b.g === ORG_A && b.s === 's1' && b.e === 'd' && b.h % HOUR === 0)).toBe(true)
    expect(scanner.projectOf('s1')).toBe('p')
    expect(scanner.complete).toBe(true)
  })
})
