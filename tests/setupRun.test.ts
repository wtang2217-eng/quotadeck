// runSetup end to end, with Claude Code's folder pointed at a temp directory: it connects the integration, turns on
// "open at login", reports each step, and stops opening the setup page by itself afterwards.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SetupProgress } from '../src/shared/types'

describe('runSetup', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-setuprun-'))
    process.env.QUOTADECK_HOME = path.join(dir, 'home')
    process.env.QUOTADECK_CLAUDE_DIR = path.join(dir, 'claude')
    fs.mkdirSync(process.env.QUOTADECK_CLAUDE_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.QUOTADECK_HOME
    delete process.env.QUOTADECK_CLAUDE_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does the fixable steps in order and reports them', async () => {
    const { Engine } = await import('../src/main/core/engine')
    const ran: string[] = []
    const e = new Engine({
      appVersion: 'test',
      locale: 'en',
      notify: () => {},
      trash: async () => {},
      openDesktop: async () => true,
      // The installer must not run here; if Claude Code were missing this records the attempt instead.
      runCommand: async (file, args) => {
        ran.push(`${file} ${args.join(' ')}`)
        return { code: 1 }
      }
    })
    expect(e.getState().needsSetup).toBe(true)
    const events: SetupProgress[] = []
    const finished = new Promise<SetupProgress>((resolve) =>
      e.on('setup-progress', (p: SetupProgress) => {
        events.push(p)
        if (p.phase === 'done') resolve(p)
      })
    )
    await e.runSetup({ installCli: true, connectIntegration: true, openAtLogin: true })
    const last = await finished
    const steps = events.filter((p) => p.step && p.phase !== 'running').map((p) => `${p.step}:${p.phase}`)
    expect(steps.slice(-3)).toEqual(['main-account:skipped', 'integration:ok', 'open-at-login:ok'])
    const settings = JSON.parse(fs.readFileSync(path.join(dir, 'claude', 'settings.json'), 'utf8'))
    expect(JSON.stringify(settings.hooks.StopFailure)).toContain('/qd/hook/stop-failure')
    expect(e.settings.openAtLogin).toBe(true)
    // Whether Claude Code is installed depends on the computer; either way the run ends with a status.
    expect(last.status?.checks.find((c) => c.id === 'integration')?.state).toBe('ok')
    if (last.ok) expect(e.getState().needsSetup).toBe(false)
    else expect(ran).toHaveLength(1)
    await e.stop()
  }, 30_000)
})
