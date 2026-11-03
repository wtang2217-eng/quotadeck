import { useEffect, useMemo, useRef, useState } from 'react'
import { formatAgo, formatDateTime } from '@shared/format'
import type { AccountView, ConversationItem } from '@shared/types'
import { IconChat, IconChevronDown, IconCopy, IconFolder, IconMonitor, IconSearch, IconTerminal, IconX } from '../components/icons'
import { Menu } from '../components/Menu'
import { Avatar, Empty, Segmented, Spinner } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { displayName, errMessage } from '../util'

type Filter = 'all' | 'desktop' | 'terminal'

function ContinueButton({ item, accounts, preferred }: { item: ConversationItem; accounts: AccountView[]; preferred?: AccountView }) {
  const { t, api, toast, state } = useApp()
  const usable = accounts.filter((a) => a.cliConfigDir)
  const go = async (a: AccountView) => {
    try {
      const res = await api.continueInTerminal({ accountId: a.id, cliSessionId: item.cliSessionId, cwd: item.cwd })
      if (res.ok) {
        play('switch')
        toast(t('convOpened', { name: displayName(a) }), 'ok')
      } else {
        play('error')
        toast(t('errGeneric', { msg: res.error ?? '' }), 'bad')
      }
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }
  if (!usable.length) {
    return (
      <button type="button" className="btn btn-sm" disabled title={t('convNoCliAccount')}>
        <IconTerminal size={15} />
        {t('convContinue')}
      </button>
    )
  }
  const main = preferred && preferred.cliConfigDir ? preferred : usable[0]
  return (
    <div className="split">
      <button type="button" className="btn btn-sm" title={t('convContinueWith', { name: displayName(main) })} onClick={() => go(main)} data-sound="none">
        <IconTerminal size={15} />
        {t('convContinue')}
      </button>
      <Menu
        label={t('convChooseAccount')}
        items={[
          { heading: t('convChooseAccount') },
          ...usable.map((a) => ({
            label: displayName(a),
            icon: <Avatar account={a} size={20} />,
            sub: a.status === 'limited' ? t('statusLimited') : a.id === state.recommendedAccountId ? t('badgeRecommended') : undefined,
            onSelect: () => void go(a)
          }))
        ]}
        trigger={({ toggle }) => (
          <button type="button" className="btn btn-sm" aria-label={t('convChooseAccount')} onClick={toggle}>
            <IconChevronDown size={14} />
          </button>
        )}
      />
    </div>
  )
}

export function Conversations() {
  const { state, t, api, lang, tz, now, toast } = useApp()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<ConversationItem[] | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    const handle = window.setTimeout(
      () => {
        api
          .listConversations({ search: query.trim() || undefined, limit: 300 })
          .then((list) => {
            if (id === seq.current) setItems(list)
          })
          .catch(() => id === seq.current && setItems([]))
      },
      query ? 180 : 0
    )
    return () => window.clearTimeout(handle)
  }, [api, query])

  const shown = useMemo(() => {
    const list = items ?? []
    const filtered = list.filter((c) =>
      filter === 'all' ? true : filter === 'desktop' ? c.entrypoint === 'claude-desktop' : c.entrypoint !== 'claude-desktop'
    )
    return [...filtered].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }, [items, filter])

  const byId = new Map(state.accounts.map((a) => [a.id, a]))
  const preferred = state.accounts.find((a) => a.id === state.recommendedAccountId)

  const copyResume = async (c: ConversationItem) => {
    try {
      await api.copyText(`claude --resume ${c.cliSessionId}`)
      play('copy')
      toast(t('copied'), 'ok')
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('convTitle')}</h1>
          <div className="page-sub">{t('convSubtitle')}</div>
        </div>
      </header>

      <div className="toolbar">
        <div className="search">
          <IconSearch size={16} />
          <input
            className="input"
            value={query}
            placeholder={t('convSearch')}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('convSearch')}
          />
          {query && (
            <button type="button" className="icon-btn clear" aria-label={t('close')} onClick={() => setQuery('')}>
              <IconX size={14} />
            </button>
          )}
        </div>
        <Segmented<Filter>
          ariaLabel={t('convTitle')}
          value={filter}
          onChange={(v) => setFilter(v)}
          options={[
            { value: 'all', label: t('convFilterAll') },
            { value: 'desktop', label: t('convFilterDesktop') },
            { value: 'terminal', label: t('convFilterTerminal') }
          ]}
        />
        {items && <span className="count">{t('convCount', { n: shown.length })}</span>}
      </div>

      {items === null ? (
        <div className="card empty">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          {query ? (
            <Empty icon={<IconSearch size={24} />} title={t('convEmpty')} hint={t('convEmptyHint')} />
          ) : (
            <Empty icon={<IconChat size={24} />} title={t('convEmptyAll')} hint={t('convEmptyAllHint')} />
          )}
        </div>
      ) : (
        <div className="card list">
          {shown.map((c, i) => {
            const desktop = c.entrypoint === 'claude-desktop'
            const inLists = c.desktopAccountIds.map((id) => byId.get(id)).filter((a): a is AccountView => !!a)
            return (
              <div className="row" key={c.cliSessionId} style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}>
                <div className={`row-icon${desktop ? ' desktop' : ''}`}>{desktop ? <IconMonitor size={17} /> : <IconTerminal size={17} />}</div>
                <div className="row-main">
                  <div className="row-title ellipsis" title={c.firstPrompt || c.title}>
                    {c.title}
                  </div>
                  <div className="row-meta">
                    <span className={`badge ${desktop ? 'badge-accent' : 'badge-outline'}`} style={{ height: 19, fontSize: 11 }}>
                      {desktop ? t('convEntryDesktop') : c.entrypoint === 'cli' || !c.entrypoint ? t('convEntryTerminal') : t('convEntryOther')}
                    </span>
                    <span className="ellipsis mono" title={c.cwd} style={{ fontSize: 11.5 }}>
                      {c.cwd || c.projectDir}
                    </span>
                    <span className="sep" />
                    <span style={{ flex: 'none' }}>{t('convLines', { n: c.lines })}</span>
                  </div>
                </div>
                <div className="row-side">
                  {inLists.length > 0 && (
                    <span className="stack" title={t('convInLists', { names: inLists.map(displayName).join('、') })}>
                      {inLists.slice(0, 4).map((a) => (
                        <Avatar key={a.id} account={a} size={22} />
                      ))}
                    </span>
                  )}
                  <span className="row-time" title={formatDateTime(c.lastActivityAt, tz, lang)}>
                    {formatAgo(c.lastActivityAt, lang, now)}
                  </span>
                  <ContinueButton item={c} accounts={state.accounts} preferred={preferred} />
                  <div className="row-actions">
                    {c.cwd && (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={t('convOpenFolder')}
                        title={t('convOpenFolder')}
                        onClick={() => void api.openPath(c.cwd!).catch(() => undefined)}
                      >
                        <IconFolder size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('convCopyResume')}
                      title={t('convCopyResume')}
                      data-sound="none"
                      onClick={() => void copyResume(c)}
                    >
                      <IconCopy size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
