import { createContext, useContext } from 'react'
import type { QuotaDeckApi } from '@shared/api'
import type { AppState, Language, Page } from '@shared/types'
import type { T } from './i18n'

export type SwitchMode = 'both' | 'terminal' | 'desktop'

export type DialogState =
  | { type: 'add'; reLoginAccountId?: string }
  | {
      type: 'switch'
      mode: SwitchMode
      fromAccountId?: string
      toAccountId?: string
      cliSessionId?: string
      cwd?: string
      title?: string
    }
  | { type: 'edit'; accountId: string }
  | { type: 'remove'; accountId: string }

export type ToastKind = 'ok' | 'bad' | 'info'

export interface AppCtx {
  api: QuotaDeckApi
  state: AppState
  setState: (s: AppState) => void
  t: T
  lang: Language
  tz: string
  /** Ticks every 30 s so countdowns stay fresh. */
  now: number
  page: Page
  navigate: (p: Page) => void
  /** Whose numbers the app shows: "all" or one account id. Follows the sidebar's scope switcher. */
  scope: string
  setScope: (scope: string) => void
  /** Open the command palette. */
  openPalette: () => void
  openDialog: (d: DialogState) => void
  closeDialog: () => void
  toast: (message: string, kind?: ToastKind) => void
}

export const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}
