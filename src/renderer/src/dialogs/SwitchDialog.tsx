import { useEffect, useMemo, useState } from 'react'
import { formatAgo, formatClock } from '@shared/format'
import type { AccountView, ConversationItem, DesktopSwitchResult } from '@shared/types'
import { MeterCell } from '../components/AccountTable'
import { Dialog } from '../components/Dialog'
import { IconAlert, IconArrowRight, IconCheck, IconInfo, IconMonitor, IconTerminal } from '../components/icons'
import { Check, Spinner } from '../components/ui'
import { useApp, type SwitchMode } from '../context'
import { play } from '../sound'
import { displayName, errMessage, limitKindKey, planText, shownRemaining } from '../util'

const NEW = '__new__'
type Where = 'desktop' | 'terminal'

export function SwitchDialog({
  mode,
  fromAccountId,
  toAccountId,
  cliSessionId,
  cwd,
  title: convTitleHint,
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
  const { state, t, api, lang, tz, now, toast } = useApp()
  const accounts = state.accounts
  const li = state.lastInterrupted
  const fromId = fromAccountId ?? li?.accountId ?? accounts.find((a) => a.isDesktopCurrent)?.id
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
  const [where, setWhere] = useState<Where>(mode === 'terminal' ? 'terminal' : 'desktop')

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

  const [convId, setConvId] = useState<string>(cliSessionId ?? li?.cliSessionId ?? NEW)
  useEffect(() => {
    if (convId === NEW && !cliSessionId && !li?.cliSessionId && recent[0]) setConvId(recent[0].cliSessionId)
  }, [recent])
  const conv = recent.find((c) => c.cliSessionId === convId)
  const convTitle = conv?.title ?? (convId === cliSessionId ? convTitleHint : convId === li?.cliSessionId ? li?.title : undefined)
  const convCwd = conv?.cwd ?? (convId === cliSessionId ? cwd : convId === li?.cliSessionId ? li?.cwd : undefined)
  const isNew = convId === NEW

  const promptText = state.settings.continuePrompt.trim()
  const [sendPrompt, setSendPrompt] = useState(!!promptText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prep, setPrep] = useState<DesktopSwitchResult | null>(null)
  useEffect(() => {
    setPrep(null)
    setError(null)
  }, [toId, where])

  const pending = state.pendingSwitch && state.pendingSwitch.toAccountId === toId ? state.pendingSwitch : undefined
  const clock = (ts: number) => formatClock(ts, tz, lang, now)

  const goTerminal = async (close: () => void) => {
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.continueInTerminal({ accountId: to.id, cliSessionId: isNew ? undefined : convId, cwd: convCwd, sendPrompt: !isNew && sendPrompt && !!promptText })
      if (res.ok) {
        play('switch')
        toast(t('switchOpened', { name: displayName(to) }), 'ok')
        close()
      } else {
        play('error')
        setError(res.error ?? '')
      }
    } catch (e) {
      play('error')
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const prepareDesktop = async () => {
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.prepareDesktopSwitch(to.id, { fromAccountId: from?.id, cliSessionId: isNew ? undefined : convId, title: convTitle, cwd: convCwd })
      if (res.ok) {
        play('success')
        setPrep(res)
      } else {
        play('error')
        setError(res.error ?? '')
      }
    } catch (e) {
      play('error')
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const fromLine = from
    ? from.status === 'limited'
      ? `${t('switchFromLimited', { kind: t(limitKindKey(from.limit?.kind)) })}${from.limit?.resetsAt && from.limit.resetsAt > now ? ` · ${t('resetAt', { clock: clock(from.limit.resetsAt) })}` : ''}`
      : planText(from.plan, t)
    : ''

  return (
    <Dialog
      title={t('swTitle')}
      sub={t('swSub')}
      wide
      onClose={onClose}
      footer={(close) =>
        targets.length === 0 ? null : prep && where === 'desktop' ? (
          <>
            <button type="button" className="btn" onClick={() => void api.openDesktopApp()}>
              <IconMonitor />
              {t('swOpenDesktop')}
            </button>
            <button type="button" className="btn btn-primary" onClick={close}>
              {t('swClose')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={close}>
              {t('cancel')}
            </button>
            {where === 'desktop' ? (
              <button type="button" className="btn btn-primary" data-autofocus disabled={busy || !to || to.isDesktopCurrent} data-sound="none" onClick={() => void prepareDesktop()}>
                {busy ? <Spinner /> : null}
                {t('swGoDesktop')}
                {!busy && <IconArrowRight />}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" data-autofocus disabled={busy || !to?.cliConfigDir} data-sound="none" onClick={() => void goTerminal(close)}>
                {busy ? <Spinner /> : <IconTerminal />}
                {t('swGoTerminal')}
              </button>
            )}
          </>
        )
      }
    >
      {targets.length === 0 ? (
        <div className="note-line">
          <IconInfo />
          {t('switchNoTarget')}
        </div>
      ) : prep && where === 'desktop' && to ? (
        <div className="swap-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="success-line">
            <IconCheck />
            {prep.copied > 0 ? t('swReady', { n: prep.copied, name: displayName(to) }) : t('swReadyNone', { name: displayName(to) })}
          </div>
          <ol className="steps">
            <li>
              <span className="step-n">1</span>
              {t('swStep1')}
            </li>
            <li>
              <span className="step-n">2</span>
              {t('swStep2', { email: prep.targetEmail ?? to.email ?? displayName(to) })}
            </li>
            <li>
              <span className="step-n">3</span>
              {convTitle ? t('swStep3', { title: convTitle }) : t('swStep3Generic')}
            </li>
          </ol>
          {(pending?.phase === 'waiting' || prep.pending?.phase === 'waiting') && (
            <div className="waiting">
              <Spinner />
              {t('swWaiting', { name: displayName(to) })}
            </div>
          )}
        </div>
      ) : (
        <>
          {from && (
            <div className="route-from">
              <span>{t('swFrom')}</span>
              <b>{displayName(from)}</b>
              <span className={from.status === 'limited' ? 'status bad' : 'muted'}>{fromLine}</span>
            </div>
          )}

          <div className="field">
            <span className="field-label">{t('swTo')}</span>
            <div className="picks" role="radiogroup" aria-label={t('swTo')}>
              {targets.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={a.id === toId} className={`pick${a.id === toId ? ' on' : ''}`} onClick={() => setToId(a.id)}>
                  <span className="radio" />
                  <span style={{ minWidth: 0 }}>
                    <span className="pick-name">
                      <span className="ellipsis">{displayName(a)}</span>
                      {a.id === state.recommendedAccountId && <span className="tag tag-accent">{t('swRecommended')}</span>}
                      {a.status === 'limited' && <span className="status bad">{t('swLimited')}</span>}
                    </span>
                    <span className="pick-sub">
                      {planText(a.plan, t)}
                      {a.email ? ` · ${a.email}` : ''}
                    </span>
                  </span>
                  <span className="pick-meters">
                    <MeterCell compact label={t('fiveHour')} w={a.usage?.fiveHour} estimatePct={a.estimate?.fiveHour} />
                    <MeterCell compact label={t('sevenDay')} w={a.usage?.sevenDay} estimatePct={a.estimate?.sevenDay} />
                  </span>
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">{t('swConversation')}</span>
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
              <option value={NEW}>{t('swNew')}</option>
            </select>
            {convCwd && <span className="field-hint mono ellipsis">{convCwd}</span>}
          </label>

          <div className="field">
            <span className="field-label">{t('swWhere')}</span>
            <div className="where" role="radiogroup" aria-label={t('swWhere')}>
              {(['desktop', 'terminal'] as const).map((w) => (
                <button key={w} type="button" role="radio" aria-checked={where === w} className={`where-opt${where === w ? ' on' : ''}`} onClick={() => setWhere(w)}>
                  <span className="radio" />
                  <span className="where-title">{w === 'desktop' ? t('swDesktopTitle') : t('swTerminalTitle')}</span>
                  <span className="where-body">
                    {w === 'desktop' ? t('swDesktopBody', { name: to ? displayName(to) : '' }) : t('swTerminalBody', { name: to ? displayName(to) : '' })}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {where === 'terminal' && !isNew && (
            <div>
              {promptText ? (
                <>
                  <Check checked={sendPrompt} onChange={setSendPrompt}>
                    {t('switchSendPrompt')}
                  </Check>
                  {sendPrompt && <div className="prompt-preview">“{promptText}”</div>}
                </>
              ) : (
                <div className="note-line">
                  <IconInfo />
                  {t('switchSendPromptEmpty')}
                </div>
              )}
            </div>
          )}
          {where === 'terminal' && to && !to.cliConfigDir && (
            <div className="note-line">
              <IconInfo />
              {t('actNoCli')}
            </div>
          )}
          {where === 'desktop' && to?.isDesktopCurrent && (
            <div className="note-line">
              <IconInfo />
              {t('switchAlreadyCurrent')}
            </div>
          )}
          {error !== null && (
            <div className="error-line">
              <IconAlert />
              {t('errGeneric', { msg: error })}
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}
