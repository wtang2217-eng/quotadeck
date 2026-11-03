import { useEffect, useRef, useState } from 'react'
import type { LoginProgress } from '@shared/types'
import { Dialog } from '../components/Dialog'
import { IconAlert, IconCheck, IconCopy, IconExternal, IconInfo, IconLogin, IconShield, IconUser } from '../components/icons'
import { Avatar, Check, PlanBadge } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { displayName, errMessage } from '../util'

const ORDER = ['starting', 'waiting-browser', 'verifying', 'done'] as const
const CLAUDE_AI = 'https://claude.ai'

export function AddAccountDialog({ reLoginAccountId, onClose }: { reLoginAccountId?: string; onClose: () => void }) {
  const { api, state, setState, t, toast } = useApp()
  const reAccount = reLoginAccountId ? state.accounts.find((a) => a.id === reLoginAccountId) : undefined
  const [owned, setOwned] = useState(state.settings.acceptedOwnershipNotice || !!reAccount)
  const [email, setEmail] = useState(reAccount?.email ?? '')
  const [loginId, setLoginId] = useState<string | null>(null)
  const [progress, setProgress] = useState<LoginProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seen = useRef(new Map<string, LoginProgress>())
  const loginRef = useRef<string | null>(null)
  const announced = useRef(false)

  useEffect(
    () =>
      api.onLoginProgress((p) => {
        seen.current.set(p.loginId, p)
        if (loginRef.current === p.loginId) setProgress(p)
      }),
    [api]
  )

  useEffect(() => {
    if (!progress || announced.current) return
    if (progress.phase === 'done') {
      announced.current = true
      play(progress.duplicate ? 'warn' : 'success')
      void api.getState().then(setState).catch(() => undefined)
    } else if (progress.phase === 'failed') {
      announced.current = true
      play('error')
    }
  }, [progress, api, setState])

  // The browser only opens after the user has read which account will be authorized and clicked "start".
  const begin = async () => {
    setError(null)
    announced.current = false
    try {
      if (!reAccount && !state.settings.acceptedOwnershipNotice) setState(await api.updateSettings({ acceptedOwnershipNotice: true }))
      const { loginId: id } = reAccount ? await api.reLogin(reAccount.id) : await api.startLogin({ email: email.trim() || undefined })
      loginRef.current = id
      setLoginId(id)
      setProgress(seen.current.get(id) ?? { loginId: id, phase: 'starting' })
    } catch (e) {
      play('error')
      setError(errMessage(e))
    }
  }

  const restart = () => {
    setLoginId(null)
    setProgress(null)
    loginRef.current = null
  }

  const copyLink = async (url: string) => {
    try {
      await api.copyText(url)
      play('copy')
      toast(t('copied'), 'ok')
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }

  const phase = progress?.phase
  const active = phase ? ORDER.indexOf(phase as (typeof ORDER)[number]) : -1
  const added = progress?.accountId ? state.accounts.find((a) => a.id === progress.accountId) : undefined
  const running = !!loginId && phase !== 'done' && phase !== 'failed' && phase !== 'cancelled'
  const duplicate = phase === 'done' && !!progress?.duplicate && !reAccount

  const cancel = async (close: () => void) => {
    if (loginId && running) await api.cancelLogin(loginId).catch(() => undefined)
    close()
  }

  const steps = [
    { key: 'addStepStart' as const, idx: 0 },
    { key: 'addStepBrowser' as const, idx: 1 },
    { key: 'addStepVerify' as const, idx: 2 }
  ]

  const whichAccount = (body: string) => (
    <div className="tip">
      <IconInfo size={15} />
      <div style={{ flex: 1 }}>
        <div>{body}</div>
        <button type="button" className="btn btn-sm" style={{ marginTop: 9 }} onClick={() => void api.openExternal(CLAUDE_AI)}>
          <IconExternal size={14} />
          {t('addOpenClaudeAi')}
        </button>
      </div>
    </div>
  )

  return (
    <Dialog
      title={reAccount ? t('reLoginTitle', { name: displayName(reAccount) }) : t('addTitle')}
      sub={reAccount ? undefined : t('addSub')}
      icon={<IconLogin size={18} />}
      onClose={onClose}
      dismissable={!running}
      footer={(close) =>
        !loginId ? (
          <>
            <button type="button" className="btn" data-sound="none" onClick={close}>
              {t('cancel')}
            </button>
            <button type="button" className="btn btn-primary" disabled={!owned} onClick={() => void begin()}>
              <IconLogin size={15} />
              {t('addStart')}
            </button>
          </>
        ) : duplicate ? (
          <>
            <button type="button" className="btn" data-sound="none" onClick={close}>
              {t('close')}
            </button>
            <button type="button" className="btn btn-primary" onClick={restart}>
              <IconLogin size={15} />
              {t('addTryAgain')}
            </button>
          </>
        ) : phase === 'done' ? (
          <button type="button" className="btn btn-primary" data-sound="none" onClick={close}>
            {t('done')}
          </button>
        ) : phase === 'failed' ? (
          <>
            <button type="button" className="btn" data-sound="none" onClick={close}>
              {t('close')}
            </button>
            <button type="button" className="btn btn-primary" onClick={restart}>
              {t('retry')}
            </button>
          </>
        ) : (
          <button type="button" className="btn" data-sound="none" onClick={() => void cancel(close)}>
            {t('cancel')}
          </button>
        )
      }
    >
      {!loginId ? (
        <div className="swap-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="note-line" style={{ fontSize: 13, color: 'var(--text-2)' }}>
            <IconShield size={16} />
            <span>{t('addIntro')}</span>
          </div>
          {whichAccount(reAccount ? t('addBeforeReLogin', { email: reAccount.email ?? displayName(reAccount) }) : t('addBeforeTip'))}
          {!reAccount && (
            <label className="field">
              <span className="field-label">
                {t('addEmail')} <span className="opt">· {t('addEmailOptional')}</span>
              </span>
              <input
                className="input"
                type="email"
                value={email}
                placeholder={t('addEmailPlaceholder')}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && owned && void begin()}
              />
              <span className="field-hint">{t('addEmailHint')}</span>
            </label>
          )}
          {!reAccount && (
            <div className={`own-box${owned ? ' on' : ''}`}>
              <Check checked={owned} onChange={setOwned} hint={t('addOwnershipHint')}>
                <b>{t('addOwnership')}</b>
              </Check>
            </div>
          )}
          {error && (
            <div className="error-line">
              <IconAlert size={15} />
              {t('errGeneric', { msg: error })}
            </div>
          )}
        </div>
      ) : duplicate ? (
        <div className="swap-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="big-result">
            <div className="big-result-icon" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>
              <IconUser size={26} />
            </div>
            <div className="big-result-title">{t('addDuplicateTitle')}</div>
          </div>
          {added && (
            <div className="edit-preview" style={{ alignSelf: 'center' }}>
              <Avatar account={added} size={34} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 650 }}>{added.email}</div>
                <div style={{ marginTop: 3 }}>
                  <PlanBadge plan={added.plan} t={t} />
                </div>
              </div>
            </div>
          )}
          {whichAccount(t('addDuplicateWho', { email: added?.email ?? (added ? displayName(added) : '—') }))}
        </div>
      ) : phase === 'done' ? (
        <div className="big-result swap-in">
          <div className="big-result-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok-ink)' }}>
            <IconCheck size={28} stroke={2.4} />
          </div>
          <div className="big-result-title">{t('addDone', { name: added ? displayName(added) : '' })}</div>
          {added && (
            <div className="edit-preview">
              <Avatar account={added} size={34} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 650 }}>{added.email}</div>
                <div style={{ marginTop: 3 }}>
                  <PlanBadge plan={added.plan} t={t} />
                </div>
              </div>
            </div>
          )}
          <div className="muted" style={{ fontSize: 12.5 }}>
            {t('addDoneHint')}
          </div>
        </div>
      ) : (
        <div className="swap-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="progress-steps">
            {steps.map((s) => {
              const mark = active > s.idx ? 'done' : active === s.idx ? 'active' : ''
              return (
                <div key={s.key} className={`pstep ${mark}`}>
                  <span className="pstep-mark">
                    {mark === 'done' ? (
                      <IconCheck size={13} stroke={3} />
                    ) : mark === 'active' && phase !== 'failed' ? (
                      <span className="pstep-dot" />
                    ) : (
                      s.idx + 1
                    )}
                  </span>
                  <span>{t(s.key)}</span>
                </div>
              )
            })}
          </div>
          {phase === 'waiting-browser' && (
            <div className="note-line" style={{ color: 'var(--text-2)', fontSize: 13 }}>
              <IconUser size={15} />
              <span>{t('addBrowserOpened')}</span>
            </div>
          )}
          {progress?.url && phase !== 'failed' && (
            <div className="fallback-link">
              <span>{t('addBrowserFallback')}</span>
              <button type="button" className="linkish" onClick={() => void api.openExternal(progress.url!)}>
                {t('addOpenLink')}
              </button>
              <span className="sep" />
              <button type="button" className="linkish" data-sound="none" onClick={() => void copyLink(progress.url!)}>
                <IconCopy size={12} />
                {t('addCopyLink')}
              </button>
            </div>
          )}
          {phase === 'failed' && (
            <div className="error-line">
              <IconAlert size={15} />
              {t('addFailed')}
              {progress?.message ? `：${progress.message}` : ''}
            </div>
          )}
          {phase === 'cancelled' && <div className="note-line">{t('addCancelled')}</div>}
          {running && progress?.message && phase !== 'waiting-browser' && (
            <div className="note-line mono" style={{ fontSize: 11.5 }}>
              {progress.message}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
