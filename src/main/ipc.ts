import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { IPC } from '@shared/api'
import type { ContinueRequest, LoginProgress, Settings, UiCommand } from '@shared/types'
import type { Backend } from './backend'

/** Wire every IPC channel to the backend. Inputs are checked because the renderer is untrusted by design. */
export function registerIpc(backend: Backend, getWindow: () => BrowserWindow | undefined, onSettingsChanged: (s: Settings) => void): void {
  const send = (channel: string, value: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, value)
  }
  backend.on('state', (s) => send(IPC.state, s))
  backend.on('login-progress', (p: LoginProgress) => send(IPC.loginProgress, p))

  const str = (v: unknown, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : undefined)

  ipcMain.handle(IPC.getState, () => backend.getState())
  ipcMain.handle(IPC.refresh, () => backend.refresh())
  ipcMain.handle(IPC.adoptDefaultCli, async () => {
    await backend.adoptDefaultCli()
    return backend.getState()
  })
  ipcMain.handle(IPC.startLogin, async (_e, opts: { email?: unknown } | undefined) => {
    const email = str(opts?.email, 200)?.trim()
    return { loginId: await backend.startLogin(email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined) }
  })
  ipcMain.handle(IPC.reLogin, async (_e, accountId: unknown) => ({ loginId: await backend.startLogin(undefined, str(accountId, 100)) }))
  ipcMain.handle(IPC.cancelLogin, (_e, loginId: unknown) => backend.cancelLogin(String(loginId)))
  ipcMain.handle(IPC.updateAccount, (_e, id: unknown, patch: { nickname?: unknown; color?: unknown }) => {
    backend.updateAccount(String(id), { nickname: str(patch?.nickname, 100), color: str(patch?.color, 20) })
    return backend.getState()
  })
  ipcMain.handle(IPC.removeAccount, async (_e, id: unknown, opts: { trashProfile?: unknown }) => {
    await backend.removeAccount(String(id), opts?.trashProfile === true)
    return backend.getState()
  })
  ipcMain.handle(IPC.continueInTerminal, (_e, req: ContinueRequest) =>
    backend.continueInTerminal({
      accountId: String(req?.accountId),
      cliSessionId: str(req?.cliSessionId, 100)?.match(/^[0-9a-f-]{36}$/i) ? req.cliSessionId : undefined,
      cwd: str(req?.cwd),
      sendPrompt: req?.sendPrompt === true
    })
  )
  ipcMain.handle(IPC.prepareDesktopSwitch, (_e, id: unknown) => backend.prepareDesktopSwitch(String(id)))
  ipcMain.handle(IPC.openDesktopApp, () => backend.openDesktopApp())
  ipcMain.handle(IPC.listConversations, (_e, q: { search?: unknown; limit?: unknown } | undefined) =>
    backend.listConversations({ search: str(q?.search, 200), limit: typeof q?.limit === 'number' ? q.limit : undefined })
  )
  ipcMain.handle(IPC.runMergeNow, () => backend.runMergeNow())
  ipcMain.handle(IPC.undoMerge, () => backend.undoMergeNow())
  ipcMain.handle(IPC.installIntegration, (_e, o: { hooks?: unknown; statusLine?: unknown; replaceStatusLine?: unknown }) =>
    backend.installIntegration({ hooks: o?.hooks === true, statusLine: o?.statusLine === true, replaceStatusLine: o?.replaceStatusLine === true })
  )
  ipcMain.handle(IPC.uninstallIntegration, () => backend.uninstallIntegration())
  ipcMain.handle(IPC.updateSettings, async (_e, patch: Partial<Settings>) => {
    await backend.updateSettings(patch && typeof patch === 'object' ? patch : {})
    onSettingsChanged(backend.settings)
    return backend.getState()
  })
  ipcMain.handle(IPC.clearEvents, () => {
    backend.clearEvents()
    return backend.getState()
  })
  ipcMain.handle(IPC.openPath, async (_e, p: unknown) => {
    const target = str(p)
    if (target && fs.existsSync(target)) await shell.openPath(target)
  })
  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    const u = str(url, 2000)
    if (u && /^https:\/\//i.test(u)) await shell.openExternal(u)
  })
  ipcMain.handle(IPC.copyText, (_e, text: unknown) => {
    clipboard.writeText(str(text, 10_000) ?? '')
  })
}

export function sendCommand(win: BrowserWindow | undefined, cmd: UiCommand): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.command, cmd)
}
