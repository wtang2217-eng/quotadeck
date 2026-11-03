// Tray popover (?view=tray): every account's usage at a glance, and the two things you might do from there.

import { useEffect, useMemo, useState } from 'react'
import type { QuotaDeckApi } from '@shared/api'
import type { AppState } from '@shared/types'
import { MeterCell } from '../components/AccountTable'
import { IconArrowRight, Logo } from '../components/icons'
import { Ctx, type AppCtx } from '../context'
import { makeT } from '../i18n'
import { displayName, resolveTheme, shortName } from '../util'

export function TrayView({ api }: { api: QuotaDeckApi }) {
  const [state, setState] = useState<AppState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    void api.getState().then(setState).catch(() => undefined)
    const off = api.onState(setState)
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      off()
      window.clearInterval(id)
    }
  }, [api])
  useEffect(() => {
    if (!state) return
    const root = document.documentElement
    root.dataset.theme = resolveTheme(state.settings.theme)
    root.dataset.accent = state.settings.accent
    root.lang = state.settings.language
  }, [state?.settings.theme, state?.settings.accent, state?.settings.language])

  const ctx = useMemo<AppCtx | null>(() => {
    if (!state) return null
    return {
      api,
      state,
      setState,
      t: makeT(state.settings.language),
      lang: state.settings.language,
      tz: state.settings.timezone,
      now,
      page: 'dashboard',
      navigate: (page) => void api.runCommand?.({ type: 'navigate', page }),
      openDialog: () => undefined,
      closeDialog: () => undefined,
      toast: () => undefined,
      scope: 'all',
      setScope: () => undefined,
      openPalette: () => undefined
    }
  }, [api, state, now])
  if (!ctx || !state) return null
  const { t } = ctx
  const current = state.accounts.find((a) => a.isDesktopCurrent)
  const rec = state.accounts.find((a) => a.id === state.recommendedAccountId && a.id !== current?.id)

  return (
    <Ctx.Provider value={ctx}>
      <div className="tray">
        <div className="tray-head">
          <Logo size={18} />
          <span className="tray-title">QuotaDeck</span>
          <span className="grow" />
          <span className="tray-sub" title={current ? displayName(current) : undefined}>
            {current ? `${t('sideDesktop')} · ${shortName(current)}` : t('sideDesktopIdle')}
          </span>
        </div>
        <div className="tray-list">
          {state.accounts.map((a) => (
            <div key={a.id} className={`tray-row${a.isDesktopCurrent ? ' is-current' : ''}`}>
              <div className="tray-name ellipsis" title={displayName(a)}>
                {shortName(a)}
              </div>
              <MeterCell w={a.usage?.fiveHour} estimatePct={a.estimate?.fiveHour} estimateResetsAt={a.estimate?.fiveHourResetsAt} limitResetsAt={a.limit?.kind === 'session' ? a.limit.resetsAt : undefined} />
              <MeterCell w={a.usage?.sevenDay} estimatePct={a.estimate?.sevenDay} limitResetsAt={a.limit?.kind === 'weekly' ? a.limit.resetsAt : undefined} />
            </div>
          ))}
        </div>
        <div className="tray-foot">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void api.runCommand?.({ type: 'navigate', page: 'dashboard' })}>
            {t('trayOpen')}
          </button>
          <span className="grow" />
          {rec && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void api.runCommand?.({ type: 'open-switch', toAccountId: rec.id })}>
              {t('adviceAct', { name: displayName(rec) })}
              <IconArrowRight />
            </button>
          )}
        </div>
      </div>
    </Ctx.Provider>
  )
}
