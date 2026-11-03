import path from 'node:path'
import { app, BrowserWindow, nativeTheme, Notification, shell } from 'electron'
import type { Settings, UiCommand } from '@shared/types'
import type { Backend } from './backend'
import { Engine, type Notice } from './core/engine'
import { listTranscripts } from './core/history'
import { DemoBackend } from './demo'
import { openClaudeDesktop } from './desktopApp'
import { registerIpc, sendCommand } from './ipc'
import { captureScreenshots } from './screenshots'
import { TrayController } from './tray'

const argv = process.argv.slice(1)
const DEMO = argv.includes('--demo')
const SCREENSHOTS = argv.find((a) => a.startsWith('--screenshots='))?.slice('--screenshots='.length)
const CAPTURE = argv.find((a) => a.startsWith('--capture='))?.slice('--capture='.length)
const START_HIDDEN = argv.includes('--hidden')

if (SCREENSHOTS) app.commandLine.appendSwitch('force-device-scale-factor', '1.5')
// Demo runs never touch the real profile, and may run next to the real app.
if (DEMO) app.setPath('userData', path.join(app.getPath('temp'), 'QuotaDeck-demo'))

app.setAppUserModelId('io.github.wtang2217-eng.quotadeck')

let win: BrowserWindow | undefined
let tray: TrayController | undefined
let backend: Backend
let quitting = false
const liveNotifications = new Set<Notification>()

function resource(...p: string[]): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'resources', ...p) : path.join(app.getAppPath(), 'resources', ...p)
}

function showWindow(): void {
  if (!win || win.isDestroyed()) createWindow(true)
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
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
    icon: resource(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0E0F14' : '#F6F7FB',
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
    if (show) win?.show()
  })
  win.on('close', (e) => {
    if (!quitting && !DEMO) {
      // Closing the window keeps QuotaDeck in the tray so limit alerts still arrive.
      e.preventDefault()
      win?.hide()
    }
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
    if (n.action?.type === 'open-switch') command({ type: 'open-switch', fromAccountId: n.action.fromAccountId, toAccountId: n.action.toAccountId })
    else if (n.action?.type === 'navigate') command({ type: 'navigate', page: n.action.page })
    else showWindow()
  })
  note.show()
}

function applySettings(s: Settings): void {
  nativeTheme.themeSource = s.theme
  if (app.isPackaged && !DEMO) app.setLoginItemSettings({ openAtLogin: s.openAtLogin, args: ['--hidden'] })
  tray?.update(backend.getState())
}

async function main(): Promise<void> {
  if (!DEMO && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => showWindow())
  await app.whenReady()

  backend = DEMO
    ? new DemoBackend(app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en')
    : new Engine({
        appVersion: app.getVersion(),
        locale: app.getLocale(),
        notify,
        trash: (p) => shell.trashItem(p),
        openDesktop: openClaudeDesktop
      })

  registerIpc(backend, () => win, applySettings)
  await backend.start()
  nativeTheme.themeSource = backend.settings.theme

  tray = new TrayController((look) => resource('tray', `tray-${look}.png`), {
    open: showWindow,
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
  backend.on('state', (s) => tray?.update(s))
  tray.update(backend.getState())

  const hidden = START_HIDDEN || (backend.settings.startHidden && !SCREENSHOTS && !CAPTURE)
  createWindow(!hidden)
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
  tray?.destroy()
  void backend?.stop()
})
// Stay in the tray when the window is closed.
app.on('window-all-closed', () => {
  if (DEMO) app.quit()
})
app.on('activate', () => showWindow())

void main()
