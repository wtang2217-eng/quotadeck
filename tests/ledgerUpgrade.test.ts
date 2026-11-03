// An older ledger (no price tiers, costs from an old table) is upgraded on the first full read of the transcripts:
// hours whose transcripts still exist are rebuilt with their tiers, the rest keep their tokens and are repriced.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, UsageStats } from '../src/shared/types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const A: Account = { id: 'A', accountUuid: 'ua', orgUuid: '00000000-0000-4000-8000-00000000000a', email: 'a@example.com', color: '#000000', addedAt: 0, usesDefaultCliDir: true }

describe('ledger upgrade', () => {
  let dir: string
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-upgrade-'))
    process.env.QUOTADECK_HOME = path.join(dir, 'home')
    process.env.QUOTADECK_CLAUDE_DIR = path.join(dir, 'claude')
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    delete process.env.QUOTADECK_HOME
    delete process.env.QUOTADECK_CLAUDE_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rebuilds what the transcripts still hold and reprices the rest', async () => {
    const now = Date.now()
    const tKept = now - 20 * DAY
    const tBack = now - 10 * DAY
    const hour = (t: number) => Math.floor(t / HOUR) * HOUR
    // The old ledger: one conversation whose transcript is gone, one still on disk. Old costs are wrong on purpose.
    const ledgerDir = path.join(dir, 'home', 'ledger')
    fs.mkdirSync(ledgerDir, { recursive: true })
    const old = (t: number, s: string, m: string) => ({ h: hour(t), a: 'A', s, m, i: 0, o: 0, w5: 0, w1: 0, r: 1_000_000, n: 1, c: 99, u: 1, t })
    const month = (t: number) => new Date(hour(t)).toISOString().slice(0, 7)
    const files = new Map<string, unknown[]>()
    for (const [t, s, m] of [
      [tKept, 'gone', 'claude-sonnet-5-5'],
      [tBack, 'back', 'claude-opus-5-5']
    ] as const)
      files.set(month(t), [...(files.get(month(t)) ?? []), old(t, s, m)])
    for (const [m, entries] of files) fs.writeFileSync(path.join(ledgerDir, `${m}.json`), JSON.stringify({ version: 1, month: m, entries }))
    fs.writeFileSync(path.join(ledgerDir, 'meta.json'), JSON.stringify({ version: 1, sessions: {}, accounts: {} }))
    // The transcript of "back" is still there, and its request ran in US-only inference.
    const proj = path.join(dir, 'claude', 'projects', 'p')
    fs.mkdirSync(proj, { recursive: true })
    const reply = { type: 'assistant', timestamp: new Date(tBack).toISOString(), requestId: 'r1', entrypoint: 'cli', sessionId: 'back', message: { id: 'm1', model: 'claude-opus-5-5', usage: { cache_read_input_tokens: 1_000_000, inference_geo: 'us' } } }
    fs.writeFileSync(path.join(proj, 'back.jsonl'), JSON.stringify(reply) + '\n')

    const { Engine } = await import('../src/main/core/engine')
    const e = new Engine({ appVersion: 'test', locale: 'en', notify: () => {}, trash: async () => {}, openDesktop: async () => true }) as unknown as {
      s: { accounts: Account[] }
      lastRebuild?: { rebuilt: number; kept: number }
      getStats(q: { range: 'all' }): Promise<UsageStats>
      stop(): Promise<void>
    }
    e.s.accounts = [A]
    const s = await e.getStats({ range: 'all' })
    expect(e.lastRebuild).toMatchObject({ rebuilt: 1, kept: 0 })
    // "back": rebuilt from its transcript, US-only on Opus 5.5 = 1M cache reads × $0.20 × 1.1.
    const opus = s.models.find((m) => m.label === 'Opus 5.5')!
    expect(opus.costUsd).toBeCloseTo(0.22)
    // "gone": no transcript, kept with its tokens and repriced at the page's $0.10 Sonnet 5.5 cache read.
    expect(s.models.find((m) => m.label === 'Sonnet 5.5')?.costUsd).toBeCloseTo(0.1)
    expect(s.totals.requests).toBe(2)
    await e.stop()
    // Upgraded once: the files now carry the price version and the schema.
    const meta = JSON.parse(fs.readFileSync(path.join(ledgerDir, 'meta.json'), 'utf8'))
    expect(meta.schema).toBe(2)
  }, 30_000)
})
