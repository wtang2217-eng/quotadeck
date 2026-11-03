// Accounts: the same table as the overview with every action, and adding an account.

import { AccountTable } from '../components/AccountTable'
import { IconPlus } from '../components/icons'
import { useApp } from '../context'
import { scopedAccounts } from './Overview'

export function Accounts() {
  const { state, t, scope, openDialog } = useApp()
  const accounts = scopedAccounts(state, scope)
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{t('accTitle')}</h1>
          <p className="page-sub">{t('accSub')}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" data-sound="none" onClick={() => openDialog({ type: 'add' })}>
            <IconPlus />
            {t('addAccount')}
          </button>
        </div>
      </header>
      <AccountTable accounts={accounts} detailed />
    </div>
  )
}
