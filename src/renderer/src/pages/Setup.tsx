// First start: what this computer needs, and one button that does every step it can.

import { useEffect, useState } from 'react'
import type { SetupProgress, SetupStatus } from '@shared/types'
import { IconCheck, IconExternal, IconInfo } from '../components/icons'
import { Spinner } from '../components/ui'
import { useApp } from '../context'
import { play } from '../sound'
import { errMessage } from '../util'

export function Setup() {
  const { api, t, navigate, setState, toast } = useApp()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    api
      .getSetupStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined)
    const off = api.onSetupProgress((p: SetupProgress) => {
      if (p.message) setLog((l) => [...l.slice(-40), p.message!])
      if (p.status) setStatus(p.status)
      if (p.phase === 'done') {
        setRunning(false)
        play(p.ok ? 'success' : 'error')
      }
    })
    return () => {
      alive = false
      off()
    }
  }, [api])

  const run = async () => {
    setRunning(true)
    setLog([])
    try {
      await api.runSetup({ installCli: true, connectIntegration: true, openAtLogin: false })
    } catch (e) {
      setRunning(false)
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{t('setupTitle')}</h1>
          <p className="page-sub">{t('setupSub')}</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              setState(await api.dismissSetup())
              navigate('dashboard')
            }}
          >
            {t('close')}
          </button>
          <button type="button" className="btn btn-primary" disabled={running || !!status?.ready} onClick={() => void run()}>
            {running && <Spinner />}
            {status?.ready ? t('setupReady') : t('setupRun')}
          </button>
        </div>
      </header>
      <div className="list-rows">
        {(status?.checks ?? []).map((c) => (
          <div key={c.id} className="list-row">
            {c.state === 'ok' ? <IconCheck /> : <IconInfo />}
            <div style={{ minWidth: 0 }}>
              <div className="list-title">{c.title}</div>
              <div className="list-meta" style={{ whiteSpace: 'normal' }}>
                {c.detail}
              </div>
            </div>
            {c.state === 'manual' && c.url ? (
              <button type="button" className="btn btn-sm" onClick={() => void api.openExternal(c.url!)}>
                <IconExternal />
              </button>
            ) : (
              <span className={`status${c.state === 'ok' ? '' : c.optional ? '' : ' warn'}`}>{c.state === 'ok' ? '✓' : ''}</span>
            )}
          </div>
        ))}
      </div>
      {log.length > 0 && <pre className="mono" style={{ marginTop: 16, whiteSpace: 'pre-wrap', color: 'var(--text-3)' }}>{log.join('\n')}</pre>}
    </div>
  )
}
