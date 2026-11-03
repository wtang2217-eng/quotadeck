import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: { include: [process.env.SMOKE ?? 'scripts/smoke/engine.smoke.ts'], environment: 'node', testTimeout: 120_000 }
})
