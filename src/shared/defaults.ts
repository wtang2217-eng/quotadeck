import type { Language, Settings } from './types'

export const DEFAULT_PORT = 41117

/** Text sent after resuming a conversation with another account, when the user ticks "continue automatically". */
export const DEFAULT_CONTINUE_PROMPT: Record<Language, string> = {
  'zh-CN': '刚才因为额度用完中断了，请从中断的地方继续。',
  en: 'We were interrupted by a usage limit. Please continue from where you left off.'
}

/**
 * Chinese-language users often keep their computer on a US time zone (to match a proxy) while living on
 * UTC+8. For them Beijing time is the better default; everyone else gets the system zone.
 */
function defaultTimeZone(language: Language): string {
  const offsetHours = -new Date().getTimezoneOffset() / 60
  return language === 'zh-CN' && (offsetHours < 7 || offsetHours > 9) ? 'Asia/Shanghai' : 'system'
}

export function defaultSettings(systemLocale = 'en'): Settings {
  const language: Language = systemLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  return {
    language,
    theme: 'system',
    timezone: defaultTimeZone(language),
    warnAt: 80,
    criticalAt: 95,
    notifyOnLimit: true,
    notifyOnThreshold: true,
    notifyOnReset: true,
    autoMergeDesktop: true,
    continuePrompt: DEFAULT_CONTINUE_PROMPT[language],
    openAtLogin: false,
    startHidden: false,
    serverPort: DEFAULT_PORT,
    terminal: 'auto',
    acceptedOwnershipNotice: false,
    soundEnabled: true,
    soundVolume: 0.5,
    uiStyle: 'swiss',
    accent: 'ikb',
    trayShowPercent: true,
    autoCheckUpdates: true
  }
}
