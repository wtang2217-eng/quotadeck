import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { accountName, formatClock } from '@shared/format'
import type { AccountView, AppState } from '@shared/types'
import { tr } from './i18n'

export interface TrayActions {
  open(): void
  quit(): void
  openSwitch(toAccountId?: string): void
  addAccount(): void
  continueLatest(accountId: string): void
  mergeNow(): void
}

type TrayLook = 'idle' | 'ok' | 'warn' | 'limited'

export class TrayController {
  private tray: Tray
  private look: TrayLook | undefined
  private timer: NodeJS.Timeout | undefined
  private pending: AppState | undefined

  constructor(
    private readonly iconFor: (look: TrayLook) => string,
    private readonly actions: TrayActions
  ) {
    this.tray = new Tray(nativeImage.createFromPath(iconFor('idle')))
    this.tray.setToolTip('QuotaDeck')
    this.tray.on('click', () => actions.open())
  }

  /** Coalesce bursts of state updates. */
  update(state: AppState): void {
    this.pending = state
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.pending) this.render(this.pending)
    }, 400)
  }

  destroy(): void {
    this.tray.destroy()
  }

  private focusAccount(state: AppState): AccountView | undefined {
    return state.accounts.find((a) => a.isDesktopCurrent) ?? [...state.accounts].sort((a, b) => (b.usage?.at ?? 0) - (a.usage?.at ?? 0))[0]
  }

  private usageText(state: AppState, a: AccountView): string {
    const lang = state.settings.language
    if (a.limit) {
      const when = a.limit.resetsAt ? formatClock(a.limit.resetsAt, state.settings.timezone, lang) : '?'
      return `${tr(lang, 'tray.limited')} · ${tr(lang, 'resetsAt', { time: when })}`
    }
    const pct = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v)}%`)
    return tr(lang, 'tray.usage', { fh: pct(a.usage?.fiveHour?.pct), sd: pct(a.usage?.sevenDay?.pct) })
  }

  private render(state: AppState): void {
    const lang = state.settings.language
    const focus = this.focusAccount(state)
    const look: TrayLook = !focus ? 'idle' : focus.status === 'limited' ? 'limited' : focus.status === 'warn' ? 'warn' : focus.status === 'ok' ? 'ok' : 'idle'
    if (look !== this.look) {
      this.tray.setImage(nativeImage.createFromPath(this.iconFor(look)))
      this.look = look
    }
    this.tray.setToolTip(focus ? `QuotaDeck\n${accountName(focus)} · ${this.usageText(state, focus)}` : 'QuotaDeck')

    const items: MenuItemConstructorOptions[] = [{ label: 'QuotaDeck', enabled: false }, { type: 'separator' }]
    if (state.accounts.length === 0) items.push({ label: tr(lang, 'tray.none'), enabled: false })
    for (const a of state.accounts) {
      const marker = a.isDesktopCurrent ? '●' : '○'
      const desk = a.isDesktopCurrent ? ` (${tr(lang, 'tray.desktop')})` : ''
      items.push({
        label: `${marker} ${accountName(a)}${a.plan ? ' · ' + a.plan.label : ''}${desk}   ${this.usageText(state, a)}`,
        click: () => this.actions.openSwitch(a.id)
      })
    }
    items.push({ type: 'separator' })
    const best = state.accounts.find((a) => a.id === state.recommendedAccountId)
    if (best) items.push({ label: tr(lang, 'tray.continue', { name: accountName(best) }), click: () => this.actions.continueLatest(best.id) })
    if (state.accounts.length > 1) items.push({ label: tr(lang, 'tray.switch'), click: () => this.actions.openSwitch(best?.id) })
    if (state.merge.eligibleAccounts > 1) items.push({ label: tr(lang, 'tray.merge'), click: () => this.actions.mergeNow() })
    items.push({ label: tr(lang, 'tray.add'), click: () => this.actions.addAccount() })
    items.push({ type: 'separator' }, { label: tr(lang, 'tray.open'), click: () => this.actions.open() }, { label: tr(lang, 'tray.quit'), click: () => this.actions.quit() })
    this.tray.setContextMenu(Menu.buildFromTemplate(items))
  }
}
