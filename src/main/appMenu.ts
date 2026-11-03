// The macOS menu bar menus. Without an Edit menu, ⌘C / ⌘V / ⌘A / ⌘Z do nothing in text fields on macOS.
// Windows and Linux show no menu bar (their editing shortcuts work without one).

import type { MenuItemConstructorOptions } from 'electron'
import type { Language } from '@shared/types'

export interface AppMenuActions {
  openSettings(): void
  openAbout(): void
  openUrl(url: string): void
}

const REPO = 'https://github.com/wtang2217-eng/quotadeck'

const STRINGS = {
  'zh-CN': {
    about: '关于 QuotaDeck',
    settings: '设置…',
    services: '服务',
    hide: '隐藏 QuotaDeck',
    hideOthers: '隐藏其他',
    unhide: '全部显示',
    quit: '退出 QuotaDeck',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '拷贝',
    paste: '粘贴',
    delete: '删除',
    selectAll: '全选',
    view: '显示',
    reload: '重新载入',
    forceReload: '强制重新载入',
    devTools: '开发者工具',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    fullscreen: '进入全屏幕',
    window: '窗口',
    minimize: '最小化',
    zoom: '缩放',
    close: '关闭窗口',
    front: '前置全部窗口',
    help: '帮助',
    homepage: 'GitHub 主页',
    issues: '反馈问题'
  },
  en: {
    about: 'About QuotaDeck',
    settings: 'Settings…',
    services: 'Services',
    hide: 'Hide QuotaDeck',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quit: 'Quit QuotaDeck',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    delete: 'Delete',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    forceReload: 'Force Reload',
    devTools: 'Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    fullscreen: 'Enter Full Screen',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    close: 'Close Window',
    front: 'Bring All to Front',
    help: 'Help',
    homepage: 'QuotaDeck on GitHub',
    issues: 'Report an Issue'
  }
} as const

export function macMenuTemplate(lang: Language, actions: AppMenuActions, dev: boolean): MenuItemConstructorOptions[] {
  const s = STRINGS[lang === 'zh-CN' ? 'zh-CN' : 'en']
  const sep: MenuItemConstructorOptions = { type: 'separator' }
  return [
    {
      label: 'QuotaDeck',
      submenu: [
        { label: s.about, click: () => actions.openAbout() },
        sep,
        { label: s.settings, accelerator: 'Command+,', click: () => actions.openSettings() },
        sep,
        { role: 'services', label: s.services },
        sep,
        { role: 'hide', label: s.hide },
        { role: 'hideOthers', label: s.hideOthers },
        { role: 'unhide', label: s.unhide },
        sep,
        { role: 'quit', label: s.quit }
      ]
    },
    {
      label: s.edit,
      submenu: [
        { role: 'undo', label: s.undo },
        { role: 'redo', label: s.redo },
        sep,
        { role: 'cut', label: s.cut },
        { role: 'copy', label: s.copy },
        { role: 'paste', label: s.paste },
        { role: 'delete', label: s.delete },
        { role: 'selectAll', label: s.selectAll }
      ]
    },
    {
      label: s.view,
      submenu: [
        ...(dev
          ? ([
              { role: 'reload', label: s.reload },
              { role: 'forceReload', label: s.forceReload },
              { role: 'toggleDevTools', label: s.devTools },
              sep
            ] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom', label: s.resetZoom },
        { role: 'zoomIn', label: s.zoomIn },
        { role: 'zoomOut', label: s.zoomOut },
        sep,
        { role: 'togglefullscreen', label: s.fullscreen }
      ]
    },
    {
      label: s.window,
      role: 'window',
      submenu: [
        { role: 'minimize', label: s.minimize },
        { role: 'zoom', label: s.zoom },
        { role: 'close', label: s.close },
        sep,
        { role: 'front', label: s.front }
      ]
    },
    {
      label: s.help,
      role: 'help',
      submenu: [
        { label: s.homepage, click: () => actions.openUrl(REPO) },
        { label: s.issues, click: () => actions.openUrl(`${REPO}/issues`) }
      ]
    }
  ]
}
