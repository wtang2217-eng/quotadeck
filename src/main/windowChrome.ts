// Window chrome per platform: the background painted before the page loads and the title bar.
// macOS keeps its traffic lights over the page, Windows draws its caption buttons over the page
// (Window Controls Overlay), Linux keeps the native frame. The page leaves room for them (top 40 px).

import type { BrowserWindowConstructorOptions, TitleBarOverlay } from 'electron'
import type { UiStyle } from '@shared/types'

export const TITLE_BAR_HEIGHT = 40

/** Page background and text color of each style; keep in sync with the renderer's tokens. */
const SURFACES: Record<UiStyle, Record<'light' | 'dark', { bg: string; ink: string }>> = {
  swiss: { light: { bg: '#FAFAF8', ink: '#0A0A0A' }, dark: { bg: '#0A0A0A', ink: '#F2F2F0' } },
  editorial: { light: { bg: '#F4EFE6', ink: '#1C1A16' }, dark: { bg: '#16140F', ink: '#EEE7DA' } },
  eclipse: { light: { bg: '#F3F4F8', ink: '#141621' }, dark: { bg: '#07080D', ink: '#E7E9F2' } }
}

export function surface(style: UiStyle | undefined, dark: boolean): { bg: string; ink: string } {
  return (SURFACES[style ?? 'swiss'] ?? SURFACES.swiss)[dark ? 'dark' : 'light']
}

export function titleBarOverlay(style: UiStyle | undefined, dark: boolean): TitleBarOverlay {
  return { color: '#00000000', symbolColor: surface(style, dark).ink, height: TITLE_BAR_HEIGHT }
}

export function titleBarOptions(platform: NodeJS.Platform, style: UiStyle | undefined, dark: boolean): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 } }
  if (platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(style, dark) }
  return {}
}
