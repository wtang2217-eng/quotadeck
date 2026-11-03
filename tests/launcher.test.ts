import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawned: Array<{ file: string; args: string[] }> = []
vi.mock('node:child_process', () => ({
  spawn: (file: string, args: string[]) => {
    spawned.push({ file, args })
    return { on: () => undefined, unref: () => undefined }
  },
  execFile: (_f: string, _a: string[], _o: unknown, cb: (err: Error | null) => void) => cb(new Error('not found'))
}))

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, QUOTADECK_HOME: process.env.QUOTADECK_HOME }
let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-launch-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.QUOTADECK_HOME = path.join(home, '.quotadeck')
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  spawned.length = 0
  vi.resetModules()
})
afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform)
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  fs.rmSync(home, { recursive: true, force: true })
})

describe('continue in a macOS terminal', () => {
  it('writes a .command script and opens it in Terminal', async () => {
    const { launchInTerminal } = await import('../src/main/core/launcher')
    const project = path.join(home, "it's 项目")
    fs.mkdirSync(project)
    await launchInTerminal({
      cliPath: undefined,
      configDir: path.join(home, '.quotadeck', 'profiles', 'p-1'),
      cwd: project,
      resumeId: '0b8f1d2e-1111-4222-8333-944445555666',
      prompt: '继续刚才的工作',
      title: 'QuotaDeck · 副号',
      banner: '以 副号 继续',
      terminal: 'auto'
    })
    expect(spawned).toHaveLength(1)
    const { file, args } = spawned[0]
    expect(file).toBe('open')
    expect(args.slice(0, 2)).toEqual(['-a', 'Terminal'])
    const script = fs.readFileSync(args[2], 'utf8')
    expect(args[2].endsWith('.command')).toBe(true)
    expect(script.startsWith('#!/bin/bash\n')).toBe(true)
    expect(script).toContain(`export CLAUDE_CONFIG_DIR='${path.join(home, '.quotadeck', 'profiles', 'p-1')}'`)
    expect(script).toContain(`cd '${project.replace(/'/g, `'\\''`)}' || exit 1`)
    expect(script).toContain(`'claude' '--resume' '0b8f1d2e-1111-4222-8333-944445555666' '继续刚才的工作'`)
    expect(script.trimEnd().endsWith('exec "${SHELL:-/bin/bash}" -l')).toBe(true)
  })

  it('runs the main account with CLAUDE_CONFIG_DIR unset', async () => {
    const { launchInTerminal } = await import('../src/main/core/launcher')
    await launchInTerminal({ configDir: path.join(home, '.claude'), title: 'QuotaDeck', banner: 'x', terminal: 'auto' })
    const script = fs.readFileSync(spawned[0].args[2], 'utf8')
    expect(script).toContain('unset CLAUDE_CONFIG_DIR')
    expect(script).not.toContain('export CLAUDE_CONFIG_DIR')
  })

  it('uses iTerm only when it is installed', async () => {
    const { launchInTerminal } = await import('../src/main/core/launcher')
    await launchInTerminal({ title: 'QuotaDeck', banner: 'x', terminal: 'iterm' })
    expect(spawned[0].args.slice(0, 2)).toEqual(['-a', 'Terminal'])
    fs.mkdirSync(path.join(home, 'Applications', 'iTerm.app'), { recursive: true })
    await launchInTerminal({ title: 'QuotaDeck', banner: 'x', terminal: 'iterm' })
    expect(spawned[1].args.slice(0, 2)).toEqual(['-a', 'iTerm'])
  })
})
