import { describe, expect, it } from 'vitest'
import { compareVersions, fetchLatestRelease } from '../src/main/core/updates'

describe('compareVersions', () => {
  it('orders versions numerically, with or without a leading v', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('v0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1)
    // A pre-release comes before its release.
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.2.0-beta.1')).toBe(1)
  })
})

describe('fetchLatestRelease', () => {
  it('reads the tag, page and notes of the latest release', async () => {
    let asked = ''
    const r = await fetchLatestRelease('0.1.0', async (url, init) => {
      asked = `${url} ${init.headers['User-Agent']}`
      return { ok: true, status: 200, json: async () => ({ tag_name: 'v0.2.0', html_url: 'https://github.com/wtang2217-eng/quotadeck/releases/tag/v0.2.0', body: 'notes', published_at: '2026-11-04T00:00:00Z' }) }
    })
    expect(asked).toBe('https://api.github.com/repos/wtang2217-eng/quotadeck/releases/latest QuotaDeck/0.1.0')
    expect(r).toEqual({ version: '0.2.0', url: 'https://github.com/wtang2217-eng/quotadeck/releases/tag/v0.2.0', notes: 'notes', publishedAt: Date.UTC(2026, 10, 4) })
  })

  it('fails on an error answer and never trusts a link outside GitHub', async () => {
    await expect(fetchLatestRelease('0.1.0', async () => ({ ok: false, status: 403, json: async () => ({}) }))).rejects.toThrow('403')
    const r = await fetchLatestRelease('0.1.0', async () => ({ ok: true, status: 200, json: async () => ({ tag_name: '0.3.0', html_url: 'https://evil.example/x' }) }))
    expect(r.url).toBe('https://github.com/wtang2217-eng/quotadeck/releases/latest')
  })
})
