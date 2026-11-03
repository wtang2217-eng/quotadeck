// First start: welcome → what this computer needs → one-click setup with live output → done.
// Shown over the app when AppState.needsSetup, and as a page from the command palette.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SetupCheck, SetupProgress, SetupStatus } from '@shared/types'
import { IconAlert, IconArrowRight, IconCheck, IconExternal, IconX } from '../components/icons'
import { Check, Spinner } from '../components/ui'
import { useApp } from '../context'
import type { TKey } from '../i18n'
import { play } from '../sound'
import { errMessage } from '../util'

type Step = 0 | 1 | 2 | 3
const STEPS: TKey[] = ['obWelcome', 'obChecks', 'obRun', 'obDone']

/** Line drawing: the eclipse as an instrument dial, three quota lines beside it. `done` adds a check in the moon. */
function Illustration({ done }: { done?: boolean }) {
  return (
    <svg className="ob-art" width="220" height="120" viewBox="0 0 220 120" aria-hidden="true">
      <defs>
        <linearGradient id="ob-corona" x1="10" y1="10" x2="110" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2DD4BF" />
          <stop offset=".45" stopColor="#60A5FA" />
          <stop offset=".75" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#F9A8D4" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="40" fill="none" stroke="url(#ob-corona)" strokeWidth="1.5" />
      <circle cx="63" cy="57.5" r="37" fill="var(--surface)" stroke="var(--line-hover)" strokeWidth="1" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
        const a = (i / 12) * Math.PI * 2
        return <line key={i} x1={63 + Math.cos(a) * 31} y1={57.5 + Math.sin(a) * 31} x2={63 + Math.cos(a) * (i % 3 ? 34 : 36)} y2={57.5 + Math.sin(a) * (i % 3 ? 34 : 36)} stroke="var(--line-hover)" strokeWidth="1" />
      })}
      {done ? (
        <path d="M50 58l9 9 17-19" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <line x1="63" y1="57.5" x2="80" y2="44" stroke="var(--text-2)" strokeWidth="1.5" strokeLinecap="round" />
      )}
      <circle cx="34" cy="30" r="2" fill="var(--text-1)" />
      {[0.72, 0.4, 0.86].map((v, i) => (
        <g key={i} transform={`translate(124 ${34 + i * 24})`}>
          <line x1="0" x2="84" y1="0" y2="0" stroke="var(--track)" strokeWidth="4" strokeLinecap="round" />
          <line x1="0" x2={84 * v} y1="0" y2="0" stroke={i === 1 ? 'var(--accent)' : 'var(--meter)'} strokeWidth="4" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  )
}

function CheckState({ c }: { c: SetupCheck }) {
  if (c.state === 'ok') return <span className="ob-state ok"><IconCheck size={14} /></span>
  if (c.state === 'fixable') return <span className="ob-state fix" />
  if (c.state === 'manual') return <span className="ob-state warn"><IconAlert size={13} /></span>
  return <span className="ob-state miss">–</span>
}

export function Onboarding({ inline, onClose }: { inline?: boolean; onClose?: () => void }) {
  const { api, t, setState, navigate, toast } = useApp()
  const [step, setStep] = useState<Step>(0)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [opts, setOpts] = useState({ installCli: true, connectIntegration: true, openAtLogin: false })
  const [running, setRunning] = useState<Record<string, SetupProgress['phase']>>({})
  const [log, setLog] = useState<string[]>([])
  const [result, setResult] = useState<boolean | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let alive = true
    api.getSetupStatus().then((s) => alive && setStatus(s)).catch(() => undefined)
    const off = api.onSetupProgress((p) => {
      if (p.step) setRunning((r) => ({ ...r, [p.step!]: p.phase }))
      if (p.message) setLog((l) => [...l.slice(-200), p.message!])
      if (p.status) setStatus(p.status)
      if (p.phase === 'done') {
        setResult(!!p.ok)
        play(p.ok ? 'success' : 'error')
        setStep(3)
      }
    })
    return () => {
      alive = false
      off()
    }
  }, [api])
  useEffect(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }), [log])

  const finish = async () => {
    setState(await api.dismissSetup())
    onClose?.()
    navigate('dashboard')
  }
  const run = async () => {
    setStep(2)
    setLog([])
    setRunning({})
    setResult(null)
    try {
      await api.runSetup(opts)
    } catch (e) {
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
      setStep(1)
    }
  }
  const checks = status?.checks ?? []
  const cliFixable = checks.some((c) => c.id === 'cli' && c.state === 'fixable')

  const body = (
    <div className={`ob${inline ? ' inline' : ''}`} role={inline ? undefined : 'dialog'} aria-modal={inline ? undefined : true} aria-label={t('setupTitle')}>
      <div className="ob-head">
        <ol className="ob-steps">
          {STEPS.map((k, i) => (
            <li key={k} className={i === step ? 'on' : i < step ? 'done' : ''}>
              <span className="ob-step-n">{i < step ? <IconCheck size={12} /> : i + 1}</span>
              {t(k)}
            </li>
          ))}
        </ol>
        {!inline && (
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={() => void finish()}>
            <IconX />
          </button>
        )}
      </div>

      <div className="ob-body">
        {step === 0 && (
          <div className="ob-hero swap-in">
            <Illustration />
            <h2 className="ob-title">{t('obWelcomeTitle')}</h2>
            <ul className="ob-points">
              {(['obPoint1', 'obPoint2', 'obPoint3'] as const).map((k) => (
                <li key={k}>
                  <IconCheck size={14} />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="swap-in">
            <p className="dialog-text">{t('setupSub')}</p>
            <div className="ob-checks">
              {checks.map((c) => (
                <div key={c.id} className="ob-check">
                  <CheckState c={c} />
                  <div style={{ minWidth: 0 }}>
                    <div className="ob-check-title">
                      {c.title}
                      {c.optional && <span className="org-hint">{t('obOptional')}</span>}
                    </div>
                    <div className="ob-check-detail">{c.detail}</div>
                  </div>
                  {c.state === 'manual' && c.url && (
                    <button type="button" className="btn btn-sm" onClick={() => void api.openExternal(c.url!)}>
                      {t('obOpen')}
                      <IconExternal size={13} />
                    </button>
                  )}
                </div>
              ))}
              {!status && <Spinner />}
            </div>
            <div className="ob-opts">
              {cliFixable && (
                <Check checked={opts.installCli} onChange={(v) => setOpts({ ...opts, installCli: v })} hint={t('obInstallCliHint')}>
                  {t('obInstallCli')}
                </Check>
              )}
              <Check checked={opts.connectIntegration} onChange={(v) => setOpts({ ...opts, connectIntegration: v })} hint={t('obConnectHint')}>
                {t('obConnect')}
              </Check>
              <Check checked={opts.openAtLogin} onChange={(v) => setOpts({ ...opts, openAtLogin: v })}>
                {t('setOpenAtLogin')}
              </Check>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="swap-in">
            <div className="ob-checks">
              {checks.map((c) => {
                const phase = running[c.id]
                return (
                  <div key={c.id} className="ob-check">
                    {phase === 'running' ? <Spinner /> : phase === 'failed' ? <span className="ob-state warn"><IconAlert size={13} /></span> : phase === 'ok' || c.state === 'ok' ? <span className="ob-state ok"><IconCheck size={14} /></span> : <span className="ob-state fix" />}
                    <div className="ob-check-title">{c.title}</div>
                  </div>
                )
              })}
            </div>
            <pre className="ob-log" ref={logRef}>
              {log.length ? log.join('\n') : t('obWaiting')}
            </pre>
          </div>
        )}

        {step === 3 && (
          <div className="ob-hero swap-in">
            <Illustration done={!!result} />
            <h2 className="ob-title">{result ? t('obDoneTitle') : t('obDonePartial')}</h2>
            <p className="dialog-text" style={{ textAlign: 'center' }}>
              {result ? t('obDoneBody') : t('obDonePartialBody')}
            </p>
          </div>
        )}
      </div>

      <div className="dialog-foot">
        {step === 0 && (
          <>
            <button type="button" className="btn btn-ghost left" onClick={() => void finish()}>
              {t('obSkip')}
            </button>
            <button type="button" className="btn btn-primary" data-autofocus onClick={() => setStep(1)}>
              {t('obStart')}
              <IconArrowRight />
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <button type="button" className="btn btn-ghost left" onClick={() => setStep(0)}>
              {t('obBack')}
            </button>
            <button type="button" className="btn btn-primary" disabled={!status || status.running} onClick={() => void run()}>
              {status?.ready ? t('setupReady') : t('setupRun')}
            </button>
          </>
        )}
        {step === 2 && (
          <span className="sec-sub left">
            <Spinner /> {t('obRunning')}
          </span>
        )}
        {step === 3 && (
          <>
            {!result && (
              <button type="button" className="btn btn-ghost left" onClick={() => setStep(1)}>
                {t('obBack')}
              </button>
            )}
            <button type="button" className="btn btn-primary" data-autofocus onClick={() => void finish()}>
              {t('obFinish')}
            </button>
          </>
        )}
      </div>
    </div>
  )

  if (inline) return <div className="page">{body}</div>
  return createPortal(<div className="backdrop">{body}</div>, document.body)
}

/** The setup page (command palette, settings): the same flow inline. */
export function Setup() {
  return <Onboarding inline />
}
