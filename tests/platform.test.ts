import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountView, AppState } from '@shared/types'
import { defaultSettings } from '@shared/defaults'
import { macMenuTemplate } from '../src/main/appMenu'
import { menuBarTitle } from '../src/main/core/menuBarTitle'
import { popoverPosition, type Rect } from '../src/main/core/popoverPlacement'
import { titleBarOptions } from '../src/main/windowChrome'

vi.mock('electron', () => ({ app: {} }))

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const asPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p })

describe('tray popover placement', () => {
  const size = { width: 360, height: 480 }
  const full: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

  it('opens right under a macOS menu bar icon', () => {
    const pos = popoverPosition({ tray: { x: 1500, y: 0, width: 28, height: 24 }, display: full, workArea: { x: 0, y: 25, width: 1920, height: 1055 }, size, gap: 6 })
    expect(pos).toEqual({ x: 1334, y: 31 })
  })

  it('keeps a menu bar popover on screen at the right edge', () => {
    const pos = popoverPosition({ tray: { x: 1900, y: 0, width: 20, height: 24 }, display: full, workArea: { x: 0, y: 25, width: 1920, height: 1055 }, size, gap: 6 })
    expect(pos.x).toBe(1920 - 360 - 6)
  })

  it('opens above the Windows taskbar tray', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1032 }
    const pos = popoverPosition({ tray: { x: 1700, y: 1040, width: 32, height: 40 }, display: full, workArea, size, gap: 12 })
    expect(pos).toEqual({ x: 1536, y: 1032 - 480 - 12 })
  })

  it('handles taskbars on the left, top and right', () => {
    const left = popoverPosition({ tray: { x: 8, y: 900, width: 32, height: 32 }, display: full, workArea: { x: 48, y: 0, width: 1872, height: 1080 }, size, gap: 12 })
    expect(left).toEqual({ x: 48 + 12, y: 1080 - 480 - 12 })
    const top = popoverPosition({ tray: { x: 1700, y: 8, width: 32, height: 32 }, display: full, workArea: { x: 0, y: 48, width: 1920, height: 1032 }, size, gap: 12 })
    expect(top).toEqual({ x: 1536, y: 60 })
    const rightBar = popoverPosition({ tray: { x: 1880, y: 500, width: 32, height: 32 }, display: full, workArea: { x: 0, y: 0, width: 1872, height: 1080 }, size, gap: 12 })
    expect(rightBar).toEqual({ x: 1872 - 360 - 12, y: 276 })
  })

  it('goes above the icon when the taskbar auto-hides', () => {
    const pos = popoverPosition({ tray: { x: 1700, y: 1036, width: 32, height: 40 }, display: full, workArea: full, size, gap: 12 })
    expect(pos.y).toBe(1036 - 480 - 12)
  })

  it('falls back to the cursor when the icon bounds are unknown', () => {
    const pos = popoverPosition({ tray: { x: 0, y: 0, width: 0, height: 0 }, display: full, workArea: { x: 0, y: 0, width: 1920, height: 1032 }, size, cursor: { x: 1800, y: 1060 }, gap: 12 })
    expect(pos).toEqual({ x: 1920 - 360 - 12, y: 1032 - 480 - 12 })
  })

  it('works on a second display with negative coordinates', () => {
    const display = { x: -1600, y: 0, width: 1600, height: 900 }
    const pos = popoverPosition({ tray: { x: -200, y: 860, width: 32, height: 40 }, display, workArea: { x: -1600, y: 0, width: 1600, height: 852 }, size, gap: 12 })
    expect(pos).toEqual({ x: -1600 + 1600 - 360 - 12, y: 852 - 480 - 12 })
  })
})

describe('menu bar title', () => {
  const state = (patch: Partial<AppState['settings']> = {}) => ({ settings: { ...defaultSettings('zh-CN'), timezone: 'Asia/Shanghai', ...patch } }) as AppState
  const account = (a: Partial<AccountView>) => ({ status: 'ok', isDesktopCurrent: true, history: [], desktopSessionCount: 0, ...a }) as AccountView

  it('shows the 5-hour percent, the estimate only when it is higher', () => {
    expect(menuBarTitle(state(), account({ usage: { at: 1, source: 'desktop', fiveHour: { pct: 23.4 } } as AccountView['usage'] }))).toBe('23%')
    expect(menuBarTitle(state(), account({ usage: { at: 1, source: 'desktop', fiveHour: { pct: 23 } } as AccountView['usage'], estimate: { at: 2, fiveHour: 27.2, basis: 'own-history' } }))).toBe('~27%')
    expect(menuBarTitle(state(), account({ usage: { at: 1, source: 'desktop', fiveHour: { pct: 30 } } as AccountView['usage'], estimate: { at: 2, fiveHour: 29, basis: 'own-history' } }))).toBe('30%')
  })

  it('shows when a limited account is back', () => {
    const resetsAt = Date.UTC(2030, 0, 1, 11, 10)
    const title = menuBarTitle(state(), account({ status: 'limited', limit: { kind: 'session', resetsAt } as AccountView['limit'] }))
    expect(title).toMatch(/^↻.*19:10$/)
  })

  it('is empty when switched off or nothing is known', () => {
    expect(menuBarTitle(state({ trayShowPercent: false }), account({ usage: { at: 1, source: 'desktop', fiveHour: { pct: 50 } } as AccountView['usage'] }))).toBe('')
    expect(menuBarTitle(state(), account({}))).toBe('')
    expect(menuBarTitle(state(), undefined)).toBe('')
  })
})

describe('macOS menu', () => {
  const actions = { openSettings: vi.fn(), openAbout: vi.fn(), openUrl: vi.fn() }

  it('has the edit roles text fields need and ⌘, for settings', () => {
    const menu = macMenuTemplate('zh-CN', actions, false)
    const roles = menu.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : [])).map((i) => i.role)
    for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'close', 'quit', 'hide']) expect(roles).toContain(r)
    expect(roles).not.toContain('toggleDevTools')
    const app = menu[0].submenu as Electron.MenuItemConstructorOptions[]
    const settings = app.find((i) => i.accelerator === 'Command+,')!
    expect(settings.label).toBe('设置…')
    ;(settings.click as () => void)()
    expect(actions.openSettings).toHaveBeenCalled()
    expect(menu[1].label).toBe('编辑')
  })

  it('adds developer items only in dev builds, English labels for English', () => {
    const menu = macMenuTemplate('en', actions, true)
    const roles = menu.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : [])).map((i) => i.role)
    expect(roles).toContain('toggleDevTools')
    expect(menu[1].label).toBe('Edit')
  })
})

describe('window chrome', () => {
  it('hides the title bar on macOS and Windows, keeps the frame on Linux', () => {
    expect(titleBarOptions('darwin', false)).toMatchObject({ titleBarStyle: 'hiddenInset' })
    const win = titleBarOptions('win32', true)
    expect(win.titleBarStyle).toBe('hidden')
    expect(win.titleBarOverlay).toMatchObject({ color: '#00000000', height: 40 })
    expect((win.titleBarOverlay as { symbolColor: string }).symbolColor).not.toBe((titleBarOptions('win32', false).titleBarOverlay as { symbolColor: string }).symbolColor)
    expect(titleBarOptions('linux', false)).toEqual({})
  })
})

describe('linux autostart entry', () => {
  it('quotes paths the way desktop entries need', async () => {
    const { desktopExecArg, linuxAutostartEntry } = await import('../src/main/loginItem')
    expect(desktopExecArg('/opt/QuotaDeck/quotadeck')).toBe('/opt/QuotaDeck/quotadeck')
    expect(desktopExecArg('/home/a b/QuotaDeck.AppImage')).toBe('"/home/a b/QuotaDeck.AppImage"')
    expect(desktopExecArg('/x/100%/$y')).toBe('"/x/100%%/\\$y"')
    expect(linuxAutostartEntry('/opt/QuotaDeck/quotadeck')).toContain('Exec=/opt/QuotaDeck/quotadeck --hidden')
  })
})

describe('macOS paths and desktop detection', () => {
  let home: string
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-mac-'))
    process.env.HOME = home
    process.env.USERPROFILE = home
    asPlatform('darwin')
    vi.resetModules()
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
    process.env.HOME = saved.HOME
    process.env.USERPROFILE = saved.USERPROFILE
    vi.restoreAllMocks()
    vi.resetModules()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('finds the desktop data folder under Application Support, newest first', async () => {
    const support = path.join(home, 'Library', 'Application Support')
    const classic = path.join(support, 'Claude')
    const nested = path.join(support, 'Claude-Data', 'claude_abc')
    fs.mkdirSync(path.join(classic, 'claude-code-sessions'), { recursive: true })
    fs.mkdirSync(path.join(nested, 'claude-code-sessions'), { recursive: true })
    fs.writeFileSync(path.join(nested, 'plan-usage-history.json'), '[]')
    const old = new Date(Date.now() - 86_400_000)
    fs.utimesSync(path.join(classic, 'claude-code-sessions'), old, old)
    fs.mkdirSync(path.join(support, 'Claude-3p'), { recursive: true }) // no session store: ignored
    const { desktopDataDirCandidates } = await import('../src/main/core/paths')
    expect(desktopDataDirCandidates()).toEqual([nested, classic])
  })

  it('reads the Chromium SingletonLock to tell whether the desktop app runs', async () => {
    const dir = path.join(home, 'data')
    fs.mkdirSync(dir)
    const { isDesktopRunning } = await import('../src/main/core/desktop')
    expect(isDesktopRunning(dir)).toBe(false) // no lock
    const spy = vi.spyOn(fs, 'readlinkSync').mockReturnValue(`my-mac.local-${process.pid}`)
    expect(isDesktopRunning(dir)).toBe(true)
    spy.mockReturnValue('my-mac.local-2147483000')
    expect(isDesktopRunning(dir)).toBe(false) // stale lock left by a crash
    expect(spy).toHaveBeenCalledWith(path.join(dir, 'SingletonLock'))
  })
})
