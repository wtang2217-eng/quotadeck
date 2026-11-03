import type { QuotaDeckApi } from '../shared/api'

declare global {
  interface Window {
    /** Present inside the Electron app. Absent when the renderer is opened in a plain browser (preview with mock data). */
    qd?: QuotaDeckApi
  }
}

export {}
