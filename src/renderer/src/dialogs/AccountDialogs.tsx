import { useState } from 'react'
import type { AccountView } from '@shared/types'
import { Dialog } from '../components/Dialog'
import { Avatar, Check } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { displayName, errMessage, planText } from '../util'

/** The account as one line: monogram, its name (the email unless the user named it), plan underneath. */
function AccountLine({ account }: { account: AccountView }) {
  const { t } = useApp()
  return (
    <div className="acct-line">
      <Avatar account={account} size={32} />
      <div style={{ minWidth: 0 }}>
        <div className="acct-line-name ellipsis">{displayName(account)}</div>
        <div className="acct-line-sub ellipsis">{account.nickname && account.email ? `${planText(account.plan, t)} · ${account.email}` : planText(account.plan, t)}</div>
      </div>
    </div>
  )
}

export function EditAccountDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const { state, setState, api, t, toast } = useApp()
  const account = state.accounts.find((a) => a.id === accountId)
  const [nickname, setNickname] = useState(account?.nickname ?? '')
  if (!account) return null

  const save = async (close: () => void) => {
    try {
      setState(await api.updateAccount(account.id, { nickname: nickname.trim(), color: account.color }))
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
      sub={account.email}
      onClose={onClose}
      footer={(close) => (
        <>
          <button type="button" className="btn btn-ghost" data-sound="none" onClick={close}>
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
          <AccountLine account={{ ...account, nickname: nickname.trim() || undefined }} />
          <label className="field">
            <span className="field-label">{t('editNickname')}</span>
            <input
              className="input"
              value={nickname}
              maxLength={40}
              placeholder={t('editNicknamePlaceholder')}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save(close)}
              data-autofocus
            />
          </label>
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
      onClose={onClose}
      footer={(close) => (
        <>
          <button type="button" className="btn btn-ghost" data-sound="none" onClick={close}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-danger-solid" data-sound="none" data-autofocus onClick={() => void remove(close)}>
            {t('removeGo')}
          </button>
        </>
      )}
    >
      <AccountLine account={account} />
      <p className="dialog-text">{t('removeBody')}</p>
      <Check checked={trash && !isDefault} onChange={setTrash} disabled={isDefault} hint={isDefault ? t('removeTrashDefault') : account.cliConfigDir}>
        {t('removeTrash')}
      </Check>
    </Dialog>
  )
}
