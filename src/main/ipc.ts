import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '@shared/api'
import type { ContinueRequest, ConversationQuery, LoginProgress, PendingSwitch, Settings, SetupProgress, StatsQuery, StatsRange, UiCommand } from '@shared/types'
import type { Backend } from './backend'

const STATS_RANGES: StatsRange[] = ['today', '7d', '30d', '90d', 'all']
const SESSION_ID = /^[0-9a-f-]{36}$/i
const DESKTOP_ID = /^local_[A-Za-z0-9-]{1,64}$/
/** The only kind of claude:// link QuotaDeck opens: the desktop app's own "continue this Code session" entry point. */
const DESKTOP_LINK = /^claude:\/\/code\/continue\?session=local_[A-Za-z0-9-]{1,64}$/

/** Wire every IPC channel to the backend. Inputs are checked because the renderer is untrusted by design. */
export function registerIpc(backend: Backend, getWindow: () => BrowserWindow | undefined, onSettingsChanged: (s: Settings) => void): void {
  const send = (channel: string, value: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, value)
  }
  backend.on('state', (s) => send(IPC.state, s))
  backend.on('login-progress', (p: LoginProgress) => send(IPC.loginProgress, p))
  backend.on('switch-progress', (p: PendingSwitch) => send(IPC.switchProgress, p))
  backend.on('setup-progress', (p: SetupProgress) => {
    send(IPC.setupProgress, p)
    // Setup may have switched on "open at login", which the OS has to be told about.
    if (p.phase === 'done') onSettingsChanged(backend.settings)
  })
  backend.on('copy-text', (text: string) => clipboard.writeText(String(text).slice(0, 10_000)))

  const str = (v: unknown, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  const sessionId = (v: unknown) => {
    const s = str(v, 100)
    return s && SESSION_ID.test(s) ? s : undefined
  }

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
      cliSessionId: sessionId(req?.cliSessionId),
      cwd: str(req?.cwd),
      sendPrompt: req?.sendPrompt === true
    })
  )
  ipcMain.handle(IPC.prepareDesktopSwitch, (_e, id: unknown, opts: { fromAccountId?: unknown; cliSessionId?: unknown; title?: unknown; cwd?: unknown } | undefined) =>
    backend.prepareDesktopSwitch(String(id), {
      fromAccountId: str(opts?.fromAccountId, 100),
      cliSessionId: sessionId(opts?.cliSessionId),
      title: str(opts?.title, 300),
      cwd: str(opts?.cwd)
    })
  )
  ipcMain.handle(IPC.cancelPendingSwitch, () => {
    backend.cancelPendingSwitch()
    return backend.getState()
  })
  ipcMain.handle(IPC.openDesktopApp, () => backend.openDesktopApp())
  ipcMain.handle(IPC.openInDesktop, async (_e, t: { cliSessionId?: unknown; desktopSessionId?: unknown } | undefined) => {
    const desktopId = str(t?.desktopSessionId, 100)
    const url = backend.desktopLinkFor({ cliSessionId: sessionId(t?.cliSessionId), desktopSessionId: desktopId && DESKTOP_ID.test(desktopId) ? desktopId : undefined })
    if (!url || !DESKTOP_LINK.test(url)) return { ok: false, error: 'not in a desktop list' }
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle(IPC.listConversations, (_e, q: Record<string, unknown> | undefined) => {
    const query: ConversationQuery = {
      search: str(q?.search, 200),
      limit: typeof q?.limit === 'number' ? Math.max(1, Math.min(5000, Math.floor(q.limit))) : undefined,
      cwd: str(q?.cwd),
      accountId: str(q?.accountId, 100),
      entrypoint: q?.entrypoint === 'desktop' || q?.entrypoint === 'terminal' ? q.entrypoint : undefined,
      favoritesOnly: q?.favoritesOnly === true
    }
    return backend.listConversations(query)
  })
  ipcMain.handle(IPC.listProjects, () => backend.listProjects())
  ipcMain.handle(IPC.setFavorite, (_e, id: unknown, favorite: unknown) => {
    const s = sessionId(id)
    if (s) backend.setFavorite(s, favorite === true)
  })
  ipcMain.handle(IPC.exportConversation, async (_e, id: unknown) => {
    const s = sessionId(id)
    if (!s) return { ok: false, error: 'bad id' }
    const doc = await backend.exportMarkdown(s)
    if (!doc) return { ok: false, error: 'not found' }
    const win = getWindow()
    const options = {
      defaultPath: path.join(app.getPath('documents'), `${doc.fileName}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const r = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true }
    try {
      fs.writeFileSync(r.filePath, doc.markdown, 'utf8')
      return { ok: true, path: r.filePath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  const statsQuery = (q: { range?: unknown; accountId?: unknown } | undefined): StatsQuery => ({
    range: STATS_RANGES.includes(q?.range as StatsRange) ? (q!.range as StatsRange) : '7d',
    accountId: str(q?.accountId, 100) || 'all'
  })
  ipcMain.handle(IPC.getStats, (_e, q: { range?: unknown; accountId?: unknown } | undefined) => backend.getStats(statsQuery(q)))
  ipcMain.handle(IPC.exportLedgerCsv, async (_e, q: { range?: unknown; accountId?: unknown } | undefined) => {
    const doc = await backend.ledgerCsv(statsQuery(q))
    const win = getWindow()
    const options = {
      defaultPath: path.join(app.getPath('documents'), `${doc.fileName}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    }
    const r = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true }
    try {
      // The byte order mark makes Excel read the Chinese text as UTF-8.
      fs.writeFileSync(r.filePath, `﻿${doc.csv}`, 'utf8')
      return { ok: true, path: r.filePath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle(IPC.getSetupStatus, () => backend.getSetupStatus())
  ipcMain.handle(IPC.runSetup, async (_e, o: { installCli?: unknown; connectIntegration?: unknown; openAtLogin?: unknown } | undefined) => ({
    runId: await backend.runSetup({ installCli: o?.installCli !== false, connectIntegration: o?.connectIntegration !== false, openAtLogin: o?.openAtLogin === true })
  }))
  ipcMain.handle(IPC.dismissSetup, () => {
    backend.dismissSetup()
    return backend.getState()
  })
  ipcMain.handle(IPC.checkForUpdates, () => backend.checkForUpdates(true))
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
