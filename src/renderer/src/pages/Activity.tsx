import { formatClock, formatDateTime, resolveTimeZone } from '@shared/format'
import type { ActivityEvent, ActivityType } from '@shared/types'
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconInfo,
  IconLogin,
  IconMerge,
  IconPlug,
  IconPulse,
  IconRefresh,
  IconX,
  IconZap
} from '../components/icons'
import { Avatar, ConfirmButton, Empty } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { eventKey, eventTone, errMessage } from '../util'

function EventIcon({ type }: { type: ActivityType }) {
  const size = 16
  switch (type) {
    case 'limit-hit':
      return <IconZap size={size} />
    case 'threshold':
      return <IconAlert size={size} />
    case 'reset':
      return <IconRefresh size={size} />
    case 'switch':
      return <IconArrowRight size={size} />
    case 'merge':
      return <IconMerge size={size} />
    case 'login':
      return <IconLogin size={size} />
    case 'integration':
      return <IconPlug size={size} />
    case 'error':
      return <IconX size={size} />
    default:
      return <IconInfo size={size} />
  }
}

export function Activity() {
  const { state, t, lang, tz, now, api, setState, toast, openDialog } = useApp()
  const timeZone = resolveTimeZone(tz)
  const dayKey = (ts: number) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts)
  const today = dayKey(now)
  const yesterday = dayKey(now - 86_400_000)
  const groups = new Map<string, ActivityEvent[]>()
  for (const ev of state.events) {
    const k = dayKey(ev.at)
    groups.set(k, [...(groups.get(k) ?? []), ev])
  }
  const byId = new Map(state.accounts.map((a) => [a.id, a]))

  const dayTitle = (k: string, sample: number) => {
    if (k === today) return t('actToday')
    if (k === yesterday) return t('actYesterday')
    return new Intl.DateTimeFormat(lang === 'zh-CN' ? 'zh-CN' : 'en-US', { timeZone, month: 'long', day: 'numeric', weekday: 'short' }).format(sample)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('actTitle')}</h1>
          <div className="page-sub">{t('actSubtitle')}</div>
        </div>
        {state.events.length > 0 && (
          <div className="page-actions">
            <ConfirmButton
              className="btn btn-sm"
              confirmLabel={t('actClearConfirm')}
              onConfirm={async () => {
                try {
                  setState(await api.clearEvents())
                } catch (e) {
                  play('error')
                  toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
                }
              }}
            >
              {t('actClear')}
            </ConfirmButton>
          </div>
        )}
      </header>

      {state.events.length === 0 ? (
        <div className="card">
          <Empty icon={<IconPulse size={24} />} title={t('actEmpty')} hint={t('actEmptyHint')} />
        </div>
      ) : (
        [...groups.entries()].map(([k, events]) => (
          <section className="day" key={k}>
            <h3 className="day-title">{dayTitle(k, events[0].at)}</h3>
            <div className="card tl">
              {events.map((ev) => {
                const tone = eventTone(ev.type)
                const acct = ev.accountId ? byId.get(ev.accountId) : undefined
                return (
                  <div className="tl-item" key={ev.id}>
                    <div className={`tl-icon tone-${tone}`}>
                      {ev.type === 'reset' ? <IconCheck size={16} stroke={2.2} /> : <EventIcon type={ev.type} />}
                    </div>
                    <div className="tl-body">
                      <div className="tl-title">
                        <span className="ellipsis">{ev.title}</span>
                        <span className={`badge tone-${tone}`} style={{ height: 19, fontSize: 11 }}>
                          {t(eventKey(ev.type))}
                        </span>
                      </div>
                      {ev.detail && <div className="tl-detail">{ev.detail}</div>}
                      {ev.cliSessionId && (
                        <div className="tl-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-soft"
                            data-sound="none"
                            onClick={() =>
                              openDialog({
                                type: 'switch',
                                mode: 'both',
                                fromAccountId: ev.accountId,
                                cliSessionId: ev.cliSessionId,
                                cwd: ev.cwd
                              })
                            }
                          >
                            {t('actContinue')}
                            <IconArrowRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    {acct && <Avatar account={acct} size={22} />}
                    <div className="tl-time" title={formatDateTime(ev.at, tz, lang)}>
                      {formatClock(ev.at, tz, lang, ev.at)}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
