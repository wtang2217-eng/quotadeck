import type { ReactNode } from 'react'
import {
  IconAlert,
  IconBan,
  IconEye,
  IconExternal,
  IconGithub,
  IconHand,
  IconHome,
  IconLock,
  IconMerge,
  IconPulse,
  IconTerminal,
  Logo
} from '../components/icons'
import { useApp } from '../context'
import type { TKey } from '../i18n'

const REPO = 'https://github.com/wtang2217-eng/quotadeck'
const LEGAL = 'https://code.claude.com/docs/en/legal-and-compliance'
const AUP = 'https://www.anthropic.com/legal/aup'

const RULES: { icon: ReactNode; tone: string; title: TKey; body: TKey }[] = [
  { icon: <IconHome size={16} />, tone: 'ok', title: 'aboutC1Title', body: 'aboutC1Body' },
  { icon: <IconBan size={16} />, tone: 'bad', title: 'aboutC2Title', body: 'aboutC2Body' },
  { icon: <IconLock size={16} />, tone: 'accent', title: 'aboutC3Title', body: 'aboutC3Body' },
  { icon: <IconPulse size={16} />, tone: 'info', title: 'aboutC4Title', body: 'aboutC4Body' },
  { icon: <IconHand size={16} />, tone: 'ok', title: 'aboutC5Title', body: 'aboutC5Body' },
  { icon: <IconTerminal size={16} />, tone: 'accent', title: 'aboutC7Title', body: 'aboutC7Body' },
  { icon: <IconMerge size={16} />, tone: 'warn', title: 'aboutC6Title', body: 'aboutC6Body' },
  { icon: <IconEye size={16} />, tone: 'muted', title: 'aboutPrivacyTitle', body: 'aboutPrivacyBody' }
]

export function About() {
  const { state, t, api } = useApp()
  const open = (url: string) => void api.openExternal(url)
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('aboutTitle')}</h1>
          <div className="page-sub">{t('aboutSubtitle')}</div>
        </div>
      </header>

      <section className="card about-hero">
        <Logo size={54} />
        <div style={{ minWidth: 0 }}>
          <div className="about-name">QuotaDeck</div>
          <div className="about-meta">
            <span className="badge badge-outline">{t('aboutVersion', { v: state.appVersion })}</span>
            <span className="badge badge-accent">{t('aboutLicense')}</span>
            <span>{t('aboutUnofficial')}</span>
          </div>
        </div>
        <div className="links">
          <button type="button" className="btn" onClick={() => open(REPO)}>
            <IconGithub size={16} />
            {t('aboutRepo')}
          </button>
        </div>
      </section>

      <h3 className="section-title">{t('aboutComplianceTitle')}</h3>
      <div className="rules">
        {RULES.map((r, i) => (
          <div className="card rule" key={r.title} style={{ animationDelay: `${i * 35}ms` }}>
            <div className={`rule-icon tone-${r.tone}`}>{r.icon}</div>
            <div>
              <div className="rule-title">{t(r.title)}</div>
              <div className="rule-body">{t(r.body)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grey">
        <div className="rule-icon" style={{ background: 'var(--warn)', color: '#fff' }}>
          <IconAlert size={16} />
        </div>
        <div>
          <div className="rule-title">{t('aboutGreyTitle')}</div>
          <div className="rule-body">{t('aboutGreyBody')}</div>
          <div className="links">
            <button type="button" className="btn btn-sm" onClick={() => open(LEGAL)}>
              {t('aboutLinkLegal')}
              <IconExternal size={14} />
            </button>
            <button type="button" className="btn btn-sm" onClick={() => open(AUP)}>
              {t('aboutLinkAup')}
              <IconExternal size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
