// Exposes a small, typed API to the renderer. The renderer has no Node access of its own.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type QuotaDeckApi } from '@shared/api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: QuotaDeckApi = {
  getState: () => invoke(IPC.getState),
  refresh: () => invoke(IPC.refresh),
  onState: (cb) => subscribe(IPC.state, cb),
  onCommand: (cb) => subscribe(IPC.command, cb),

  adoptDefaultCli: () => invoke(IPC.adoptDefaultCli),
  startLogin: (opts) => invoke(IPC.startLogin, opts),
  reLogin: (accountId) => invoke(IPC.reLogin, accountId),
  cancelLogin: (loginId) => invoke(IPC.cancelLogin, loginId),
  onLoginProgress: (cb) => subscribe(IPC.loginProgress, cb),
  updateAccount: (accountId, patch) => invoke(IPC.updateAccount, accountId, patch),
  removeAccount: (accountId, opts) => invoke(IPC.removeAccount, accountId, opts),

  continueInTerminal: (req) => invoke(IPC.continueInTerminal, req),
  prepareDesktopSwitch: (toAccountId, opts) => invoke(IPC.prepareDesktopSwitch, toAccountId, opts),
  cancelPendingSwitch: () => invoke(IPC.cancelPendingSwitch),
  onSwitchProgress: (cb) => subscribe(IPC.switchProgress, cb),
  openDesktopApp: () => invoke(IPC.openDesktopApp),
  openInDesktop: (target) => invoke(IPC.openInDesktop, target),

  listConversations: (query) => invoke(IPC.listConversations, query),
  listProjects: () => invoke(IPC.listProjects),
  setFavorite: (cliSessionId, favorite) => invoke(IPC.setFavorite, cliSessionId, favorite),
  exportConversation: (cliSessionId) => invoke(IPC.exportConversation, cliSessionId),

  getStats: (query) => invoke(IPC.getStats, query),

  getSetupStatus: () => invoke(IPC.getSetupStatus),
  runSetup: (opts) => invoke(IPC.runSetup, opts),
  onSetupProgress: (cb) => subscribe(IPC.setupProgress, cb),
  dismissSetup: () => invoke(IPC.dismissSetup),

  checkForUpdates: () => invoke(IPC.checkForUpdates),

  runMergeNow: () => invoke(IPC.runMergeNow),
  undoMerge: () => invoke(IPC.undoMerge),

  installIntegration: (opts) => invoke(IPC.installIntegration, opts),
  uninstallIntegration: () => invoke(IPC.uninstallIntegration),

  updateSettings: (patch) => invoke(IPC.updateSettings, patch),
  clearEvents: () => invoke(IPC.clearEvents),
  openPath: (path) => invoke(IPC.openPath, path),
  openExternal: (url) => invoke(IPC.openExternal, url),
  copyText: (text) => invoke(IPC.copyText, text),
  runCommand: (cmd) => invoke(IPC.runCommand, cmd)
}

contextBridge.exposeInMainWorld('qd', api)
