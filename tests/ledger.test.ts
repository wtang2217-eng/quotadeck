import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UsageScanner, type UsageBucket } from '../src/main/core/estimate'
import { entriesFrom, Ledger, MIRROR_MS } from '../src/main/core/ledger'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const bucket = (p: Partial<UsageBucket> & { h: number; s: string }): UsageBucket => ({
  m: 'claude-opus-5-5',
  u: 1,
  n: 1,
  i: 10,
  o: 1,
  r: 100,
  w5: 5,
  w1: 2,
  c: 0.1,
  t: p.h + 60_000,
  ...p
})

describe('Ledger', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-ledger-'))
  })
  afterEach(() => {
    delete process.env.QUOTADECK_CLAUDE_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('sums buckets per hour, account, conversation and model, and keeps the organization of unknown ones', () => {
    const h = Date.UTC(2026, 10, 3, 1)
    const byHour = entriesFrom(
      [bucket({ h, s: 's', e: 'd', g: 'oa' }), bucket({ h, s: 's', e: 'c' }), bucket({ h, s: 's', g: 'ox' })],
      (b) => (b.g === 'ox' ? '' : 'A')
    )
    const list = byHour.get(h)!
    expect(list).toHaveLength(2)
    expect(list.find((e) => e.a === 'A')).toMatchObject({ n: 2, i: 20, w5: 10, w1: 4, g: undefined })
    expect(list.find((e) => e.a === '')).toMatchObject({ n: 1, g: 'ox' })
  })

  it('replaces recent hours, freezes older ones, and never counts a request twice', () => {
    const now = Date.UTC(2026, 10, 3, 12)
    const recent = now - 3 * HOUR
    const old = now - 10 * DAY
    const ledger = new Ledger(dir)
    const first = entriesFrom([bucket({ h: recent, s: 's' }), bucket({ h: old, s: 's' })], () => 'A')
    expect(ledger.sync(first, now)).toBe(true)
    // The scanner reads the same transcripts again (e.g. after its cache was reset): nothing doubles.
    expect(ledger.sync(first, now)).toBe(false)
    expect([...ledger.entries()].reduce((s, e) => s + e.n, 0)).toBe(2)
    // More requests arrive in the recent hour; the old hour is frozen even if the scanner now says otherwise.
    const second = entriesFrom([bucket({ h: recent, s: 's', n: 5 }), bucket({ h: old, s: 's', n: 9 })], () => 'A')
    ledger.sync(second, now)
    expect([...ledger.entries()].map((e) => [e.h, e.n]).sort()).toEqual([
      [old, 1],
      [recent, 5]
    ])
    // A gap (QuotaDeck was not running) is filled once, then frozen too.
    const gap = now - 5 * DAY
    ledger.sync(entriesFrom([bucket({ h: gap, s: 't', n: 3 })], () => 'B'), now, false)
    ledger.sync(entriesFrom([bucket({ h: gap, s: 't', n: 30 })], () => 'B'), now, false)
    expect([...ledger.entries()].find((e) => e.h === gap)?.n).toBe(3)
    expect(MIRROR_MS).toBe(48 * HOUR)
  })

  it('writes one file per month atomically and reads it back with names and titles', () => {
    const now = Date.UTC(2026, 10, 3, 12)
    const ledger = new Ledger(dir)
    ledger.sync(entriesFrom([bucket({ h: Date.UTC(2026, 9, 31, 23), s: 's' }), bucket({ h: Date.UTC(2026, 10, 1, 0), s: 's' })], () => 'A'), now)
    ledger.setAccount('A', { email: 'a@example.com', nickname: '主号', plan: 'Max 5x' })
    ledger.setSession('s', { title: '重构支付', cwd: 'D:\\shop' })
    ledger.save(true)
    expect(fs.readdirSync(dir).sort()).toEqual(['2026-10.json', '2026-11.json', 'meta.json'])
    const again = new Ledger(dir)
    expect(again.size).toBe(2)
    expect(again.firstHour).toBe(Date.UTC(2026, 9, 31, 23))
    expect(again.account('A')).toEqual({ email: 'a@example.com', nickname: '主号', plan: 'Max 5x' })
    expect(again.session('s')).toEqual({ title: '重构支付', cwd: 'D:\\shop' })
    // Nothing changed: nothing is written.
    const before = fs.statSync(path.join(dir, '2026-11.json')).mtimeMs
    again.save(true)
    expect(fs.statSync(path.join(dir, '2026-11.json')).mtimeMs).toBe(before)
  })

  it('backfills the whole history on the first scan and keeps what ages out of the scanner', async () => {
    process.env.QUOTADECK_CLAUDE_DIR = path.join(dir, 'claude')
    const proj = path.join(dir, 'claude', 'projects', 'p')
    fs.mkdirSync(proj, { recursive: true })
    const now = Date.now()
    const line = (id: string, t: number) =>
      JSON.stringify({ type: 'assistant', timestamp: new Date(t).toISOString(), requestId: 'r' + id, entrypoint: 'cli', sessionId: 's1', message: { id, model: 'claude-opus-5-5', usage: { output_tokens: 1000 } } })
    // One request 40 days ago (older than the scanner's month) and one now, in a recently touched file.
    fs.writeFileSync(path.join(proj, 's1.jsonl'), [line('old', now - 40 * DAY), line('new', now - 60_000), ''].join('\n'))
    const ledger = new Ledger(path.join(dir, 'ledger'))
    const scanner = new UsageScanner(path.join(dir, 'scan.json'))
    await scanner.scan(now, { deep: true, onDrop: (old) => ledger.sync(entriesFrom(old, () => 'A'), now, false) })
    ledger.sync(entriesFrom(Object.values(scanner.buckets), () => 'A'), now)
    expect(Object.values(scanner.buckets)).toHaveLength(1)
    expect([...ledger.entries()].map((e) => e.n)).toEqual([1, 1])
    // Later scans only read what is new; the ledger keeps both requests.
    fs.appendFileSync(path.join(proj, 's1.jsonl'), line('newer', now) + '\n')
    await scanner.scan(now, { deep: true, onDrop: (old) => ledger.sync(entriesFrom(old, () => 'A'), now, false) })
    ledger.sync(entriesFrom(Object.values(scanner.buckets), () => 'A'), now)
    expect([...ledger.entries()].reduce((s, e) => s + e.n, 0)).toBe(3)
  })
})
