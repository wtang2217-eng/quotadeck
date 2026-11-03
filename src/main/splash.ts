// Launch screen: a small frameless window shown as soon as Electron is ready, while the accounts and the desktop
// data are read and the main window loads. One self-contained HTML string (inline styles and SVG, system fonts),
// so it paints at once. It stays at least MIN_SHOW_MS and fades out when the main window is ready to show.

import { BrowserWindow } from 'electron'
import type { Language } from '@shared/types'

const MIN_SHOW_MS = 700
/** The panel is 440×280; the window adds a margin for the panel's shadow. */
const MARGIN = 22
const WIDTH = 440 + MARGIN * 2
const HEIGHT = 280 + MARGIN * 2

export type SplashStep = 'accounts' | 'desktop' | 'ready'

const TEXT: Record<Language, { tagline: string } & Record<SplashStep, string>> = {
  'zh-CN': { tagline: 'Claude 多账号面板 · 只在本机运行', accounts: '正在读取账号…', desktop: '正在连接 Claude 桌面端…', ready: '准备就绪' },
  en: { tagline: 'Multi-account panel for Claude · runs locally', accounts: 'Reading your accounts…', desktop: 'Connecting to the Claude desktop app…', ready: 'Ready' }
}

const PROGRESS: Record<SplashStep, number> = { accounts: 0.34, desktop: 0.72, ready: 1 }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The eclipse: a dark moon over a thin corona ring that breathes, and the diamond-ring flare. */
function eclipseSvg(): string {
  return `<svg class="mark" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
  <defs>
    <linearGradient id="corona" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2DD4BF"/><stop offset=".42" stop-color="#60A5FA"/><stop offset=".72" stop-color="#A78BFA"/><stop offset="1" stop-color="#F9A8D4"/>
    </linearGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.2"/></filter>
  </defs>
  <circle class="glow" cx="32" cy="32" r="21" fill="none" stroke="url(#corona)" stroke-width="5" filter="url(#soft)"/>
  <circle cx="32" cy="32" r="21" fill="none" stroke="url(#corona)" stroke-width="1.4"/>
  <circle cx="33.6" cy="31" r="20.2" fill="#0C0D12"/>
  <circle class="flare" cx="16.6" cy="21.4" r="1.7" fill="#FFFFFF"/>
</svg>`
}

export function splashHtml(opts: { dark: boolean; version: string; lang: Language; step?: SplashStep }): string {
  const text = TEXT[opts.lang] ?? TEXT.en
  const step = opts.step ?? 'accounts'
  const c = opts.dark
    ? { panel: '#121215', line: 'rgba(255,255,255,0.08)', t1: '#EDEDEF', t2: '#A1A1AA', t3: '#7D7D87', track: '#232329', fill: '#C8C8CF', shadow: 'rgba(0,0,0,0.55)' }
    : { panel: '#FFFFFF', line: 'rgba(24,24,27,0.08)', t1: '#18181B', t2: '#52525B', t3: '#71717A', track: '#EEEEF1', fill: '#3F3F46', shadow: 'rgba(16,16,20,0.18)' }
  return `<!doctype html><html lang="${opts.lang}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  *{box-sizing:border-box;margin:0}
  html,body{height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;cursor:default}
  body{display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei UI','Microsoft YaHei','Noto Sans CJK SC',sans-serif;-webkit-font-smoothing:antialiased}
  .panel{position:relative;width:440px;height:280px;padding:30px 32px 26px;display:flex;flex-direction:column;background:${c.panel};border:1px solid ${c.line};border-radius:14px;box-shadow:0 1px 2px ${c.shadow},0 18px 40px -16px ${c.shadow};animation:in 220ms cubic-bezier(.2,.8,.2,1) both;transition:opacity 180ms ease-out,transform 180ms ease-out}
  .out .panel{opacity:0;transform:scale(.985)}
  @keyframes in{from{opacity:0;transform:translateY(6px)}}
  .mark{display:block}
  .glow{transform-origin:32px 32px;opacity:.6;animation:breathe 2.8s ease-in-out infinite alternate}
  .flare{animation:twinkle 2.8s ease-in-out infinite alternate}
  @keyframes breathe{from{opacity:.35;transform:scale(.97)}to{opacity:.85;transform:scale(1.03)}}
  @keyframes twinkle{from{opacity:.55}to{opacity:1}}
  .name{display:flex;align-items:baseline;gap:10px;margin-top:22px}
  .word{font-size:22px;font-weight:600;letter-spacing:-.02em;color:${c.t1}}
  .ver{font-size:12px;color:${c.t3};font-variant-numeric:tabular-nums}
  .tag{margin-top:6px;font-size:13px;color:${c.t2}}
  .foot{margin-top:auto}
  .status{font-size:12px;color:${c.t3};height:16px;transition:opacity 150ms ease-out}
  .track{position:relative;height:2px;margin-top:10px;background:${c.track};border-radius:2px;overflow:hidden}
  .bar{position:absolute;left:0;top:0;bottom:0;width:${PROGRESS[step] * 100}%;background:${c.fill};border-radius:2px;transition:width 420ms cubic-bezier(.2,.8,.2,1)}
  .bar::after{content:'';position:absolute;top:0;bottom:0;width:60px;right:0;background:linear-gradient(90deg,transparent,${c.panel});opacity:.6;animation:sheen 1.4s ease-in-out infinite}
  @keyframes sheen{0%{transform:translateX(-120px);opacity:0}50%{opacity:.6}100%{transform:translateX(20px);opacity:0}}
  @media (prefers-reduced-motion:reduce){.panel,.glow,.flare,.bar::after{animation:none}.bar{transition:none}}
  html.still .panel,html.still .glow,html.still .flare,html.still .bar::after{animation:none}
</style></head>
<body><div class="panel">
  ${eclipseSvg()}
  <div class="name"><span class="word">QuotaDeck</span><span class="ver">v${esc(opts.version)}</span></div>
  <div class="tag">${esc(text.tagline)}</div>
  <div class="foot"><div class="status" id="status">${esc(text[step])}</div><div class="track"><div class="bar" id="bar"></div></div></div>
</div>
<script>
  window.setStatus = function (text, progress) {
    document.getElementById('status').textContent = text
    document.getElementById('bar').style.width = Math.round(progress * 100) + '%'
  }
  window.fadeOut = function () { document.body.classList.add('out') }
</script></body></html>`
}

export class Splash {
  private win?: BrowserWindow
  private shownAt = 0

  constructor(private readonly opts: { version: string; lang: Language; dark: boolean; icon?: string }) {}

  show(): void {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      center: true,
      hasShadow: false,
      icon: this.opts.icon,
      backgroundColor: '#00000000',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
    })
    this.win = win
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.show()
      this.shownAt = Date.now()
    })
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(this.opts))}`)
  }

  status(step: SplashStep): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const text = (TEXT[this.opts.lang] ?? TEXT.en)[step]
    void win.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)}, ${PROGRESS[step]})`).catch(() => undefined)
  }

  /** Fade out once it has been up for MIN_SHOW_MS, then close. */
  async close(): Promise<void> {
    const win = this.win
    if (!win || win.isDestroyed()) return
    this.status('ready')
    const shown = this.shownAt || Date.now()
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - shown))
    await new Promise((r) => setTimeout(r, wait))
    if (win.isDestroyed()) return
    await win.webContents.executeJavaScript('window.fadeOut && window.fadeOut()').catch(() => undefined)
    await new Promise((r) => setTimeout(r, 200))
    if (!win.isDestroyed()) win.destroy()
    this.win = undefined
  }

  /** Close at once (quit before the main window showed). */
  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = undefined
  }
}

/** Screenshot helper: render the launch screen in a hidden window with animations stopped and return the PNG. */
export async function captureSplash(opts: { version: string; lang: Language; dark: boolean; step: SplashStep }): Promise<Buffer> {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(opts))}`)
    await win.webContents.executeJavaScript("document.documentElement.classList.add('still')")
    await new Promise((r) => setTimeout(r, 450))
    const image = await win.webContents.capturePage()
    return image.toPNG()
  } finally {
    win.destroy()
  }
}
