// Claude Code's background requests (compacting context, titles, web search…) never reach the transcripts; its
// cost-state records count them. The ledger books the difference per run.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UsageScanner } from '../src/main/core/estimate'
import { Ledger, type LedgerEntry } from '../src/main/core/ledger'

const MIN = 60_000
const HOUR = 60 * MIN

describe('background requests from cost-state', () => {
  let dir: string
  let main: string
  const now = Date.now()
  const start = now - 2 * HOUR

  const reply = (id: string, t: number, model: string, u: Record<string, unknown>) =>
    JSON.stringify({ type: 'assistant', timestamp: new Date(t).toISOString(), requestId: 'r' + id, entrypoint: 'claude-desktop', sessionId: 's1', message: { id, model, usage: u } })
  const costState = (total: number, duration: number, usage: Record<string, Record<string, number>>) =>
    JSON.stringify({ type: 'cost-state', sessionId: 's1', totalCostUSD: total, totalDuration: duration, startTime: start, modelUsage: usage })

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-bg-'))
    process.env.QUOTADECK_CLAUDE_DIR = path.join(dir, 'claude')
    const proj = path.join(dir, 'claude', 'projects', 'p')
    fs.mkdirSync(path.join(proj, 's1', 'subagents'), { recursive: true })
    main = path.join(proj, 's1.jsonl')
    fs.writeFileSync(
      main,
      [
        // From an earlier run of the conversation (it was resumed): outside this run.
        reply('old', start - HOUR, 'claude-opus-5-5', { input_tokens: 999, output_tokens: 999, cache_read_input_tokens: 999 }),
        reply('a', start + 10 * MIN, 'claude-opus-5-5', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 200 } }),
        // The same reply on a second line (one line per content block): counted once.
        reply('a', start + 10 * MIN, 'claude-opus-5-5', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 200 } }),
        ''
      ].join('\n')
    )
    // A subagent of this run.
    fs.writeFileSync(path.join(proj, 's1', 'subagents', 'agent-1.jsonl'), reply('sub', start + 20 * MIN, 'claude-opus-5-5', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000 }) + '\n')
  })

  afterEach(() => {
    delete process.env.QUOTADECK_CLAUDE_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('books what Claude Code counted beyond the run’s requests, never below zero', async () => {
    // Claude Code: Opus beyond the transcript (compaction) and a Haiku that never appears there (title + 3 web
    // searches); its Opus output is lower than the transcript's, which counts as a negative difference.
    fs.appendFileSync(
      main,
      costState(1.5, HOUR, {
        'claude-opus-5-5': { inputTokens: 5110, outputTokens: 40, cacheReadInputTokens: 61_000, cacheCreationInputTokens: 1200, webSearchRequests: 0, costUSD: 1 },
        'claude-haiku-5-5': { inputTokens: 2000, outputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 3, costUSD: 0.0303 }
      }) + '\n'
    )
    const scanner = new UsageScanner(path.join(dir, 'scan.json'))
    await scanner.scan(now, { deep: true })
    const [bg] = scanner.backgroundRuns
    expect(bg).toMatchObject({ key: `s1@${start}`, s: 's1', start, at: start + HOUR, e: 'd', negatives: 1 })
    // Transcript since the start: input 110, output 55, cache read 11 000, cache write 200 (the reply before the
    // start and the duplicate line are left out).
    expect(bg.models['claude-opus-5-5']).toMatchObject({ i: 5000, o: 0, r: 50_000, ws: 0 })
    expect(bg.models['claude-opus-5-5'].w5 + bg.models['claude-opus-5-5'].w1).toBe(1000)
    expect(bg.models['claude-haiku-5-5']).toMatchObject({ i: 2000, o: 300, r: 0, w5: 0, w1: 0, ws: 3 })
  })

  it('replaces a run’s background when a newer record arrives, and never adds it twice', async () => {
    const usage = (input: number) => ({ 'claude-opus-5-5': { inputTokens: input, outputTokens: 55, cacheReadInputTokens: 11_000, cacheCreationInputTokens: 200, webSearchRequests: 0, costUSD: 0 } })
    fs.appendFileSync(main, costState(1, 30 * MIN, usage(1110)) + '\n')
    const scanner = new UsageScanner(path.join(dir, 'scan.json'))
    const ledger = new Ledger(path.join(dir, 'ledger'))
    const book = () => {
      for (const bg of scanner.backgroundRuns) {
        const h = Math.floor(bg.at / HOUR) * HOUR
        const entries: LedgerEntry[] = Object.entries(bg.models).map(([m, t]) => ({ h, a: 'A', s: bg.s, m, i: t.i, o: t.o, w5: t.w5, w1: t.w1, r: t.r, n: 0, c: 0, u: 0, t: bg.at }))
        ledger.setBackground(bg.key, entries)
      }
    }
    const inputs = () => [...ledger.entries()].filter((e) => e.k === 'b').reduce((s, e) => s + e.i, 0)
    await scanner.scan(now, { deep: true })
    book()
    expect(inputs()).toBe(1000)
    // Reading everything again (a new scanner, e.g. after its cache was reset) books the same, not twice.
    const again = new UsageScanner(path.join(dir, 'scan2.json'))
    await again.scan(now, { deep: true })
    for (const bg of again.backgroundRuns) ledger.setBackground(bg.key, [...ledger.entries()].filter((e) => e.run === bg.key))
    book()
    expect(inputs()).toBe(1000)
    // The conversation goes on: a later record with a higher total replaces the run's background as a whole, also
    // when its hour moves. It is read again at most every 5 minutes.
    fs.appendFileSync(main, costState(2, 90 * MIN, usage(3110)) + '\n')
    await scanner.scan(now + MIN)
    book()
    expect(inputs()).toBe(1000)
    await scanner.scan(now + 6 * MIN)
    book()
    expect(inputs()).toBe(3000)
    expect([...ledger.entries()].filter((e) => e.k === 'b').map((e) => e.h)).toEqual([Math.floor((start + 90 * MIN) / HOUR) * HOUR])
    // An older record of the same run never replaces a newer one.
    fs.appendFileSync(main, costState(1.2, 40 * MIN, usage(2110)) + '\n')
    await scanner.scan(now + 20 * MIN)
    book()
    expect(inputs()).toBe(3000)
  })

  it('hands over runs older than a month before forgetting them', async () => {
    // A run from 40 days ago (a conversation file touched recently still holds it).
    const oldStart = now - 40 * 24 * HOUR
    fs.appendFileSync(
      main,
      JSON.stringify({ type: 'cost-state', sessionId: 's1', totalCostUSD: 0.5, totalDuration: HOUR, startTime: oldStart, modelUsage: { 'claude-haiku-5-5': { inputTokens: 1000, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 1, costUSD: 0.0101 } } }) + '\n'
    )
    const dropped: Array<{ key: string }> = []
    const scanner = new UsageScanner(path.join(dir, 'scan.json'))
    await scanner.scan(now, { deep: true, onDropBackground: (runs) => dropped.push(...runs) })
    expect(dropped.map((r) => r.key)).toEqual([`s1@${oldStart}`])
    expect(scanner.backgroundRuns.map((r) => r.key)).not.toContain(`s1@${oldStart}`)
  })

  it('keeps transcript requests and background entries of the same hour apart', () => {
    const ledger = new Ledger(path.join(dir, 'ledger'))
    const h = Math.floor(now / HOUR) * HOUR
    const base = { h, a: 'A', s: 's1', m: 'claude-opus-5-5', i: 1, o: 1, w5: 0, w1: 0, r: 0, n: 1, c: 0, u: 0, t: h }
    ledger.setBackground('s1@1', [{ ...base, n: 0, i: 50 }])
    // The hour's transcript requests are mirrored (replaced) as usual; the background entry stays.
    ledger.setHour(h, [base])
    ledger.setHour(h, [{ ...base, n: 2 }])
    const list = [...ledger.entries()]
    expect(list.map((e) => [e.k ?? 'request', e.n, e.i]).sort()).toEqual([
      ['b', 0, 50],
      ['request', 2, 1]
    ])
    // An hour holding only background entries is still empty for the requests that arrive later for it.
    const older = h - 30 * 24 * HOUR
    ledger.setBackground('s1@2', [{ ...base, h: older, n: 0, i: 5 }])
    ledger.sync(new Map([[older, [{ ...base, h: older, n: 4 }]]]), now, false)
    expect([...ledger.entries()].filter((e) => e.h === older).map((e) => [e.k ?? 'request', e.n]).sort()).toEqual([
      ['b', 0],
      ['request', 4]
    ])
    ledger.save(true)
    // Read back: the run's entries are found again and can still be replaced.
    const again = new Ledger(path.join(dir, 'ledger'))
    again.setBackground('s1@1', [{ ...base, n: 0, i: 70 }])
    expect([...again.entries()].filter((e) => e.run === 's1@1').map((e) => e.i)).toEqual([70])
    expect([...again.entries()].filter((e) => e.run === 's1@2').map((e) => e.i)).toEqual([5])
  })
})
