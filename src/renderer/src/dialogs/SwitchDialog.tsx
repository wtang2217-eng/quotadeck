import { useEffect, useMemo, useState } from 'react'
import { formatAgo, formatClock, maskEmail } from '@shared/format'
import type { AccountView, ConversationItem, DesktopSwitchResult } from '@shared/types'
import { Dialog } from '../components/Dialog'
import { IconAlert, IconCheck, IconInfo, IconMonitor, IconSwitch, IconTerminal } from '../components/icons'
import { Avatar, Check, PlanBadge, Spinner } from '../components/ui'
import { useApp, type SwitchMode } from '../context'
import { play } from '../sound'
import { displayName, errMessage, limitKindKey, shownRemaining } from '../util'

const NEW = '__new__'

function TargetSub({ a }: { a: AccountView }) {
  const { t } = useApp()
  if (a.status === 'limited') return <div className="target-sub bad">{t('switchToLimited')}</div>
  const fh = shownRemaining(a.usage?.fiveHour, a.estimate?.fiveHour)
  const sd = shownRemaining(a.usage?.sevenDay, a.estimate?.sevenDay)
  if (fh.left === undefined && sd.left === undefined) return <div className="target-sub">{t('switchToUnknown')}</div>
  const v = (r: { left?: number; estimated: boolean }) => (r.left === undefined ? '—' : r.estimated ? t('approxPct', { pct: r.left }) : `${r.left}%`)
  return (
    <div className="target-sub num">
      {t('remain5h', { v: v(fh) })} · {t('remainWeek', { v: v(sd) })}
    </div>
  )
}

export function SwitchDialog({
  mode,
  fromAccountId,
  toAccountId,
  cliSessionId,
  cwd,
  onClose
}: {
  mode: SwitchMode
  fromAccountId?: string
  toAccountId?: string
  cliSessionId?: string
  cwd?: string
  title?: string
  onClose: () => void
}) {
  const { state, t, api, lang, tz, now, toast, setState } = useApp()
  const accounts = state.accounts
  const li = state.lastInterrupted
  const fromId = fromAccountId ?? (mode === 'both' ? li?.accountId ?? accounts.find((a) => a.isDesktopCurrent)?.id : undefined)
  const from = accounts.find((a) => a.id === fromId)

  const targets = useMemo(() => {
    const list = accounts.filter((a) => a.id !== from?.id)
    const score = (a: AccountView) =>
      (a.id === state.recommendedAccountId ? -1000 : 0) + (a.status === 'limited' ? 500 : 0) + (100 - (shownRemaining(a.usage?.fiveHour, a.estimate?.fiveHour).left ?? 50))
    return [...list].sort((a, b) => score(a) - score(b))
  }, [accounts, from?.id, state.recommendedAccountId])

  const [toId, setToId] = useState<string | undefined>(
    () => targets.find((a) => a.id === toAccountId)?.id ?? targets.find((a) => a.id === state.recommendedAccountId)?.id ?? targets[0]?.id
  )
  const to = accounts.find((a) => a.id === toId)

  const [recent, setRecent] = useState<ConversationItem[]>([])
  useEffect(() => {
    let alive = true
    api
      .listConversations({ limit: 15 })
      .then((list) => alive && setRecent(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api])

  const initialConv = cliSessionId ?? li?.cliSessionId ?? NEW
  const [convId, setConvId] = useState<string>(initialConv)
  useEffect(() => {
    if (convId === NEW && !cliSessionId && !li?.cliSessionId && recent[0]) setConvId(recent[0].cliSessionId)
  }, [recent])

  const conv = recent.find((c) => c.cliSessionId === convId)
  const convTitle = conv?.title ?? (convId === li?.cliSessionId ? li?.title : undefined)
  const convCwd = conv?.cwd ?? (convId === cliSessionId ? cwd : convId === li?.cliSessionId ? li?.cwd : undefined)
  const isNew = convId === NEW

  const promptText = state.settings.continuePrompt.trim()
  const [sendPrompt, setSendPrompt] = useState(!!promptText)
  const [busyA, setBusyA] = useState(false)
  const [errA, setErrA] = useState<string | null>(null)
  const [busyB, setBusyB] = useState(false)
  const [prep, setPrep] = useState<DesktopSwitchResult | null>(null)
  const [errB, setErrB] = useState<string | null>(null)

  useEffect(() => {
    setPrep(null)
    setErrB(null)
    setErrA(null)
  }, [toId])

  const showA = mode !== 'desktop'
  const showB = mode !== 'terminal'
  const title = mode === 'terminal' ? t('switchTitleTerminal') : mode === 'desktop' ? t('switchTitleDesktop') : t('switchTitle')

  const goTerminal = async (close: () => void) => {
    if (!to) return
    setBusyA(true)
    setErrA(null)
    try {
      const res = await api.continueInTerminal({
        accountId: to.id,
        cliSessionId: isNew ? undefined : convId,
        cwd: convCwd,
        sendPrompt: !isNew && sendPrompt && !!promptText
      })
      if (res.ok) {
        play('switch')
        toast(t('switchOpened', { name: displayName(to) }), 'ok')
        close()
      } else {
        play('error')
        setErrA(res.error ?? '')
      }
    } catch (e) {
      play('error')
      setErrA(errMessage(e))
    } finally {
      setBusyA(false)
    }
  }

  const prepareDesktop = async () => {
    if (!to) return
    setBusyB(true)
    setErrB(null)
    try {
      const res = await api.prepareDesktopSwitch(to.id)
      if (res.ok) {
        play('success')
        setPrep(res)
      } else {
        play('error')
        setErrB(res.error ?? '')
      }
    } catch (e) {
      play('error')
      setErrB(errMessage(e))
    } finally {
      setBusyB(false)
    }
  }

  const fromResetsAt = from?.limit?.resetsAt

  return (
    <Dialog title={title} kicker={t('kSwitch')} sub={t('switchSub')} icon={<IconSwitch size={18} />} wide={showA && showB} onClose={onClose}>
      {(close) =>
        targets.length === 0 ? (
          <div className="note-line" style={{ fontSize: 13 }}>
            <IconInfo size={15} />
            {t('switchNoTarget')}
          </div>
        ) : (
          <>
            <div className={`route${from ? '' : ' solo'}`}>
              {from && (
                <>
                  <div>
                    <div className="route-label">{t('switchFrom')}</div>
                    <div className={`who${from.status === 'limited' ? ' bad' : ''}`}>
                      <Avatar account={from} size={36} />
                      <div style={{ minWidth: 0 }}>
                        <div className="who-name ellipsis">{displayName(from)}</div>
                        <div className="who-sub">
                          {from.status === 'limited'
                            ? `${t('switchFromLimited', { kind: t(limitKindKey(from.limit?.kind)) })}${
                                fromResetsAt && fromResetsAt > now ? ` · ${t('bannerResetAt', { clock: formatClock(fromResetsAt, tz, lang, now) })}` : ''
                              }`
                            : from.nickname
                              ? maskEmail(from.email)
                              : (from.plan?.label ?? maskEmail(from.email))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="route-arrow" aria-hidden="true">
                    <span className="route-arrow-line" />
                  </div>
                </>
              )}
              <div>
                <div className="route-label">{t('switchTo')}</div>
                <div className="targets" role="radiogroup" aria-label={t('switchTo')}>
                  {targets.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={a.id === toId}
                      className={`target${a.id === toId ? ' on' : ''}`}
                      onClick={() => setToId(a.id)}
                    >
                      <span className="target-radio" />
                      <Avatar account={a} size={30} />
                      <span className="target-text">
                        <span className="target-name">
                          <span className="ellipsis">{displayName(a)}</span>
                          <PlanBadge plan={a.plan} t={t} />
                          {a.id === state.recommendedAccountId && <span className="badge badge-star">{t('badgeRecommended')}</span>}
                        </span>
                        <TargetSub a={a} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {showA && (
              <label className="field">
                <span className="field-label">{t('switchConversation')}</span>
                <select className="select" value={convId} onChange={(e) => setConvId(e.target.value)}>
                  {li?.cliSessionId && !recent.some((c) => c.cliSessionId === li.cliSessionId) && (
                    <option value={li.cliSessionId}>
                      {t('switchConvInterrupted')} · {li.title ?? li.cliSessionId.slice(0, 8)}
                    </option>
                  )}
                  {recent.map((c) => (
                    <option key={c.cliSessionId} value={c.cliSessionId}>
                      {c.cliSessionId === li?.cliSessionId ? `${t('switchConvInterrupted')} · ` : ''}
                      {c.title} · {formatAgo(c.lastActivityAt, lang, now)}
                    </option>
                  ))}
                  <option value={NEW}>＋ {t('switchConvNew')}</option>
                </select>
                {convCwd && (
                  <span className="field-hint mono ellipsis" style={{ fontSize: 11.5 }}>
                    {convCwd}
                  </span>
                )}
              </label>
            )}

            <div className={`paths${showA && showB ? '' : ' single'}`}>
              {showA && to && (
                <div className="path primary">
                  <div className="path-head">
                    <div className="path-icon">
                      <IconTerminal size={17} />
                    </div>
                    <div className="path-title">{t('switchPathA')}</div>
                    <span className="badge badge-accent" style={{ marginLeft: 'auto' }}>
                      {t('switchPathABadge')}
                    </span>
                  </div>
                  <div className="path-body">
                    {isNew ? t('switchPathANewBody', { name: displayName(to) }) : t('switchPathABody', { name: displayName(to) })}
                  </div>
                  {!isNew &&
                    (promptText ? (
                      <div>
                        <Check checked={sendPrompt} onChange={setSendPrompt}>
                          {t('switchSendPrompt')}
                        </Check>
                        {sendPrompt && <div className="prompt-preview">“{promptText}”</div>}
                      </div>
                    ) : (
                      <div className="note-line">
                        <IconInfo size={14} />
                        {t('switchSendPromptEmpty')}
                      </div>
                    ))}
                  {!to.cliConfigDir && (
                    <div className="note-line">
                      <IconInfo size={14} />
                      {t('actNoCli')}
                    </div>
                  )}
                  {errA !== null && (
                    <div className="error-line">
                      <IconAlert size={15} />
                      {t('errGeneric', { msg: errA })}
                    </div>
                  )}
                  <div className="path-spacer" />
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={busyA || !to.cliConfigDir}
                    data-sound="none"
                    onClick={() => void goTerminal(close)}
                  >
                    {busyA ? <Spinner /> : <IconTerminal size={16} />}
                    {isNew ? t('switchPathANewGo') : t('switchPathAGo')}
                  </button>
                </div>
              )}

              {showB && to && (
                <div className={`path${showA ? '' : ' primary'}`}>
                  <div className="path-head">
                    <div className="path-icon">
                      <IconMonitor size={17} />
                    </div>
                    <div className="path-title">{t('switchPathB')}</div>
                  </div>
                  {to.isDesktopCurrent ? (
                    <div className="success-line">
                      <IconCheck size={15} />
                      {t('switchAlreadyCurrent')}
                    </div>
                  ) : prep ? (
                    <>
                      <div className="success-line">
                        <IconCheck size={15} />
                        {prep.copied > 0
                          ? t('switchPrepared', { n: prep.copied, name: displayName(to) })
                          : t('switchPreparedNone', { name: displayName(to) })}
                      </div>
                      <ol className="steps">
                        <li>
                          <span className="step-n">1</span>
                          {t('switchStep1')}
                        </li>
                        <li>
                          <span className="step-n">2</span>
                          {t('switchStep2', { email: prep.targetEmail ?? to.email ?? displayName(to) })}
                        </li>
                        <li>
                          <span className="step-n">3</span>
                          {convTitle ? t('switchStep3', { title: convTitle }) : t('switchStep3Generic')}
                        </li>
                      </ol>
                      <div className="path-spacer" />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn" style={{ flex: 1 }} onClick={() => void api.openDesktopApp()}>
                          <IconMonitor size={15} />
                          {t('switchOpenDesktop')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ flex: 1 }}
                          data-sound="none"
                          onClick={() => {
                            void api.refresh().then(setState).catch(() => undefined)
                            close()
                          }}
                        >
                          <IconCheck size={15} />
                          {t('switchDesktopDone')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="path-body">{t('switchPathBBody', { name: displayName(to) })}</div>
                      {!state.settings.autoMergeDesktop && (
                        <div className="note-line">
                          <IconInfo size={14} />
                          {t('switchMergeOff')}
                        </div>
                      )}
                      {errB !== null && (
                        <div className="error-line">
                          <IconAlert size={15} />
                          {t('errGeneric', { msg: errB })}
                        </div>
                      )}
                      <div className="path-spacer" />
                      <button
                        type="button"
                        className={`btn btn-block${showA ? '' : ' btn-primary'}`}
                        disabled={busyB}
                        data-sound="none"
                        onClick={() => void prepareDesktop()}
                      >
                        {busyB ? <Spinner /> : <IconMonitor size={16} />}
                        {t('switchPathBGo')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )
      }
    </Dialog>
  )
}
