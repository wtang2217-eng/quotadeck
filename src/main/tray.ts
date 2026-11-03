import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type Rectangle } from 'electron'
import { accountName, formatClock } from '@shared/format'
import type { AccountView, AppState } from '@shared/types'
import { menuBarTitle } from './core/menuBarTitle'
import { tr } from './i18n'

export interface TrayActions {
  open(): void
  /** Left click: show or hide the small popover next to the icon. */
  togglePopover(bounds: Rectangle): void
  quit(): void
  openSwitch(toAccountId?: string): void
  addAccount(): void
  continueLatest(accountId: string): void
  mergeNow(): void
}

export type TrayLook = 'idle' | 'ok' | 'warn' | 'limited'

const IS_MAC = process.platform === 'darwin'

export class TrayController {
  private tray: Tray
  private look: TrayLook | undefined
  private timer: NodeJS.Timeout | undefined
  private pending: AppState | undefined
  private menu: Menu | undefined
  private title = ''

  /** iconFor gets 'template' on macOS (one monochrome icon that follows the menu bar's color). */
  constructor(
    private readonly iconFor: (look: TrayLook | 'template') => string,
    private readonly actions: TrayActions
  ) {
    this.tray = new Tray(nativeImage.createFromPath(iconFor(IS_MAC ? 'template' : 'idle')))
    this.tray.setToolTip('QuotaDeck')
    this.tray.on('click', (_e, bounds) => actions.togglePopover(bounds))
    // macOS shows a context menu set with setContextMenu on every click, so it is opened by hand on right click.
    if (IS_MAC) this.tray.on('right-click', () => this.menu && this.tray.popUpContextMenu(this.menu))
  }

  getBounds(): Rectangle {
    return this.tray.getBounds()
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
    if (!IS_MAC && look !== this.look) {
      this.tray.setImage(nativeImage.createFromPath(this.iconFor(look)))
      this.look = look
    }
    if (IS_MAC) {
      const desktop = state.accounts.find((a) => a.isDesktopCurrent) ?? focus
      const title = menuBarTitle(state, desktop)
      if (title !== this.title) {
        this.tray.setTitle(title, { fontType: 'monospacedDigit' })
        this.title = title
      }
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
    this.menu = Menu.buildFromTemplate(items)
    if (!IS_MAC) this.tray.setContextMenu(this.menu)
  }
}
