import path from 'node:path'
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeTheme, Notification, shell } from 'electron'
import { IPC } from '@shared/api'
import type { Language, Page, Settings, UiCommand } from '@shared/types'
import { macMenuTemplate } from './appMenu'
import type { Backend } from './backend'
import { Engine, type Notice } from './core/engine'
import { listTranscripts } from './core/history'
import { DemoBackend } from './demo'
import { openClaudeDesktop } from './desktopApp'
import { registerIpc, sendCommand } from './ipc'
import { applyLoginItem, openedAtLogin } from './loginItem'
import { captureScreenshots } from './screenshots'
import { TrayController } from './tray'
import { TrayPopover } from './trayPopover'
import { Splash } from './splash'
import { surface, titleBarOptions, titleBarOverlay } from './windowChrome'

const argv = process.argv.slice(1)
const DEMO = argv.includes('--demo')
const SCREENSHOTS = argv.find((a) => a.startsWith('--screenshots='))?.slice('--screenshots='.length)
const CAPTURE = argv.find((a) => a.startsWith('--capture='))?.slice('--capture='.length)
const START_HIDDEN = argv.includes('--hidden')
const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'

if (SCREENSHOTS) app.commandLine.appendSwitch('force-device-scale-factor', '1.5')
// Demo runs never touch the real profile, and may run next to the real app.
if (DEMO) app.setPath('userData', path.join(app.getPath('temp'), 'QuotaDeck-demo'))

app.setAppUserModelId('io.github.wtang2217-eng.quotadeck')

let win: BrowserWindow | undefined
let tray: TrayController | undefined
let popover: TrayPopover | undefined
let splash: Splash | undefined
let backend: Backend
let quitting = false
let shortcut = ''
let menuLanguage: Language | undefined
const liveNotifications = new Set<Notification>()

function resource(...p: string[]): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'resources', ...p) : path.join(app.getAppPath(), 'resources', ...p)
}

function chromeBackground(): string {
  return surface(nativeTheme.shouldUseDarkColors).bg
}

function showWindow(): void {
  if (IS_MAC) void app.dock?.show()
  if (!win || win.isDestroyed()) createWindow(true)
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  if (IS_MAC) app.focus({ steal: true })
}

function hideWindow(): void {
  win?.hide()
  // Like other menu bar apps: no Dock icon while the window is closed.
  if (IS_MAC && !DEMO) app.dock?.hide()
}

/** The global shortcut: bring the window up, or put it away when it is already in front. */
function toggleWindow(): void {
  if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()) hideWindow()
  else showWindow()
}

function command(cmd: UiCommand): void {
  showWindow()
  // A freshly created window needs a moment before it can receive messages.
  const target = win
  if (target?.webContents.isLoading()) target.webContents.once('did-finish-load', () => setTimeout(() => sendCommand(target, cmd), 300))
  else sendCommand(target, cmd)
}

function createWindow(show: boolean): void {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'QuotaDeck',
    icon: resource(IS_WIN ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: chromeBackground(),
    ...titleBarOptions(process.platform, nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => {
    if (!show) return
    // The launch screen fades out first, then the window appears where it was.
    const s = splash
    splash = undefined
    if (s) void s.close().then(() => win?.show())
    else win?.show()
  })
  win.on('close', (e) => {
    if (!quitting && !DEMO) {
      // Closing the window keeps QuotaDeck in the tray so limit alerts still arrive.
      e.preventDefault()
      hideWindow()
    }
  })
  // A demo run ends with its window, even when the hidden tray popover is still around.
  win.on('closed', () => {
    if (DEMO) app.quit()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function notify(n: Notice): void {
  if (DEMO || !Notification.isSupported()) return
  const note = new Notification({ title: n.title, body: n.body ?? '', icon: resource('icon.png') })
  liveNotifications.add(note)
  const release = () => liveNotifications.delete(note)
  note.on('close', release)
  note.on('click', () => {
    release()
    if (n.action?.type === 'open-switch') command({ type: 'open-switch', fromAccountId: n.action.fromAccountId, toAccountId: n.action.toAccountId, cliSessionId: n.action.cliSessionId })
    else if (n.action?.type === 'navigate') command({ type: 'navigate', page: n.action.page })
    else showWindow()
  })
  note.show()
}

/** Background and caption buttons follow the style and light/dark mode. */
function applyChrome(): void {
  const s = backend?.settings
  if (!s) return
  const dark = nativeTheme.shouldUseDarkColors
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(surface(dark).bg)
    if (IS_WIN) win.setTitleBarOverlay(titleBarOverlay(dark))
  }
  popover?.setBackground(surface(dark).bg)
}

function setMacMenu(lang: Language): void {
  if (!IS_MAC || lang === menuLanguage) return
  menuLanguage = lang
  const actions = {
    openSettings: () => command({ type: 'navigate', page: 'settings' }),
    openAbout: () => command({ type: 'navigate', page: 'about' }),
    openUrl: (url: string) => void shell.openExternal(url)
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(macMenuTemplate(lang, actions, !app.isPackaged)))
}

/** (Re)register the show/hide shortcut. A key taken by another app is logged, never fatal. */
function registerShortcut(accelerator: string | undefined): void {
  const next = (accelerator ?? '').trim()
  if (next === shortcut) return
  if (shortcut) globalShortcut.unregister(shortcut)
  shortcut = ''
  // Screenshot runs leave the keyboard alone; a demo next to the real app just finds the key taken.
  if (!next || SCREENSHOTS || CAPTURE) return
  try {
    if (globalShortcut.register(next, toggleWindow)) shortcut = next
    else console.warn(`[shortcut] ${next} is already used by another app`)
  } catch (e) {
    console.warn(`[shortcut] cannot register "${next}": ${(e as Error).message}`)
  }
}

function applySettings(s: Settings): void {
  nativeTheme.themeSource = s.theme
  if (app.isPackaged && !DEMO) applyLoginItem(s.openAtLogin)
  applyChrome()
  setMacMenu(s.language)
  registerShortcut(s.globalShortcut)
  tray?.update(backend.getState())
}

/** UI commands the tray popover may ask for; anything else is dropped. */
function validCommand(value: unknown): UiCommand | undefined {
  if (!value || typeof value !== 'object') return undefined
  const c = value as Record<string, unknown>
  const id = (v: unknown) => (typeof v === 'string' && v.length <= 100 ? v : undefined)
  if (c.type === 'navigate' && typeof c.page === 'string' && /^[a-z-]{1,40}$/.test(c.page)) return { type: 'navigate', page: c.page as Page }
  if (c.type === 'open-switch') return { type: 'open-switch', fromAccountId: id(c.fromAccountId), toAccountId: id(c.toAccountId), cliSessionId: id(c.cliSessionId) }
  if (c.type === 'open-add-account') return { type: 'open-add-account' }
  return undefined
}

async function main(): Promise<void> {
  if (!DEMO && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => showWindow())
  await app.whenReady()
  // Windows and Linux have no menu bar; their editing shortcuts work without one. Dev builds keep Electron's menu.
  if (!IS_MAC && app.isPackaged) Menu.setApplicationMenu(null)

  backend = DEMO
    ? new DemoBackend(app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en')
    : new Engine({
        appVersion: app.getVersion(),
        locale: app.getLocale(),
        notify,
        trash: (p) => shell.trashItem(p),
        openDesktop: openClaudeDesktop
      })

  // Launch screen, unless the window starts hidden or this is a screenshot run.
  const startsHidden = START_HIDDEN || openedAtLogin() || (backend.settings.startHidden && !SCREENSHOTS && !CAPTURE)
  if (!startsHidden && !SCREENSHOTS && !CAPTURE) {
    nativeTheme.themeSource = backend.settings.theme
    splash = new Splash({ version: app.getVersion(), lang: backend.settings.language, dark: nativeTheme.shouldUseDarkColors, icon: resource(IS_WIN ? 'icon.ico' : 'icon.png') })
    splash.show()
  }

  registerIpc(backend, () => win, applySettings)
  ipcMain.handle(IPC.runCommand, (_e, value: unknown) => {
    const cmd = validCommand(value)
    popover?.hide()
    if (cmd) command(cmd)
  })
  splash?.status('accounts')
  await backend.start()
  splash?.status('desktop')
  nativeTheme.themeSource = backend.settings.theme
  nativeTheme.on('updated', applyChrome)

  popover = new TrayPopover({
    background: chromeBackground,
    preload: path.join(__dirname, '../preload/index.js'),
    rendererDir: path.join(__dirname, '../renderer')
  })
  tray = new TrayController((look) => resource('tray', look === 'template' ? 'trayTemplate.png' : `tray-${look}.png`), {
    open: showWindow,
    togglePopover: (bounds) => popover?.toggle(bounds),
    quit: () => {
      quitting = true
      app.quit()
    },
    openSwitch: (toAccountId) => command({ type: 'open-switch', toAccountId }),
    addAccount: () => command({ type: 'open-add-account' }),
    continueLatest: (accountId) => {
      const st = backend.getState()
      const recent = st.lastInterrupted && Date.now() - st.lastInterrupted.at < 24 * 3600_000 ? st.lastInterrupted : undefined
      const latest = recent?.cliSessionId ? { cliSessionId: recent.cliSessionId, cwd: recent.cwd } : (() => {
        const t = DEMO ? undefined : listTranscripts()[0]
        return t ? { cliSessionId: t.cliSessionId, cwd: t.cwd } : {}
      })()
      void backend.continueInTerminal({ accountId, ...latest, sendPrompt: !!recent })
    },
    mergeNow: () => backend.runMergeNow()
  })
  backend.on('state', (s) => {
    tray?.update(s)
    popover?.send(IPC.state, s)
  })
  tray.update(backend.getState())

  const hidden = startsHidden
  createWindow(!hidden)
  if (hidden && IS_MAC && !DEMO) app.dock?.hide()
  applySettings(backend.settings)

  const shotsDir = SCREENSHOTS ?? CAPTURE
  if (shotsDir && win) {
    const target = win
    target.webContents.once('did-finish-load', async () => {
      target.show()
      await captureScreenshots(target, backend, path.resolve(shotsDir), SCREENSHOTS ? 'readme' : 'live')
      quitting = true
      app.quit()
    })
  }
}

app.on('before-quit', () => {
  quitting = true
  splash?.destroy()
  popover?.destroy()
  tray?.destroy()
  void backend?.stop()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
// Stay in the tray when the window is closed.
app.on('window-all-closed', () => {
  if (DEMO) app.quit()
})
app.on('activate', () => showWindow())

void main()
