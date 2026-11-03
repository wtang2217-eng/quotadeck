// About: version and updates, what the tool does and does not do, the open-source parts it is built from, links.

import { useState } from 'react'
import { IconExternal, IconGithub, IconUpdate } from '../components/icons'
import { Logo } from '../components/icons'
import { Spinner } from '../components/ui'
import { useApp } from '../context'
import type { TKey } from '../i18n'
import { errMessage } from '../util'

const REPO = 'https://github.com/wtang2217-eng/quotadeck'

/** Open-source parts that ship inside the app. */
const LICENSES: { name: string; license: string; url: string }[] = [
  { name: 'Electron', license: 'MIT', url: 'https://github.com/electron/electron' },
  { name: 'React', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'Inter', license: 'OFL-1.1', url: 'https://github.com/rsms/inter' },
  { name: 'Lucide', license: 'ISC', url: 'https://github.com/lucide-icons/lucide' },
  { name: 'Radix Colors', license: 'MIT', url: 'https://github.com/radix-ui/colors' },
  { name: 'Fontsource', license: 'MIT', url: 'https://github.com/fontsource/fontsource' },
  { name: 'earshot', license: 'MIT', url: 'https://github.com/Leonxlnx/earshot' },
  { name: 'Vite · electron-vite', license: 'MIT', url: 'https://github.com/vitejs/vite' }
]

const RULES: [TKey, TKey][] = [
  ['aboutC1Title', 'aboutC1Body'],
  ['aboutC2Title', 'aboutC2Body'],
  ['aboutC3Title', 'aboutC3Body'],
  ['aboutC4Title', 'aboutC4Body'],
  ['aboutC5Title', 'aboutC5Body'],
  ['aboutC6Title', 'aboutC6Body'],
  ['aboutC7Title', 'aboutC7Body']
]

export function About() {
  const { state, t, api, setState, toast } = useApp()
  const [checking, setChecking] = useState(false)
  const info = state.update
  const check = async () => {
    setChecking(true)
    try {
      const res = await api.checkForUpdates()
      toast(res.available ? t('setUpdateAvailable', { v: res.latest ?? '' }) : t('setUpdateUpToDate'), 'ok')
      setState(await api.getState())
    } catch (e) {
      toast(t('errGeneric', { msg: errMessage(e) }), 'bad')
    } finally {
      setChecking(false)
    }
  }
  const link = (url: string) => () => void api.openExternal(url)

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{t('aboutTitle')}</h1>
          <p className="page-sub">{t('aboutSubtitle')}</p>
        </div>
      </header>

      <div className="about-id">
        <Logo size={44} />
        <div style={{ minWidth: 0 }}>
          <div className="about-name">QuotaDeck</div>
          <div className="about-meta">
            {t('aboutVersion', { v: state.appVersion })} · {t('aboutLicense')} · {t('aboutUnofficial')}
          </div>
        </div>
        <div className="page-actions">
          {info?.available && info.url ? (
            <button type="button" className="btn btn-primary" onClick={link(info.url)}>
              <IconUpdate />
              {t('aboutDownload', { v: info.latest ?? '' })}
            </button>
          ) : (
            <button type="button" className="btn" disabled={checking} onClick={() => void check()}>
              {checking ? <Spinner /> : <IconUpdate />}
              {t('setCheckNowGo')}
            </button>
          )}
          <button type="button" className="btn" onClick={link(REPO)}>
            <IconGithub />
            {t('aboutRepo')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={link(`${REPO}/issues/new`)}>
            {t('aboutFeedback')}
          </button>
        </div>
      </div>

      <section className="sec">
        <div className="sec-head">
          <h2 className="sec-title">{t('aboutComplianceTitle')}</h2>
        </div>
        <div className="list-rows">
          {RULES.map(([title, body]) => (
            <div key={title} className="about-rule">
              <div className="about-rule-title">{t(title)}</div>
              <div className="about-rule-body">{t(body)}</div>
            </div>
          ))}
          <div className="about-rule">
            <div className="about-rule-title">{t('aboutGreyTitle')}</div>
            <div className="about-rule-body">
              {t('aboutGreyBody')}
              <span className="about-links">
                <button type="button" className="linkish" onClick={link('https://code.claude.com/docs/en/legal-and-compliance')}>
                  {t('aboutLinkLegal')}
                  <IconExternal size={13} />
                </button>
                <button type="button" className="linkish" onClick={link('https://www.anthropic.com/legal/aup')}>
                  {t('aboutLinkAup')}
                  <IconExternal size={13} />
                </button>
              </span>
            </div>
          </div>
          <div className="about-rule">
            <div className="about-rule-title">{t('aboutPrivacyTitle')}</div>
            <div className="about-rule-body">{t('aboutPrivacyBody')}</div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2 className="sec-title">{t('aboutLicenses')}</h2>
          <span className="sec-sub">{t('aboutLicensesSub')}</span>
        </div>
        <div className="dt" style={{ ['--cols' as string]: 'minmax(160px, 1fr) 120px 40px' }}>
          {LICENSES.map((l) => (
            <div key={l.name} className="dt-row" style={{ minHeight: 40 }}>
              <span className="dt-name">{l.name}</span>
              <span className="dt-text">{l.license}</span>
              <button type="button" className="icon-btn" aria-label={l.url} title={l.url} onClick={link(l.url)}>
                <IconExternal size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
