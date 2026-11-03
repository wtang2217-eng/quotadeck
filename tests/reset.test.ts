// A limit seen only in the desktop app's records (no hook, no reset time) still ends with a "you can switch back"
// notification, at the reset the estimate worked out from when the 5-hour window started.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, LimitInfo, UsageEstimate } from '../src/shared/types'
import type { Notice } from '../src/main/core/engine'

const MIN = 60_000
const T0 = Date.UTC(2026, 10, 3, 12, 0)
const A: Account = { id: 'A', accountUuid: 'ua', orgUuid: 'oa', email: 'a@example.com', nickname: '主号', color: '#000000', addedAt: 0 }
const B: Account = { id: 'B', accountUuid: 'ub', orgUuid: 'ob', email: 'b@example.com', nickname: '副号', color: '#ffffff', addedAt: 0 }

interface EngineInternals {
  s: { accounts: Account[]; limits: Record<string, LimitInfo>; settings: { language: string; notifyOnReset: boolean; notifyOnLimit: boolean } }
  samples: Array<{ t: number; org: string; fh?: number; sd?: number }>
  estimates: Map<string, UsageEstimate>
  desktopCurrent: { accountUuid?: string; since?: number }
  evaluate(initial: boolean): void
}

describe('reset reminder for a limit seen in desktop records', () => {
  let dir: string
  let engine: EngineInternals
  const notices: Notice[] = []

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-reset-'))
    process.env.QUOTADECK_HOME = dir
    process.env.QUOTADECK_CLAUDE_DIR = path.join(dir, 'claude')
    const { Engine } = await import('../src/main/core/engine')
    engine = new Engine({ appVersion: 'test', locale: 'zh-CN', notify: (n) => notices.push(n), trash: async () => {}, openDesktop: async () => true }) as unknown as EngineInternals
    engine.s.accounts = [A, B]
    engine.s.settings.language = 'zh-CN'
    notices.length = 0
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    delete process.env.QUOTADECK_HOME
    delete process.env.QUOTADECK_CLAUDE_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('announces the limit with the estimated reset, then the reset', () => {
    // The main account's last record says 100%; its window opened 4 hours ago, so it resets in an hour.
    engine.samples = [{ t: T0 - 5 * MIN, org: 'oa', fh: 100, sd: 50 }]
    engine.estimates = new Map([['A', { at: T0, fiveHour: 100, fiveHourResetsAt: T0 + 60 * MIN, basis: 'own-history', fromRecordAt: T0 - 5 * MIN }]])
    // The user already moved the desktop app to the second account.
    engine.desktopCurrent = { accountUuid: 'ub', since: T0 - MIN }
    engine.evaluate(false)
    expect(engine.s.limits.A).toMatchObject({ kind: 'session', resetsAt: T0 + 60 * MIN })
    expect(notices.map((n) => n.kind)).toEqual(['limit'])

    // Half an hour later nothing changes.
    vi.setSystemTime(T0 + 30 * MIN)
    engine.evaluate(false)
    expect(notices).toHaveLength(1)

    // After the reset: no new record arrives for an account that is not signed in, but the window is over.
    vi.setSystemTime(T0 + 61 * MIN)
    engine.estimates = new Map()
    engine.evaluate(false)
    expect(engine.s.limits.A).toBeUndefined()
    expect(notices[1]).toEqual({ kind: 'reset', title: '主号 的额度已恢复，可以换回去了', action: { type: 'open-switch', fromAccountId: 'B', toAccountId: 'A' } })
  })
})
