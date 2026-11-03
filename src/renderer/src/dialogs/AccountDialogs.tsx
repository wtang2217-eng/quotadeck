import { useState } from 'react'
import { DEFAULT_COLORS } from '@shared/format'
import { Dialog } from '../components/Dialog'
import { IconPencil, IconTrash } from '../components/icons'
import { Avatar, Check, PlanBadge } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { displayName, errMessage } from '../util'

export function EditAccountDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const { state, setState, api, t, toast } = useApp()
  const account = state.accounts.find((a) => a.id === accountId)
  const [nickname, setNickname] = useState(account?.nickname ?? '')
  const [color, setColor] = useState(account?.color ?? DEFAULT_COLORS[0])
  if (!account) return null
  const preview = { ...account, nickname: nickname.trim() || undefined, color }

  const save = async (close: () => void) => {
    try {
      setState(await api.updateAccount(account.id, { nickname: nickname.trim(), color }))
      play('success')
      close()
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }

  return (
    <Dialog
      title={t('editTitle')}
      icon={<IconPencil size={17} />}
      onClose={onClose}
      footer={(close) => (
        <>
          <button type="button" className="btn" data-sound="none" onClick={close}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-primary" data-sound="none" onClick={() => void save(close)}>
            {t('save')}
          </button>
        </>
      )}
    >
      {(close) => (
        <>
          <div className="edit-preview">
            <Avatar account={preview} size={40} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="ellipsis">{displayName(preview)}</span>
                <PlanBadge plan={account.plan} t={t} />
              </div>
              <div className="muted ellipsis" style={{ fontSize: 12.5 }}>
                {account.email}
              </div>
            </div>
          </div>
          <label className="field">
            <span className="field-label">{t('editNickname')}</span>
            <input
              className="input"
              value={nickname}
              maxLength={24}
              placeholder={t('editNicknamePlaceholder')}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save(close)}
              data-autofocus
            />
          </label>
          <div className="field">
            <span className="field-label">{t('editColor')}</span>
            <div className="swatches" role="radiogroup" aria-label={t('editColor')}>
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === color}
                  aria-label={c}
                  className={`swatch${c === color ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Dialog>
  )
}

export function RemoveAccountDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const { state, setState, api, t, toast } = useApp()
  const account = state.accounts.find((a) => a.id === accountId)
  const [trash, setTrash] = useState(false)
  if (!account) return null
  const isDefault = !!account.usesDefaultCliDir

  const remove = async (close: () => void) => {
    try {
      setState(await api.removeAccount(account.id, { trashProfile: trash && !isDefault }))
      close()
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }

  return (
    <Dialog
      title={t('removeTitle', { name: displayName(account) })}
      icon={<IconTrash size={17} />}
      onClose={onClose}
      footer={(close) => (
        <>
          <button type="button" className="btn" data-sound="none" onClick={close}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-danger-solid" data-sound="none" onClick={() => void remove(close)}>
            {t('removeGo')}
          </button>
        </>
      )}
    >
      <div className="edit-preview">
        <Avatar account={account} size={36} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }} className="ellipsis">
            {displayName(account)}
          </div>
          <div className="muted ellipsis" style={{ fontSize: 12.5 }}>
            {account.email}
          </div>
        </div>
      </div>
      <div className="note-line" style={{ fontSize: 13, color: 'var(--text-2)' }}>
        {t('removeBody')}
      </div>
      <Check checked={trash && !isDefault} onChange={setTrash} disabled={isDefault} hint={isDefault ? t('removeTrashDefault') : account.cliConfigDir}>
        {t('removeTrash')}
      </Check>
    </Dialog>
  )
}
