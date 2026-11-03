// Conversations: search and filter every Claude Code conversation on this computer, star, export, continue.

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatAgo, formatDateTime } from '@shared/format'
import type { AccountView, ConversationItem, ProjectItem } from '@shared/types'
import { IconChat, IconCopy, IconDownload, IconFolder, IconMonitor, IconMore, IconSearch, IconStar, IconTerminal, IconX } from '../components/icons'
import { Menu, type MenuEntry } from '../components/Menu'
import { Empty, Segmented, Spinner } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { displayName, errMessage, shortName } from '../util'

type Entry = 'all' | 'desktop' | 'terminal'

export function Conversations() {
  const { state, t, api, lang, tz, now, toast, scope, openDialog } = useApp()
  const [query, setQuery] = useState('')
  const [entry, setEntry] = useState<Entry>('all')
  const [cwd, setCwd] = useState('')
  const [account, setAccount] = useState(scope === 'all' ? '' : scope)
  const [favOnly, setFavOnly] = useState(false)
  const [items, setItems] = useState<ConversationItem[] | null>(null)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const seq = useRef(0)

  useEffect(() => setAccount(scope === 'all' ? '' : scope), [scope])
  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [api])

  const reload = () => {
    const id = ++seq.current
    api
      .listConversations({
        search: query.trim() || undefined,
        limit: 300,
        cwd: cwd || undefined,
        accountId: account || undefined,
        entrypoint: entry === 'all' ? undefined : entry,
        favoritesOnly: favOnly || undefined
      })
      .then((list) => id === seq.current && setItems(list))
      .catch(() => id === seq.current && setItems([]))
  }
  useEffect(() => {
    const h = window.setTimeout(reload, query ? 180 : 0)
    return () => window.clearTimeout(h)
  }, [api, query, entry, cwd, account, favOnly])

  const current = state.accounts.find((a) => a.isDesktopCurrent)
  const byId = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts])

  const toggleFav = async (c: ConversationItem) => {
    setItems((list) => list?.map((x) => (x.cliSessionId === c.cliSessionId ? { ...x, favorite: !c.favorite } : x)) ?? null)
    await api.setFavorite(c.cliSessionId, !c.favorite).catch(() => reload())
    play(c.favorite ? 'toggleOff' : 'toggleOn')
  }
  const exportMd = async (c: ConversationItem) => {
    const res = await api.exportConversation(c.cliSessionId).catch((e) => ({ ok: false, error: errMessage(e), cancelled: false, path: undefined }))
    if (res.cancelled) return
    if (res.ok) toast(t('convExported', { path: res.path ?? '' }), 'ok')
    else toast(t('errGeneric', { msg: res.error ?? '' }), 'bad')
  }
  const openDesktop = async (c: ConversationItem) => {
    const res = await api.openInDesktop({ desktopSessionId: c.desktopSessionId, cliSessionId: c.cliSessionId }).catch((e) => ({ ok: false, error: errMessage(e) }))
    if (res.ok) play('switch')
    else toast(t('errGeneric', { msg: res.error ?? '' }), 'bad')
  }
  const inTerminal = async (c: ConversationItem, a: AccountView) => {
    const res = await api.continueInTerminal({ accountId: a.id, cliSessionId: c.cliSessionId, cwd: c.cwd }).catch((e) => ({ ok: false, error: errMessage(e) }))
    if (res.ok) {
      play('switch')
      toast(t('convOpened', { name: displayName(a) }), 'ok')
    } else toast(t('errGeneric', { msg: res.error ?? '' }), 'bad')
  }
  /** Continue: in the desktop app when it can open this conversation with a usable account, else pick how in the switch dialog. */
  const resume = (c: ConversationItem) => {
    if (c.desktopSessionId && current && current.status !== 'limited') void openDesktop(c)
    else openDialog({ type: 'switch', mode: 'both', cliSessionId: c.cliSessionId, cwd: c.cwd, title: c.title })
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{t('convTitle')}</h1>
          <p className="page-sub">{t('convSubtitle')}</p>
        </div>
      </header>

      <div className="filters">
        <label className="search-box">
          <IconSearch size={15} />
          <input className="search-input" value={query} placeholder={t('convSearch')} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button type="button" className="icon-btn" aria-label={t('close')} onClick={() => setQuery('')}>
              <IconX size={14} />
            </button>
          )}
        </label>
        <Segmented<Entry>
          ariaLabel={t('convFilterAll')}
          value={entry}
          onChange={(v) => setEntry(v)}
          options={[
            { value: 'all', label: t('convFilterAll') },
            { value: 'desktop', label: t('convEntryDesktop') },
            { value: 'terminal', label: t('convEntryTerminal') }
          ]}
        />
        <select className="select" value={cwd} onChange={(e) => setCwd(e.target.value)} aria-label={t('colProject')}>
          <option value="">{t('convAllProjects')}</option>
          {projects
            .filter((p) => p.cwd)
            .map((p) => (
              <option key={p.projectDir} value={p.cwd}>
                {p.name} · {p.conversations}
              </option>
            ))}
        </select>
        <select className="select" value={account} onChange={(e) => setAccount(e.target.value)} aria-label={t('colAccount')}>
          <option value="">{t('lgAllAccounts')}</option>
          {state.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {displayName(a)}
            </option>
          ))}
        </select>
        <button type="button" className={`btn btn-sm${favOnly ? ' is-on' : ''}`} aria-pressed={favOnly} onClick={() => setFavOnly((v) => !v)}>
          <IconStar size={14} />
          {t('convFavorites')}
        </button>
        <span className="grow" />
        {items && <span className="sec-sub">{t('convCount', { n: items.length })}</span>}
      </div>

      {items === null ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Empty icon={<IconChat size={20} />} title={query || cwd || account || favOnly || entry !== 'all' ? t('convEmpty') : t('convEmptyAll')} hint={query ? t('convEmptyHint') : t('convEmptyAllHint')} />
      ) : (
        <div className="list-rows conv-list">
          {items.map((c) => {
            const names = c.accountIds.map((id) => byId.get(id)).filter((a): a is AccountView => !!a)
            const usable = state.accounts.filter((a) => a.cliConfigDir)
            const menu: MenuEntry[] = [
              ...(c.desktopSessionId ? [{ label: t('convOpenDesktop'), icon: <IconMonitor />, onSelect: () => void openDesktop(c) }] : []),
              ...(usable.length ? [{ heading: t('convChooseAccount') } as MenuEntry] : []),
              ...usable.map((a) => ({ label: displayName(a), icon: <IconTerminal />, sub: a.status === 'limited' ? t('statusLimited') : undefined, onSelect: () => void inTerminal(c, a) })),
              'sep',
              { label: t('convExport'), icon: <IconDownload />, onSelect: () => void exportMd(c) },
              ...(c.cwd ? [{ label: t('convOpenFolder'), icon: <IconFolder />, onSelect: () => void api.openPath(c.cwd!) }] : []),
              { label: t('convCopyResume'), icon: <IconCopy />, onSelect: () => void api.copyText(`claude --resume ${c.cliSessionId}`).then(() => toast(t('copied'), 'ok')) }
            ]
            return (
              <div key={c.cliSessionId} className="list-row conv-row">
                <button type="button" className={`icon-btn star${c.favorite ? ' on' : ''}`} aria-pressed={c.favorite} aria-label={c.favorite ? t('convUnfavorite') : t('convFavorite')} title={c.favorite ? t('convUnfavorite') : t('convFavorite')} onClick={() => void toggleFav(c)}>
                  <IconStar size={15} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div className="list-title" title={c.firstPrompt}>
                    {c.title}
                  </div>
                  <div className="list-meta">
                    <span>{c.entrypoint === 'claude-desktop' ? t('convEntryDesktop') : t('convEntryTerminal')}</span>
                    {c.cwd && (
                      <>
                        <span className="sep" />
                        <span className="ellipsis" title={c.cwd}>
                          {c.cwd.split(/[\\/]/).filter(Boolean).pop()}
                        </span>
                      </>
                    )}
                    {names.length > 0 && (
                      <>
                        <span className="sep" />
                        <span title={names.map(displayName).join(', ')}>{names.map(shortName).join(', ')}</span>
                      </>
                    )}
                    <span className="sep" />
                    <span title={formatDateTime(c.lastActivityAt, tz, lang)}>{formatAgo(c.lastActivityAt, lang, now)}</span>
                  </div>
                </div>
                <div className="dt-actions">
                  <button type="button" className="btn btn-sm" data-sound="none" onClick={() => resume(c)}>
                    {t('actResume')}
                  </button>
                  <Menu
                    label={t('more')}
                    items={menu}
                    width={240}
                    trigger={({ toggle }) => (
                      <button type="button" className="icon-btn" aria-label={t('more')} onClick={toggle}>
                        <IconMore />
                      </button>
                    )}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
