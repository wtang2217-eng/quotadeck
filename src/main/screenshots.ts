// `--demo --screenshots=<dir>`: walks through the pages with demo data in both languages and themes and saves
// PNGs for the README. With QD_SHOTS=review it saves the design review set instead (launch screen, overview,
// ledger, switch dialog). `--capture=<dir>`: the same walk with the real data and the current settings, nothing changed.

import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'
import type { AccentChoice, Density, Language, Page, Settings, ThemeSetting, UiCommand } from '@shared/types'
import type { Backend } from './backend'
import { sendCommand } from './ipc'
import { captureSplash } from './splash'

interface Shot {
  name: string
  lang?: Language
  theme?: Exclude<ThemeSetting, 'system'>
  accent?: AccentChoice
  density?: Density
  /** Page script to run first, e.g. to pick a remembered filter. */
  prep?: string
  /** Taller window for a whole-page picture. */
  height?: number
  /** The launch screen or the tray popover instead of a page of the main window. */
  kind?: 'splash' | 'tray'
  commands: UiCommand[]
}

const PAGE = (page: Page): UiCommand => ({ type: 'navigate', page })

const LEDGER_30 = "localStorage.setItem('qd.ledger.range', '30d')"

/** README pictures; names match docs/images. Light Chinese is the default, then dark and English variants. */
const README_SHOTS: Shot[] = [
  { name: 'overview', lang: 'zh-CN', theme: 'light', commands: [PAGE('dashboard')] },
  { name: 'ledger', lang: 'zh-CN', theme: 'light', prep: LEDGER_30, commands: [PAGE('stats')] },
  { name: 'conversations', lang: 'zh-CN', theme: 'light', commands: [PAGE('conversations')] },
  { name: 'accounts', lang: 'zh-CN', theme: 'light', commands: [PAGE('accounts')] },
  { name: 'switch', lang: 'zh-CN', theme: 'light', commands: [PAGE('dashboard'), { type: 'open-switch' }] },
  { name: 'settings', lang: 'zh-CN', theme: 'light', commands: [PAGE('settings')] },
  { name: 'setup', lang: 'zh-CN', theme: 'light', commands: [PAGE('setup')] },
  { name: 'tray', lang: 'zh-CN', theme: 'light', kind: 'tray', commands: [] },
  { name: 'splash', lang: 'zh-CN', theme: 'light', kind: 'splash', commands: [] },
  { name: 'overview-dark', lang: 'zh-CN', theme: 'dark', commands: [PAGE('dashboard')] },
  { name: 'ledger-dark', lang: 'zh-CN', theme: 'dark', prep: LEDGER_30, commands: [PAGE('stats')] },
  { name: 'overview.en', lang: 'en', theme: 'light', commands: [PAGE('dashboard')] },
  { name: 'ledger.en', lang: 'en', theme: 'light', prep: LEDGER_30, commands: [PAGE('stats')] },
  { name: 'switch.en', lang: 'en', theme: 'light', commands: [PAGE('dashboard'), { type: 'open-switch' }] },
  { name: 'overview-dark.en', lang: 'en', theme: 'dark', commands: [PAGE('dashboard')] }
]

const REVIEW_SHOTS: Shot[] = [
  { name: 'overview-light', lang: 'zh-CN', theme: 'light', accent: 'indigo', density: 'comfortable', commands: [PAGE('dashboard')] },
  { name: 'overview-dark', lang: 'zh-CN', theme: 'dark', accent: 'indigo', density: 'comfortable', commands: [PAGE('dashboard')] },
  {
    name: 'ledger-light',
    lang: 'zh-CN',
    theme: 'light',
    accent: 'indigo',
    density: 'comfortable',
    prep: "localStorage.setItem('qd.ledger.range', 'all')",
    height: 1720,
    commands: [PAGE('stats')]
  },
  { name: 'switch-light', lang: 'zh-CN', theme: 'light', accent: 'indigo', density: 'comfortable', commands: [PAGE('dashboard'), { type: 'open-switch' }] }
]

const LIVE_SHOTS: Shot[] = [
  { name: 'live-dashboard', commands: [PAGE('dashboard')] },
  { name: 'live-ledger', commands: [PAGE('stats')] },
  { name: 'live-switch', commands: [PAGE('dashboard'), { type: 'open-switch' }] },
  { name: 'live-conversations', commands: [PAGE('conversations')] },
  { name: 'live-activity', commands: [PAGE('activity')] },
  { name: 'live-settings', commands: [PAGE('settings')] },
  { name: 'live-about', commands: [PAGE('about')] },
  { name: 'live-add-account', commands: [PAGE('dashboard'), { type: 'open-add-account' }] }
]

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function captureScreenshots(win: BrowserWindow, backend: Backend, outDir: string, mode: 'readme' | 'live'): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true })
  win.setContentSize(1180, 780)
  win.center()
  // Freeze animations so every capture shows the settled page.
  await win.webContents.executeJavaScript("document.documentElement.dataset.motion = 'off'; document.documentElement.dataset.capture = '1'")
  // Park the page's pointer in the corner so no hover state (tooltips, highlights) lands in a picture.
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
  await wait(1500)
  const review = mode === 'readme' && process.env.QD_SHOTS === 'review'
  if (review) {
    // The launch screen is its own little window: render it in both themes.
    for (const dark of [false, true]) {
      const png = await captureSplash({ version: app.getVersion(), lang: backend.settings.language, dark, step: 'desktop' })
      fs.writeFileSync(path.join(outDir, `splash-${dark ? 'dark' : 'light'}.png`), png)
    }
  }
  const list = mode === 'live' ? LIVE_SHOTS : review ? REVIEW_SHOTS : README_SHOTS
  for (const shot of list) {
    if (shot.theme) nativeTheme.themeSource = shot.theme
    const patch: Partial<Settings> = {
      ...(shot.lang ? { language: shot.lang } : {}),
      ...(shot.theme ? { theme: shot.theme } : {}),
      ...(shot.accent ? { accent: shot.accent } : {}),
      ...(shot.density ? { density: shot.density } : {})
    }
    if (Object.keys(patch).length) await backend.updateSettings(patch)
    if (shot.kind === 'splash') {
      const png = await captureSplash({ version: app.getVersion(), lang: backend.settings.language, dark: shot.theme === 'dark', step: 'desktop' })
      fs.writeFileSync(path.join(outDir, `${shot.name}.png`), png)
      continue
    }
    if (shot.kind === 'tray') {
      fs.writeFileSync(path.join(outDir, `${shot.name}.png`), await captureTray(win))
      continue
    }
    if (shot.prep) await win.webContents.executeJavaScript(shot.prep)
    win.setContentSize(1180, shot.height ?? 780)
    await wait(400)
    for (const cmd of shot.commands) {
      sendCommand(win, cmd)
      await wait(800)
    }
    await wait(1000)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, `${shot.name}.png`), image.toPNG())
  }
}

/** The tray popover page in a window of its size, rendered like the real popover (same page, ?view=tray). */
async function captureTray(main: BrowserWindow): Promise<Buffer> {
  const win = new BrowserWindow({
    width: 360,
    height: 268,
    show: false,
    frame: false,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  try {
    const url = new URL(main.webContents.getURL())
    url.searchParams.set('view', 'tray')
    await win.loadURL(url.toString())
    await win.webContents.executeJavaScript("document.documentElement.dataset.motion = 'off'; document.documentElement.dataset.capture = '1'")
    await wait(900)
    return (await win.webContents.capturePage()).toPNG()
  } finally {
    win.destroy()
  }
}
