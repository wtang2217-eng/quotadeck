// Sidebar (scope switcher, navigation, status) and the top strip (where you are, search, notifications).

import { useState, type ReactNode } from 'react'
import { formatAgo } from '@shared/format'
import type { Page } from '@shared/types'
import { useApp } from '../context'
import type { TKey } from '../i18n'
import { displayName, initial, planText, shortName } from '../util'
import {
  IconBell,
  IconCheck,
  IconChat,
  IconChevronRight,
  IconChevronsUpDown,
  IconGrid,
  IconHelp,
  IconLayers,
  IconLedger,
  IconMonitor,
  IconPlug,
  IconPlus,
  IconPulse,
  IconSearch,
  IconSettings,
  IconUpdate,
  IconUsers,
  Logo
} from './icons'
import { Menu, type MenuEntry } from './Menu'

const NAV: { page: Page; key: TKey; icon: (p: { size?: number }) => ReactNode }[] = [
  { page: 'dashboard', key: 'navDashboard', icon: IconGrid },
  { page: 'stats', key: 'navStats', icon: IconLedger },
  { page: 'conversations', key: 'navConversations', icon: IconChat },
  { page: 'accounts', key: 'navAccounts', icon: IconUsers },
  { page: 'activity', key: 'navActivity', icon: IconPulse }
]

export const PAGE_KEYS: Record<Page, TKey> = {
  dashboard: 'navDashboard',
  stats: 'navStats',
  conversations: 'navConversations',
  accounts: 'navAccounts',
  activity: 'navActivity',
  settings: 'navSettings',
  about: 'navAbout',
  setup: 'setupTitle'
}

function ScopeSwitcher() {
  const { state, t, scope, setScope, openDialog } = useApp()
  const current = state.accounts.find((a) => a.id === scope)
  const items: MenuEntry[] = [
    { heading: t('scopeHeading') },
    {
      label: t('scopeAll'),
      detail: t('scopeAllSub', { n: state.accounts.length }),
      icon: <span className="scope-mark sm">{<IconLayers size={14} />}</span>,
      sub: scope === 'all' ? <IconCheck /> : undefined,
      onSelect: () => setScope('all')
    },
    ...state.accounts.map((a) => ({
      label: displayName(a),
      detail: `${planText(a.plan, t)}${a.email && a.nickname ? ` · ${a.email}` : ''}`,
      icon: <span className="scope-mark sm">{initial(a)}</span>,
      sub: (
        <>
          {a.status === 'limited' && <span className="dot bad" />}
          {a.status === 'warn' && <span className="dot warn" />}
          {scope === a.id && <IconCheck />}
        </>
      ),
      onSelect: () => setScope(a.id)
    })),
    'sep',
    { label: t('addAccount'), icon: <IconPlus />, onSelect: () => openDialog({ type: 'add' }) }
  ]
  return (
    <div className="scope">
      <Menu
        align="left"
        width={232}
        label={t('scopeHeading')}
        items={items}
        trigger={({ open, toggle }) => (
          <button type="button" className="scope-btn" aria-haspopup="menu" aria-expanded={open} title={current ? displayName(current) : undefined} onClick={toggle}>
            <span className="scope-mark">{current ? initial(current) : <IconLayers />}</span>
            <span className="scope-text">
              <span className="scope-label">{t('scopeHeading')}</span>
              <span className="scope-name ellipsis">{current ? shortName(current) : t('scopeAll')}</span>
            </span>
            <IconChevronsUpDown size={14} />
          </button>
        )}
      />
    </div>
  )
}

export function Sidebar() {
  const { state, t, page, navigate, api } = useApp()
  const desktop = state.accounts.find((a) => a.isDesktopCurrent)
  const integOn = state.integration.hooksInstalled && state.integration.statusLineInstalled
  const limited = state.accounts.filter((a) => a.status === 'limited').length
  const update = state.update?.available ? state.update : undefined
  const item = (p: Page, key: TKey, Icon: (p: { size?: number }) => ReactNode, badge?: number) => (
    <button key={p} type="button" className={`nav-item${page === p ? ' active' : ''}`} aria-current={page === p ? 'page' : undefined} onClick={() => page !== p && navigate(p)}>
      <Icon />
      <span>{t(key)}</span>
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </button>
  )
  return (
    <aside className="sidebar">
      <div className="side-strip drag">
        <Logo size={18} />
        <span>QuotaDeck</span>
      </div>
      <ScopeSwitcher />
      <nav className="nav" aria-label="main">
        {NAV.map((n) => item(n.page, n.key, n.icon, n.page === 'dashboard' ? limited : undefined))}
        <div className="nav-sep" />
        {item('settings', 'navSettings', IconSettings)}
      </nav>
      <div className="side-foot">
        <button type="button" className="side-row" onClick={() => navigate('dashboard')}>
          <IconMonitor />
          <span>{t('sideDesktop')}</span>
          <span className={`side-value${desktop ? '' : ' muted'}`} title={desktop ? displayName(desktop) : undefined}>
            {desktop?.status === 'limited' && <span className="dot bad" />}
            {desktop?.status === 'warn' && <span className="dot warn" />}
            <span className="ellipsis">{desktop ? shortName(desktop) : state.desktop.found ? t('sideDesktopIdle') : t('sideDesktopNone')}</span>
          </span>
        </button>
        <button type="button" className="side-row" onClick={() => navigate('settings')}>
          <IconPlug />
          <span>{t('sideIntegration')}</span>
          <span className={`side-value${integOn ? ' muted' : ''}`}>
            {!integOn && <span className="dot warn" />}
            {integOn ? t('sideIntegrationOn') : t('sideIntegrationOff')}
          </span>
        </button>
        <button type="button" className="side-row" onClick={() => (update?.url ? void api.openExternal(update.url) : navigate('about'))}>
          <IconUpdate />
          <span>{update ? t('sideUpdate', { v: update.latest ?? '' }) : t('sideVersion')}</span>
          <span className={`side-value${update ? ' accent' : ' muted'}`}>{update ? <IconChevronRight size={14} /> : `v${state.appVersion}`}</span>
        </button>
        <button type="button" className="side-row" onClick={() => void api.openExternal('https://github.com/wtang2217-eng/quotadeck#readme')}>
          <IconHelp />
          <span>{t('sideHelp')}</span>
        </button>
      </div>
    </aside>
  )
}

const READ_KEY = 'qd.notifications.readAt'
const ALERTS = new Set(['limit-hit', 'threshold', 'reset', 'error', 'switch', 'login'])

function readAt(): number {
  try {
    return Number(localStorage.getItem(READ_KEY)) || 0
  } catch {
    return 0
  }
}

/** Recent alerts; the dot shows while some are unread. "Mark all as read" is remembered per computer. */
function Notifications() {
  const { state, t, lang, now, navigate } = useApp()
  const [seen, setSeen] = useState(readAt)
  const recent = state.events.filter((e) => ALERTS.has(e.type)).slice(0, 8)
  const unread = recent.filter((e) => e.at > seen).length
  const markRead = () => {
    const at = Date.now()
    setSeen(at)
    try {
      localStorage.setItem(READ_KEY, String(at))
    } catch {
      /* the dot just comes back next start */
    }
  }
  const items: MenuEntry[] = [
    { heading: t('notifications') },
    ...(recent.length
      ? recent.map((e) => ({
          label: e.at > seen ? <b>{e.title}</b> : e.title,
          detail: formatAgo(e.at, lang, now),
          icon: <span className={`dot${e.type === 'limit-hit' || e.type === 'error' ? ' bad' : e.type === 'threshold' ? ' warn' : ''}`} />,
          onSelect: () => navigate('activity')
        }))
      : [{ label: t('notificationsEmpty'), disabled: true, onSelect: () => undefined }]),
    'sep',
    ...(unread ? [{ label: t('notifMarkRead'), onSelect: markRead }] : []),
    { label: t('notificationsAll'), onSelect: () => navigate('activity') }
  ]
  const fresh = unread > 0
  return (
    <Menu
      width={300}
      label={t('notifications')}
      items={items}
      trigger={({ toggle }) => (
        <button type="button" className="icon-btn bell" aria-label={t('notifications')} title={t('notifications')} onClick={toggle}>
          <IconBell />
          {fresh && <span className="bell-dot" />}
        </button>
      )}
    />
  )
}

export function Topbar() {
  const { state, t, page, scope, openPalette } = useApp()
  const scoped = state.accounts.find((a) => a.id === scope)
  const mod = state.platform === 'darwin' ? '⌘' : 'Ctrl'
  return (
    <div className="topbar drag">
      <div className="crumbs">
        <span className="ellipsis">{scoped ? displayName(scoped) : t('scopeAll')}</span>
        <IconChevronRight size={14} />
        <b>{t(PAGE_KEYS[page])}</b>
      </div>
      <span className="grow" />
      <button type="button" className="cmd-trigger" onClick={openPalette}>
        <IconSearch size={14} />
        <span>{t('cmdPlaceholder')}</span>
        <span className="kbd">{mod} K</span>
      </button>
      <Notifications />
    </div>
  )
}
