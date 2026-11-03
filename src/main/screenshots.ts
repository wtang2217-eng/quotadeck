// `--demo --screenshots=<dir>`: walks through the pages with demo data in both languages and themes and saves
// PNGs for the README. `--capture=<dir>`: the same walk with the real data and the current settings, nothing changed.

import fs from 'node:fs'
import path from 'node:path'
import { nativeTheme, type BrowserWindow } from 'electron'
import type { Language, ThemeSetting, UiCommand } from '@shared/types'
import type { Backend } from './backend'
import { sendCommand } from './ipc'

interface Shot {
  name: string
  lang?: Language
  theme?: Exclude<ThemeSetting, 'system'>
  commands: UiCommand[]
}

const PAGE = (page: 'dashboard' | 'conversations' | 'activity' | 'settings' | 'about'): UiCommand => ({ type: 'navigate', page })

const README_SHOTS: Shot[] = [
  { name: 'dashboard', lang: 'zh-CN', theme: 'dark', commands: [PAGE('dashboard')] },
  { name: 'dashboard-light', lang: 'zh-CN', theme: 'light', commands: [PAGE('dashboard')] },
  { name: 'switch', lang: 'zh-CN', theme: 'dark', commands: [PAGE('dashboard'), { type: 'open-switch' }] },
  { name: 'conversations', lang: 'zh-CN', theme: 'dark', commands: [PAGE('conversations')] },
  { name: 'activity', lang: 'zh-CN', theme: 'dark', commands: [PAGE('activity')] },
  { name: 'settings', lang: 'zh-CN', theme: 'dark', commands: [PAGE('settings')] },
  { name: 'about', lang: 'zh-CN', theme: 'dark', commands: [PAGE('about')] },
  { name: 'add-account', lang: 'zh-CN', theme: 'dark', commands: [PAGE('dashboard'), { type: 'open-add-account' }] },
  { name: 'dashboard-en', lang: 'en', theme: 'dark', commands: [PAGE('dashboard')] },
  { name: 'dashboard-en-light', lang: 'en', theme: 'light', commands: [PAGE('dashboard')] }
]

const LIVE_SHOTS: Shot[] = [
  { name: 'live-dashboard', commands: [PAGE('dashboard')] },
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
  await win.webContents.executeJavaScript("document.documentElement.dataset.motion = 'off'")
  await wait(1500)
  for (const shot of mode === 'readme' ? README_SHOTS : LIVE_SHOTS) {
    if (shot.theme) nativeTheme.themeSource = shot.theme
    if (shot.lang || shot.theme) await backend.updateSettings({ ...(shot.lang ? { language: shot.lang } : {}), ...(shot.theme ? { theme: shot.theme } : {}) })
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
