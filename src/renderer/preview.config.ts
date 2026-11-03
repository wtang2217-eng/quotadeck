// Browser-only preview of the renderer with mock data:
//   npx vite --config src/renderer/preview.config.ts
// then open http://localhost:5199/?lang=zh-CN  (other params: lang=en, theme=dark, empty=1, conflict=1, warn=1, page=settings, dialog=switch|add)

import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
      '@renderer': resolve(__dirname, 'src')
    }
  },
  server: { port: 5199, strictPort: true, host: '127.0.0.1' }
})
