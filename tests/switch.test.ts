// The desktop switch follow-up: QuotaDeck notices the sign-in, copies the continue prompt and says where the
// conversation is; it also notices a wrong account and gives up after 30 minutes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, PendingSwitch } from '../src/shared/types'
import type { Notice } from '../src/main/core/engine'

const MIN = 60_000
const A: Account = { id: 'A', accountUuid: 'ua', orgUuid: 'oa', email: 'a@example.com', nickname: '主号', color: '#000000', addedAt: 0 }
const B: Account = { id: 'B', accountUuid: 'ub', orgUuid: 'ob', email: 'b@example.com', nickname: '副号', color: '#ffffff', addedAt: 0 }

interface EngineInternals {
  s: { accounts: Account[]; pendingSwitch?: PendingSwitch; settings: { continuePrompt: string; language: string } }
  desktopDir?: string
  desktopCurrent: { accountUuid?: string; orgUuid?: string; since?: number }
  checkPendingSwitch(): void
}

describe('pending desktop switch', () => {
  let dir: string
  let engine: EngineInternals & { on(ev: string, cb: (v: unknown) => void): void }
  const notices: Notice[] = []
  const copied: string[] = []
  const progress: PendingSwitch[] = []

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-switch-'))
    process.env.QUOTADECK_HOME = path.join(dir, 'home')
    const { Engine } = await import('../src/main/core/engine')
    const e = new Engine({ appVersion: 'test', locale: 'zh-CN', notify: (n) => notices.push(n), trash: async () => {}, openDesktop: async () => true })
    engine = e as unknown as typeof engine
    engine.s.accounts = [A, B]
    engine.s.settings.language = 'zh-CN'
    engine.s.settings.continuePrompt = '继续刚才的工作'
    // B's desktop list already holds the conversation (the merge copied it before the switch).
    engine.desktopDir = path.join(dir, 'desktop')
    fs.mkdirSync(path.join(engine.desktopDir, 'claude-code-sessions', 'ub', 'ob'), { recursive: true })
    fs.writeFileSync(path.join(engine.desktopDir, 'claude-code-sessions', 'ub', 'ob', 'local_x.json'), '{}')
    engine.on('copy-text', (t) => copied.push(t as string))
    engine.on('switch-progress', (p) => progress.push(p as PendingSwitch))
    notices.length = copied.length = progress.length = 0
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    delete process.env.QUOTADECK_HOME
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const pending = (startedAt: number): PendingSwitch => ({
    id: 'p',
    fromAccountId: 'A',
    toAccountId: 'B',
    conversation: { cliSessionId: '11111111-1111-4111-8111-111111111111', desktopSessionId: 'local_x', title: '订单导出' },
    startedAt,
    phase: 'waiting'
  })

  it('finishes when the desktop app signs in with the target', () => {
    const now = Date.now()
    engine.s.pendingSwitch = pending(now - MIN)
    // Still on the old account: keep waiting.
    engine.desktopCurrent = { accountUuid: 'ua', since: now }
    engine.checkPendingSwitch()
    expect(engine.s.pendingSwitch?.phase).toBe('waiting')
    // A reading from before the switch started does not count.
    engine.desktopCurrent = { accountUuid: 'ub', since: now - 2 * MIN }
    engine.checkPendingSwitch()
    expect(engine.s.pendingSwitch?.phase).toBe('waiting')

    engine.desktopCurrent = { accountUuid: 'ub', since: now }
    engine.checkPendingSwitch()
    expect(engine.s.pendingSwitch).toMatchObject({ phase: 'done', copiedPrompt: true, conversation: { inTargetList: true } })
    expect(copied).toEqual(['继续刚才的工作'])
    expect(notices[0]).toMatchObject({ title: '已切到 副号', body: '刚才的「订单导出」在左侧列表里，点开后粘贴就能接着聊' })
    expect(progress.map((p) => p.phase)).toEqual(['done'])
  })

  it('tells when the desktop app signed in with another account', () => {
    const now = Date.now()
    engine.s.pendingSwitch = pending(now - MIN)
    engine.desktopCurrent = { accountUuid: 'someone-else', since: now }
    engine.checkPendingSwitch()
    expect(engine.s.pendingSwitch).toMatchObject({ phase: 'wrong-account', actualAccountId: undefined })
    expect(notices[0].title).toBe('桌面端登录的号不在面板里，不是 副号')
    expect(copied).toEqual([])
  })

  it('does not copy the prompt when the conversation is missing from the target list', () => {
    const now = Date.now()
    engine.s.pendingSwitch = { ...pending(now - MIN), conversation: { cliSessionId: '11111111-1111-4111-8111-111111111111', desktopSessionId: 'local_y', title: '新对话' } }
    engine.desktopCurrent = { accountUuid: 'ub', since: now }
    engine.checkPendingSwitch()
    expect(engine.s.pendingSwitch).toMatchObject({ phase: 'done', copiedPrompt: false, conversation: { inTargetList: false } })
    expect(copied).toEqual([])
    expect(notices[0].body).toContain('没来得及同步')
  })

  it('stops waiting after 30 minutes', () => {
    engine.s.pendingSwitch = pending(Date.now() - 31 * MIN)
    engine.checkPendingSwitch()
    expect(engine.s.pendingSwitch).toBeUndefined()
    expect(progress.map((p) => p.phase)).toEqual(['expired'])
  })
})
