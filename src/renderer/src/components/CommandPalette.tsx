// Ctrl/Cmd + K: jump to a page, change the view scope, or run a common action, by typing.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConversationItem } from '@shared/types'
import { createPortal } from 'react-dom'
import type { Page } from '@shared/types'
import { useApp } from '../context'
import { play } from '../sound'
import { displayName, planText, resolveTheme } from '../util'
import { IconArrowRight, IconChat, IconMoon, IconPlus, IconRefresh, IconSearch, IconSwitch } from './icons'
import { PAGE_KEYS } from './Shell'

interface Cmd {
  id: string
  group: string
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

const PAGES: Page[] = ['dashboard', 'stats', 'conversations', 'accounts', 'activity', 'settings', 'about']

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { state, t, navigate, openDialog, api, setState, toast } = useApp()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [convs, setConvs] = useState<ConversationItem[]>([])
  const input = useRef<HTMLInputElement>(null)

  // Conversations matching what is typed (the 8 most recent while the box is empty).
  useEffect(() => {
    let alive = true
    const h = window.setTimeout(() => {
      api
        .listConversations({ search: q.trim() || undefined, limit: 8 })
        .then((list) => alive && setConvs(list))
        .catch(() => undefined)
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(h)
    }
  }, [api, q])

  const current = state.accounts.find((a) => a.isDesktopCurrent)
  const resume = (c: ConversationItem) => {
    if (c.desktopSessionId && current && current.status !== 'limited')
      void api.openInDesktop({ desktopSessionId: c.desktopSessionId, cliSessionId: c.cliSessionId }).then((r) => !r.ok && toast(t('errGeneric', { msg: r.error ?? '' }), 'bad'))
    else openDialog({ type: 'switch', mode: 'both', cliSessionId: c.cliSessionId, cwd: c.cwd, title: c.title })
  }

  const all: Cmd[] = useMemo(
    () => [
      ...PAGES.map((p) => ({ id: `p-${p}`, group: t('plPages'), label: t(PAGE_KEYS[p]), icon: <IconArrowRight />, run: () => navigate(p) })),
      ...state.accounts
        .filter((a) => !a.isDesktopCurrent)
        .map((a) => ({ id: `s-${a.id}`, group: t('plSwitch'), label: displayName(a), hint: planText(a.plan, t), icon: <IconSwitch />, run: () => openDialog({ type: 'switch', mode: 'desktop', toAccountId: a.id }) })),
      { id: 'a-add', group: t('plActions'), label: t('addAccount'), icon: <IconPlus />, run: () => openDialog({ type: 'add' }) },
      { id: 'a-refresh', group: t('plActions'), label: t('plRefresh'), icon: <IconRefresh />, run: () => void api.refresh().then(setState) },
      {
        id: 'a-theme',
        group: t('plActions'),
        label: t('plTheme'),
        icon: <IconMoon />,
        run: () => void api.updateSettings({ theme: resolveTheme(state.settings.theme) === 'dark' ? 'light' : 'dark' }).then(setState)
      }
    ],
    [state.accounts, state.settings.theme, t]
  )
  const fixed = q.trim() ? all.filter((c) => `${c.label} ${c.hint ?? ''} ${c.group}`.toLowerCase().includes(q.trim().toLowerCase())) : all
  const list: Cmd[] = [...fixed, ...convs.map((c) => ({ id: `c-${c.cliSessionId}`, group: t('plConversations'), label: c.title, hint: c.cwd?.split(/[\\/]/).filter(Boolean).pop(), icon: <IconChat />, run: () => resume(c) }))]

  useEffect(() => {
    play('open')
    input.current?.focus()
  }, [])
  useEffect(() => setSel(0), [q])

  const run = (c: Cmd | undefined) => {
    if (!c) return
    onClose()
    c.run()
  }

  let lastGroup = ''
  return createPortal(
    <div className="backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label={t('plPlaceholder')}>
        <div className="palette-input">
          <IconSearch />
          <input
            ref={input}
            value={q}
            placeholder={t('plPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(list.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') run(list[sel])
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" role="listbox">
          {list.length === 0 && <div className="palette-empty">{t('plEmpty')}</div>}
          {list.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : ''
            lastGroup = c.group
            return (
              <div key={c.id}>
                {head && <div className="menu-label">{head}</div>}
                <button type="button" role="option" aria-selected={i === sel} className={`menu-item${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
                  {c.icon}
                  <span className="ellipsis">{c.label}</span>
                  {c.hint && <span className="menu-item-sub ellipsis">{c.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
