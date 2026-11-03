// The small window that opens from the tray / menu bar icon. It loads the same renderer page with
// ?view=tray and the same preload as the main window; what it shows is up to the renderer.

import path from 'node:path'
import { BrowserWindow, screen, type Rectangle } from 'electron'
import { popoverPosition } from './core/popoverPlacement'

const WIDTH = 360
const START_HEIGHT = 460
const MIN_HEIGHT = 160

export class TrayPopover {
  private win: BrowserWindow | undefined
  private anchor: Rectangle | undefined
  private hiddenAt = 0

  constructor(private readonly opts: { background: () => string; preload: string; rendererDir: string }) {}

  get window(): BrowserWindow | undefined {
    return this.win && !this.win.isDestroyed() ? this.win : undefined
  }

  isVisible(): boolean {
    return !!this.window?.isVisible()
  }

  /** Show next to the icon, or hide when already open. */
  toggle(trayBounds: Rectangle): void {
    if (this.isVisible()) return this.hide()
    // Clicking the icon while the popover is open first blurs (and hides) it; don't reopen on that same click.
    if (Date.now() - this.hiddenAt < 300) return
    this.show(trayBounds)
  }

  show(trayBounds: Rectangle): void {
    const win = this.window ?? this.create()
    this.anchor = trayBounds
    this.place(win)
    win.show()
    win.focus()
  }

  hide(): void {
    const win = this.window
    if (!win?.isVisible()) return
    win.hide()
    this.hiddenAt = Date.now()
  }

  send(channel: string, value: unknown): void {
    this.window?.webContents.send(channel, value)
  }

  setBackground(color: string): void {
    this.window?.setBackgroundColor(color)
  }

  destroy(): void {
    this.window?.destroy()
    this.win = undefined
  }

  private create(): BrowserWindow {
    const mac = process.platform === 'darwin'
    const win = new BrowserWindow({
      width: WIDTH,
      height: START_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: this.opts.background(),
      // macOS: a non-activating panel floats over full-screen apps like a native menu bar extra.
      ...(mac ? { type: 'panel' as const, hiddenInMissionControl: true } : {}),
      webPreferences: {
        preload: this.opts.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        // Lets the window take the height of its content (see 'preferred-size-changed').
        enablePreferredSizeMode: true
      }
    })
    if (mac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('blur', () => {
      if (!win.webContents.isDevToolsOpened()) this.hide()
    })
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault()
        this.hide()
      }
    })
    win.webContents.on('preferred-size-changed', (_e, size) => {
      const area = this.workArea()
      const height = Math.round(Math.min(Math.max(size.height, MIN_HEIGHT), area.height - 24))
      if (height !== win.getBounds().height) {
        win.setBounds({ ...win.getBounds(), height })
        if (win.isVisible()) this.place(win)
      }
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e, url) => {
      if (url !== win.webContents.getURL()) e.preventDefault()
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(process.env.ELECTRON_RENDERER_URL)
      url.searchParams.set('view', 'tray')
      void win.loadURL(url.toString())
    } else {
      void win.loadFile(path.join(this.opts.rendererDir, 'index.html'), { query: { view: 'tray' } })
    }
    this.win = win
    return win
  }

  private workArea(): Rectangle {
    const a = this.anchor
    const point = a && a.width > 0 ? { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) } : screen.getCursorScreenPoint()
    return screen.getDisplayNearestPoint(point).workArea
  }

  private place(win: BrowserWindow): void {
    const a = this.anchor ?? { x: 0, y: 0, width: 0, height: 0 }
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(a.width > 0 ? { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) } : cursor)
    const { width, height } = win.getBounds()
    const gap = process.platform === 'darwin' ? 6 : 12
    const pos = popoverPosition({ tray: a, display: display.bounds, workArea: display.workArea, size: { width, height }, cursor, gap })
    win.setBounds({ x: pos.x, y: pos.y, width, height })
  }
}
