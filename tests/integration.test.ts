import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { install, probe, uninstall } from '../src/main/core/integration'

let dir: string
let file: string
const cfg = { port: 41117, key: 'test-key' }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-int-'))
  process.env.QUOTADECK_HOME = path.join(dir, 'qd')
  file = path.join(dir, 'settings.json')
  fs.writeFileSync(
    file,
    JSON.stringify({ model: 'opus', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }], StopFailure: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }, null, 2)
  )
})
afterEach(() => {
  delete process.env.QUOTADECK_HOME
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('integration', () => {
  it('adds the hook and status line without touching anything else, idempotently', () => {
    install(cfg, { hooks: true, statusLine: true }, file)
    install(cfg, { hooks: true, statusLine: true }, file)
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(json.model).toBe('opus')
    expect(json.hooks.UserPromptSubmit).toHaveLength(1)
    expect(json.hooks.StopFailure).toHaveLength(2)
    expect(json.hooks.StopFailure[1].hooks[0].url).toBe('http://127.0.0.1:41117/qd/hook/stop-failure')
    expect(json.statusLine.command).toContain('/qd/statusline')
    expect(probe(cfg, file)).toMatchObject({ hooksInstalled: true, statusLineInstalled: true, stale: false })
    expect(probe({ port: 50000, key: 'other' }, file).stale).toBe(true)
    // A backup of the previous file was written.
    expect(fs.readdirSync(path.join(dir, 'qd', 'backups', 'settings')).length).toBeGreaterThan(0)
  })

  it('keeps a foreign status line unless asked, and restores it on uninstall', () => {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    json.statusLine = { type: 'command', command: 'my-statusline.sh' }
    fs.writeFileSync(file, JSON.stringify(json))
    expect(install(cfg, { hooks: false, statusLine: true }, file).statusLineConflict).toBe('my-statusline.sh')
    const r = install(cfg, { hooks: true, statusLine: true, replaceStatusLine: true }, file)
    expect(r.replacedStatusLine).toEqual({ type: 'command', command: 'my-statusline.sh' })
    uninstall(r.replacedStatusLine, file)
    const after = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(after.statusLine.command).toBe('my-statusline.sh')
    expect(after.hooks.StopFailure).toEqual([{ hooks: [{ type: 'command', command: 'mine' }] }])
  })

  it('writes in place so hard links survive', () => {
    const link = path.join(dir, 'linked.json')
    fs.linkSync(file, link)
    install(cfg, { hooks: true, statusLine: false }, file)
    expect(fs.readFileSync(link, 'utf8')).toContain('/qd/hook/stop-failure')
  })

  it('refuses to overwrite a broken file', () => {
    fs.writeFileSync(file, '{ not json')
    expect(() => install(cfg, { hooks: true, statusLine: true }, file)).toThrow(/not valid JSON/)
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json')
  })
})
