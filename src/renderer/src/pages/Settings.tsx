import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_CONTINUE_PROMPT } from '@shared/defaults'
import { formatAgo } from '@shared/format'
import type { AccentChoice, Density, IntegrationStatus, Language, Settings as SettingsT, TerminalChoice, ThemeSetting } from '@shared/types'
import {
  IconBell,
  IconCheck,
  IconCommand,
  IconUpdate,
  IconEye,
  IconFolder,
  IconInfo,
  IconMerge,
  IconPlay,
  IconPlug,
  IconSliders,
  IconSwitch,
  IconVolume
} from '../components/icons'
import { ConfirmButton, Segmented, Spinner, Toggle } from '../components/ui'
import { useApp } from '../context'
import type { TKey } from '../i18n'
import { configureSound, play, SOUND_NAMES, type SoundName } from '../sound'
import { errMessage, resolveTheme, revealTheme } from '../util'

const ZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Singapore',
  'America/Chicago',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'UTC'
]

const ACCENT_OPTIONS: { value: AccentChoice; color: string; key: TKey }[] = [
  { value: 'indigo', color: '#3E63DD', key: 'accentIndigo' },
  { value: 'teal', color: '#12A594', key: 'accentTeal' },
  { value: 'orange', color: '#F76B15', key: 'accentOrange' },
  { value: 'graphite', color: '#27272A', key: 'accentGraphite' }
]

const SOUND_LABEL: Record<SoundName, TKey> = {
  click: 'soundClick',
  toggleOn: 'soundToggleOn',
  toggleOff: 'soundToggleOff',
  open: 'soundOpen',
  close: 'soundClose',
  success: 'soundSuccess',
  switch: 'soundSwitch',
  warn: 'soundWarn',
  alert: 'soundAlert',
  error: 'soundError',
  copy: 'soundCopy'
}

function Section({ icon, title, sub, children }: { icon: ReactNode; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card set-card">
      <div className="set-card-head">
        <div className="set-card-icon">{icon}</div>
        <div>
          <div className="set-card-title">{title}</div>
          {sub && <div className="set-card-sub">{sub}</div>}
        </div>
      </div>
      {children}
    </section>
  )
}

/** Records a key combination: press it in the box; Backspace clears it. */
function ShortcutInput({ value, mac, onSave }: { value: string; mac: boolean; onSave: (v: string) => void }) {
  const { t } = useApp()
  const shown = (v: string) => (v ? v.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace(/\+/g, ' + ') : '')
  return (
    <input
      className="input"
      style={{ width: 220 }}
      readOnly
      value={shown(value)}
      placeholder={t('setShortcutPlaceholder')}
      onKeyDown={(e) => {
        e.preventDefault()
        if (e.key === 'Backspace' || e.key === 'Delete') return onSave('')
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
        const parts = [e.ctrlKey || e.metaKey ? 'CommandOrControl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean)
        if (!parts.length) return
        const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
        onSave([...parts, key].join('+'))
      }}
    />
  )
}

function Row({ label, hint, children, top }: { label: ReactNode; hint?: ReactNode; children: ReactNode; top?: boolean }) {
  return (
    <div className={`set-row${top ? ' top' : ''}`}>
      <div className="set-text">
        <div className="set-label">{label}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

function StatusPill({ on, conflict, t }: { on: boolean; conflict?: boolean; t: (k: TKey) => string }) {
  if (conflict && !on)
    return (
      <span className="status-pill conflict">
        <span className="dot-sm dot-warn" />
        {t('setConflict')}
      </span>
    )
  return (
    <span className={`status-pill ${on ? 'on' : 'off'}`}>
      <span className={`dot-sm ${on ? 'dot-ok' : 'dot-muted'}`} />
      {on ? t('setInstalled') : t('setNotInstalled')}
    </span>
  )
}

export function Settings() {
  const { state, setState, t, lang, now, api, toast } = useApp()
  const s = state.settings
  const [prompt, setPrompt] = useState(s.continuePrompt)
  const [dirOverride, setDirOverride] = useState(s.desktopDataDirOverride ?? '')
  const [port, setPort] = useState(String(s.serverPort))
  const [volume, setVolume] = useState(Math.round(s.soundVolume * 100))
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => setPrompt(s.continuePrompt), [s.continuePrompt])
  useEffect(() => setDirOverride(s.desktopDataDirOverride ?? ''), [s.desktopDataDirOverride])
  useEffect(() => setPort(String(s.serverPort)), [s.serverPort])
  useEffect(() => setVolume(Math.round(s.soundVolume * 100)), [s.soundVolume])

  const [checking, setChecking] = useState(false)
  const info = state.update
  const updateLine = info?.available
    ? t('setUpdateAvailable', { v: info.latest ?? '' })
    : info?.checkedAt
      ? t('setUpdateLatest', { v: state.appVersion, ago: formatAgo(info.checkedAt, lang, now) })
      : t('setUpdateNever')
  const checkNow = async () => {
    setChecking(true)
    try {
      const res = await api.checkForUpdates()
      if (res.available && res.url) toast(t('setUpdateAvailable', { v: res.latest ?? '' }), 'ok')
      else toast(t('setUpdateUpToDate'), 'ok')
      setState(await api.getState())
    } catch (e) {
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    } finally {
      setChecking(false)
    }
  }

  const update = async (patch: Partial<SettingsT>, savedToast = false) => {
    try {
      setState(await api.updateSettings(patch))
      if (savedToast) toast(t('saved'), 'ok')
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    }
  }

  const act = async <R,>(key: string, fn: () => Promise<R>, ok?: (r: R) => void) => {
    setBusy(key)
    try {
      const r = await fn()
      ok?.(r)
    } catch (e) {
      play('error')
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    } finally {
      setBusy(null)
    }
  }

  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const terminals: { value: TerminalChoice; key: TKey }[] =
    state.platform === 'win32'
      ? [
          { value: 'auto', key: 'setTermAuto' },
          { value: 'wt', key: 'setTermWt' },
          { value: 'powershell', key: 'setTermPowershell' }
        ]
      : state.platform === 'darwin'
        ? [
            { value: 'auto', key: 'setTermAuto' },
            { value: 'terminal-app', key: 'setTermApp' },
            { value: 'iterm', key: 'setTermIterm' }
          ]
        : [
            { value: 'auto', key: 'setTermAuto' },
            { value: 'gnome-terminal', key: 'setTermGnome' },
            { value: 'x-terminal-emulator', key: 'setTermX' }
          ]

  const integ = state.integration
  const merge = state.merge
  const setIntegration = (status: IntegrationStatus) => setState({ ...state, integration: status })

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('setTitle')}</h1>
          <div className="page-sub">{t('setSubtitle')}</div>
        </div>
      </header>

      <div className="settings">
        <Section icon={<IconEye size={16} />} title={t('setAppearance')}>
          <Row label={t('setTheme')}>
            <Segmented<ThemeSetting>
              ariaLabel={t('setTheme')}
              value={s.theme}
              onChange={(v, e) => {
                const next = resolveTheme(v)
                revealTheme(
                  () => {
                    document.documentElement.dataset.theme = next
                  },
                  e.clientX,
                  e.clientY
                )
                void update({ theme: v })
              }}
              options={[
                { value: 'system', label: t('setThemeSystem') },
                { value: 'light', label: t('setThemeLight') },
                { value: 'dark', label: t('setThemeDark') }
              ]}
            />
          </Row>
          <Row label={t('setAccent')} hint={t('setAccentHint')}>
            <div className="swatch-row" role="radiogroup" aria-label={t('setAccent')}>
              {ACCENT_OPTIONS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  role="radio"
                  aria-checked={s.accent === a.value}
                  className={`swatch-btn${s.accent === a.value ? ' on' : ''}`}
                  onClick={() => {
                    document.documentElement.dataset.accent = a.value
                    void update({ accent: a.value })
                  }}
                >
                  <span className="swatch-dot" style={{ background: a.color }} />
                  {t(a.key)}
                </button>
              ))}
            </div>
          </Row>
          <Row label={t('setDensity')} hint={t('setDensityHint')}>
            <Segmented<Density>
              ariaLabel={t('setDensity')}
              value={s.density === 'compact' ? 'compact' : 'comfortable'}
              onChange={(v) => {
                document.documentElement.dataset.density = v
                void update({ density: v })
              }}
              options={[
                { value: 'comfortable', label: t('densityComfortable') },
                { value: 'compact', label: t('densityCompact') }
              ]}
            />
          </Row>
        </Section>

        <Section icon={<IconSliders size={16} />} title={t('setGeneral')}>
          <Row label={t('setLanguage')}>
            <Segmented<Language>
              ariaLabel={t('setLanguage')}
              value={s.language}
              onChange={(v) => void update({ language: v, continuePrompt: s.continuePrompt === DEFAULT_CONTINUE_PROMPT[s.language] ? DEFAULT_CONTINUE_PROMPT[v] : s.continuePrompt })}
              options={[
                { value: 'zh-CN', label: '中文' },
                { value: 'en', label: 'English' }
              ]}
            />
          </Row>
          <Row label={t('setTimezone')} hint={t('setTimezoneHint')}>
            <select className="select" style={{ width: 250 }} value={s.timezone} onChange={(e) => void update({ timezone: e.target.value })}>
              <option value="system">{t('setTimezoneSystem', { tz: systemTz })}</option>
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
              {!ZONES.includes(s.timezone) && s.timezone !== 'system' && <option value={s.timezone}>{s.timezone}</option>}
            </select>
          </Row>
          <Row label={t('setOpenAtLogin')} hint={t('setOpenAtLoginHint')}>
            <Toggle label={t('setOpenAtLogin')} on={s.openAtLogin} onChange={(v) => void update({ openAtLogin: v })} />
          </Row>
          <Row label={t('setStartHidden')}>
            <Toggle label={t('setStartHidden')} on={s.startHidden} onChange={(v) => void update({ startHidden: v })} />
          </Row>
        </Section>

        <Section icon={<IconCommand size={16} />} title={t('setShortcuts')}>
          <Row label={t('setGlobalShortcut')} hint={t('setGlobalShortcutHint')}>
            <ShortcutInput value={s.globalShortcut} mac={state.platform === 'darwin'} onSave={(v) => void update({ globalShortcut: v }, true)} />
          </Row>
          {state.platform === 'darwin' && (
            <Row label={t('setTrayPercent')} hint={t('setTrayPercentHint')}>
              <Toggle label={t('setTrayPercent')} on={s.trayShowPercent} onChange={(v) => void update({ trayShowPercent: v })} />
            </Row>
          )}
        </Section>

        <Section icon={<IconUpdate size={16} />} title={t('setUpdates')}>
          <Row label={t('setAutoUpdates')} hint={t('setAutoUpdatesHint')}>
            <Toggle label={t('setAutoUpdates')} on={s.autoCheckUpdates} onChange={(v) => void update({ autoCheckUpdates: v })} />
          </Row>
          <Row label={t('setCheckNow')} hint={updateLine}>
            <button type="button" className="btn btn-sm" disabled={checking} onClick={() => void checkNow()}>
              {checking && <Spinner />}
              {t('setCheckNowGo')}
            </button>
          </Row>
        </Section>

        <Section icon={<IconVolume size={16} />} title={t('setSound')}>
          <Row label={t('setSoundToggle')} hint={t('setSoundToggleHint')}>
            <Toggle
              label={t('setSoundToggle')}
              on={s.soundEnabled}
              onChange={(v) => {
                configureSound({ enabled: v, volume: s.soundVolume })
                void update({ soundEnabled: v })
              }}
            />
          </Row>
          <Row label={t('setSoundVolume')}>
            <input
              type="range"
              className="range"
              min={0}
              max={100}
              step={5}
              value={volume}
              disabled={!s.soundEnabled}
              aria-label={t('setSoundVolume')}
              style={{ ['--fill' as string]: `${volume}%` }}
              onChange={(e) => {
                const v = Number(e.target.value)
                setVolume(v)
                configureSound({ enabled: s.soundEnabled, volume: v / 100 })
              }}
              onPointerUp={() => {
                play('click')
                void update({ soundVolume: volume / 100 })
              }}
              onKeyUp={() => void update({ soundVolume: volume / 100 })}
            />
            <span className="unit num" style={{ width: 34, textAlign: 'right' }}>
              {volume}%
            </span>
          </Row>
          <div className="set-row top">
            <div className="set-text">
              <div className="set-label">{t('setSoundPreview')}</div>
            </div>
            <div className="set-control" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 520, gap: 6 }}>
              {SOUND_NAMES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ border: '1px solid var(--border)' }}
                  disabled={!s.soundEnabled}
                  data-sound="none"
                  onClick={() => play(n)}
                >
                  <IconPlay size={11} />
                  {t(SOUND_LABEL[n])}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section icon={<IconBell size={16} />} title={t('setAlerts')}>
          <Row label={t('setWarnAt')} hint={t('setWarnAtHint')}>
            <NumberBox value={s.warnAt} min={10} max={99} onCommit={(v) => void update({ warnAt: v })} />
            <span className="unit">%</span>
          </Row>
          <Row label={t('setCriticalAt')} hint={t('setCriticalAtHint')}>
            <NumberBox value={s.criticalAt} min={s.warnAt + 1} max={100} onCommit={(v) => void update({ criticalAt: v })} />
            <span className="unit">%</span>
          </Row>
          <Row label={t('setNotifyOnLimit')}>
            <Toggle label={t('setNotifyOnLimit')} on={s.notifyOnLimit} onChange={(v) => void update({ notifyOnLimit: v })} />
          </Row>
          <Row label={t('setNotifyOnThreshold')}>
            <Toggle label={t('setNotifyOnThreshold')} on={s.notifyOnThreshold} onChange={(v) => void update({ notifyOnThreshold: v })} />
          </Row>
          <Row label={t('setNotifyOnReset')}>
            <Toggle label={t('setNotifyOnReset')} on={s.notifyOnReset} onChange={(v) => void update({ notifyOnReset: v })} />
          </Row>
        </Section>

        <Section icon={<IconSwitch size={16} />} title={t('setSwitching')}>
          <Row label={t('setContinuePrompt')} hint={t('setContinuePromptHint')} top>
            <div className="set-control wide col">
              <textarea
                className="textarea"
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onBlur={() => prompt !== s.continuePrompt && void update({ continuePrompt: prompt }, true)}
              />
            </div>
          </Row>
          <Row label={t('setTerminal')}>
            <select className="select" style={{ width: 220 }} value={s.terminal} onChange={(e) => void update({ terminal: e.target.value as TerminalChoice })}>
              {terminals.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.key)}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section icon={<IconMerge size={16} />} title={t('setMerge')}>
          <Row label={t('setMergeToggle')}>
            <Toggle label={t('setMergeToggle')} on={s.autoMergeDesktop} onChange={(v) => void update({ autoMergeDesktop: v })} />
          </Row>
          <div className="set-note">
            <IconInfo size={15} />
            <span>{t('setMergeHint')}</span>
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="stat-line">
                <span className={`dot-sm ${merge.error ? 'dot-bad' : merge.lastRunAt ? 'dot-ok' : 'dot-muted'}`} />
                {merge.lastRunAt
                  ? t('setMergeLast', { when: formatAgo(merge.lastRunAt, lang, now), last: merge.lastCopied, total: merge.totalCopied })
                  : t('setMergeNever')}
              </div>
              <div className="set-hint">
                {merge.eligibleAccounts >= 2 ? t('setMergeEligible', { n: merge.eligibleAccounts }) : t('setMergeNotEnough')}
                {merge.error && <span style={{ color: 'var(--bad-ink)' }}> · {merge.error}</span>}
              </div>
            </div>
            <div className="set-control">
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy === 'merge' || merge.eligibleAccounts < 2}
                  onClick={() =>
                    act('merge', () => api.runMergeNow(), (m) => {
                      setState({ ...state, merge: m })
                      play('success')
                      toast(t('setMergeDone', { n: m.lastCopied }), 'ok')
                    })
                  }
                >
                  {busy === 'merge' && <Spinner />}
                  {t('setMergeNow')}
                </button>
                <ConfirmButton
                  className="btn btn-sm btn-ghost"
                  confirmLabel={t('setMergeUndoConfirm')}
                  onConfirm={() =>
                    void act('undo', () => api.undoMerge(), (m) => {
                      setState({ ...state, merge: m })
                      toast(t('setMergeUndone'), 'ok')
                    })
                  }
                >
                  {t('setMergeUndo')}
                </ConfirmButton>
                {merge.backupsDir && (
                  <button
                    type="button"
                    className="icon-btn bordered"
                    title={t('setMergeBackups')}
                    aria-label={t('setMergeBackups')}
                    onClick={() => void api.openPath(merge.backupsDir!)}
                  >
                    <IconFolder size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <Row
            top
            label={t('setDesktopDir')}
            hint={
              state.desktop.found && state.desktop.dataDir ? (
                <>
                  {t('setDesktopDirDetected')} <span className="set-path">{state.desktop.dataDir}</span>
                </>
              ) : (
                t('setDesktopDirNotFound')
              )
            }
          >
            <div className="set-control wide col" style={{ gap: 8 }}>
              <input
                className="input mono"
                value={dirOverride}
                placeholder={t('setDesktopDirOverride')}
                onChange={(e) => setDirOverride(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void update({ desktopDataDirOverride: dirOverride.trim() }, true)}
              />
              <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                {s.desktopDataDirOverride && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void update({ desktopDataDirOverride: '' }, true)}>
                    {t('setDesktopDirReset')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={dirOverride.trim() === (s.desktopDataDirOverride ?? '')}
                  onClick={() => void update({ desktopDataDirOverride: dirOverride.trim() }, true)}
                >
                  {t('apply')}
                </button>
              </div>
            </div>
          </Row>
        </Section>

        <Section icon={<IconPlug size={16} />} title={t('setIntegration')}>
          <Row label={t('setIntegrationHooks')} hint={t('setIntegrationHooksHint')}>
            <StatusPill on={integ.hooksInstalled} t={t} />
          </Row>
          <Row label={t('setIntegrationStatusLine')} hint={t('setIntegrationStatusLineHint')}>
            <StatusPill on={integ.statusLineInstalled} conflict={!!integ.statusLineConflict} t={t} />
          </Row>
          {integ.statusLineConflict && !integ.statusLineInstalled && (
            <div className="set-note">
              <IconInfo size={15} />
              <span>
                {t('integrationConflict')}
                <code className="conflict-cmd mono">{integ.statusLineConflict}</code>
                {t('integrationConflictAsk')}
              </span>
            </div>
          )}
          <div className="set-row">
            <div className="set-text">
              <div className="set-label">{t('setIntegrationFile')}</div>
              <div className="set-hint">
                <span className="set-path">{integ.settingsPath}</span>
              </div>
            </div>
            <div className="set-control">
              <div className="btn-row">
                {integ.statusLineConflict && !integ.statusLineInstalled ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy === 'install'}
                      onClick={() =>
                        act('install', () => api.installIntegration({ hooks: true, statusLine: false }), (r) => {
                          setIntegration(r)
                          play('success')
                          toast(t('integrationDone'), 'ok')
                        })
                      }
                    >
                      {t('integrationOnlyHooks')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy === 'install'}
                      onClick={() =>
                        act('install', () => api.installIntegration({ hooks: true, statusLine: true, replaceStatusLine: true }), (r) => {
                          setIntegration(r)
                          play('success')
                          toast(t('integrationDone'), 'ok')
                        })
                      }
                    >
                      {t('integrationReplace')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`btn btn-sm${integ.hooksInstalled && integ.statusLineInstalled ? '' : ' btn-primary'}`}
                    disabled={busy === 'install'}
                    onClick={() =>
                      act('install', () => api.installIntegration({ hooks: true, statusLine: true }), (r) => {
                        setIntegration(r)
                        play('success')
                        toast(t('integrationDone'), 'ok')
                      })
                    }
                  >
                    {busy === 'install' ? <Spinner /> : integ.hooksInstalled && integ.statusLineInstalled ? <IconCheck size={14} /> : null}
                    {integ.hooksInstalled || integ.statusLineInstalled ? t('setIntegrationReinstall') : t('setIntegrationInstall')}
                  </button>
                )}
                {(integ.hooksInstalled || integ.statusLineInstalled) && (
                  <ConfirmButton
                    className="btn btn-sm btn-ghost btn-danger"
                    confirmLabel={t('setIntegrationUninstallConfirm')}
                    onConfirm={() =>
                      void act('uninstall', () => api.uninstallIntegration(), (r) => {
                        setIntegration(r)
                        toast(t('setIntegrationRemoved'), 'ok')
                      })
                    }
                  >
                    {t('setIntegrationUninstall')}
                  </ConfirmButton>
                )}
              </div>
            </div>
          </div>
          <Row label={t('setServerPort')} hint={t('setServerPortHint')}>
            <span className={`status-pill ${integ.serverRunning ? 'on' : 'off'}`} style={{ marginRight: 6 }}>
              <span className={`dot-sm ${integ.serverRunning ? 'dot-ok' : 'dot-muted'}`} />
              {integ.serverRunning ? t('setServerRunning') : t('setServerStopped')}
            </span>
            <input
              className="input input-num"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
              onBlur={() => {
                const v = Number(port)
                if (v >= 1024 && v <= 65535 && v !== s.serverPort) void update({ serverPort: v }, true)
                else setPort(String(s.serverPort))
              }}
            />
          </Row>
        </Section>
      </div>
    </div>
  )
}

function NumberBox({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const v = Math.round(Number(text))
    if (Number.isFinite(v) && v >= min && v <= max) {
      if (v !== value) onCommit(v)
    } else setText(String(value))
  }
  return (
    <input
      className="input input-num"
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 3))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  )
}
