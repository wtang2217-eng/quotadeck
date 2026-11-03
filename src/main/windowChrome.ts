// Window chrome per platform: the background painted before the page loads and the title bar.
// macOS keeps its traffic lights over the page, Windows draws its caption buttons over the page
// (Window Controls Overlay), Linux keeps the native frame. The page leaves room for them (top 40 px).

import type { BrowserWindowConstructorOptions, TitleBarOverlay } from 'electron'

export const TITLE_BAR_HEIGHT = 40

/** App background (the sidebar's gray) and text color; keep in sync with --bg and --text-1 in the renderer's tokens.css. */
const SURFACES: Record<'light' | 'dark', { bg: string; ink: string }> = {
  light: { bg: '#F7F7F8', ink: '#18181B' },
  dark: { bg: '#0B0B0D', ink: '#EDEDEF' }
}

export function surface(dark: boolean): { bg: string; ink: string } {
  return SURFACES[dark ? 'dark' : 'light']
}

export function titleBarOverlay(dark: boolean): TitleBarOverlay {
  return { color: '#00000000', symbolColor: surface(dark).ink, height: TITLE_BAR_HEIGHT }
}

export function titleBarOptions(platform: NodeJS.Platform, dark: boolean): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 } }
  if (platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(dark) }
  return {}
}
