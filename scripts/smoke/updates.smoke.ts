// SMOKE=scripts/smoke/updates.smoke.ts npm run smoke
// Asks GitHub for the latest QuotaDeck release (a public, anonymous request) and compares it with this version.
import path from 'node:path'
import { it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

it('updates smoke', async () => {
  const { compareVersions, fetchLatestRelease } = await import(`${ROOT}/src/main/core/updates`)
  const pkg = await import(`${ROOT}/package.json`)
  const t = Date.now()
  const rel = await fetchLatestRelease(pkg.version)
  console.log('ms', Date.now() - t, 'latest', rel.version, 'url', rel.url, 'published', rel.publishedAt && new Date(rel.publishedAt).toISOString())
  console.log('this version', pkg.version, 'newer available', compareVersions(rel.version, pkg.version) > 0)
}, 30_000)
