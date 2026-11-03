// `--demo --screenshots=<dir>`: walks through the pages with demo data in both languages and themes and saves
// PNGs for the README. With QD_SHOTS=review it saves the design review set instead (launch screen, overview,
// ledger, switch dialog). `--capture=<dir>`: the same walk with the real data and the current settings, nothing changed.

import fs from 'node:fs'
import path from 'node:path'
import { app, nativeTheme, type BrowserWindow } from 'electron'
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
  commands: UiCommand[]
}

const PAGE = (page: Page): UiCommand => ({ type: 'navigate', page })

const README_SHOTS: Shot[] = [
  { name: 'dashboard', lang: 'zh-CN', theme: 'light', commands: [PAGE('dashboard')] },
  { name: 'dashboard-dark', lang: 'zh-CN', theme: 'dark', commands: [PAGE('dashboard')] },
  { name: 'ledger', lang: 'zh-CN', theme: 'light', commands: [PAGE('stats')] },
  { name: 'switch', lang: 'zh-CN', theme: 'light', commands: [PAGE('dashboard'), { type: 'open-switch' }] },
  { name: 'conversations', lang: 'zh-CN', theme: 'light', commands: [PAGE('conversations')] },
  { name: 'activity', lang: 'zh-CN', theme: 'light', commands: [PAGE('activity')] },
  { name: 'settings', lang: 'zh-CN', theme: 'light', commands: [PAGE('settings')] },
  { name: 'about', lang: 'zh-CN', theme: 'light', commands: [PAGE('about')] },
  { name: 'add-account', lang: 'zh-CN', theme: 'light', commands: [PAGE('dashboard'), { type: 'open-add-account' }] },
  { name: 'dashboard-en', lang: 'en', theme: 'light', commands: [PAGE('dashboard')] },
  { name: 'dashboard-en-dark', lang: 'en', theme: 'dark', commands: [PAGE('dashboard')] }
]

const REVIEW_SHOTS: Shot[] = [
  { name: 'overview-light', lang: 'zh-CN', theme: 'light', accent: 'indigo', density: 'comfortable', commands: [PAGE('dashboard')] },
  { name: 'overview-dark', lang: 'zh-CN', theme: 'dark', accent: 'indigo', density: 'comfortable', commands: [PAGE('dashboard')] },
  { name: 'ledger-light', lang: 'zh-CN', theme: 'light', accent: 'indigo', density: 'comfortable', commands: [PAGE('stats')] },
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
