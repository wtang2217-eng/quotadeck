// Looks for a newer QuotaDeck release on GitHub. Nothing is downloaded or installed: the UI links to the release
// page. The request carries no user data.

const LATEST = 'https://api.github.com/repos/wtang2217-eng/quotadeck/releases/latest'

/** Compare "1.2.3" style versions (an optional leading "v"; a pre-release such as "1.2.3-beta" sorts before 1.2.3). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/i, '').split('-', 2)
    const nums = core.split('.').map((x) => Number.parseInt(x, 10) || 0)
    while (nums.length < 3) nums.push(0)
    return { nums, pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

export interface ReleaseInfo {
  version: string
  url: string
  notes?: string
  publishedAt?: number
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export async function fetchLatestRelease(appVersion: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 10_000): Promise<ReleaseInfo> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(LATEST, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `QuotaDeck/${appVersion}` },
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const j = (await res.json()) as { tag_name?: string; html_url?: string; body?: string; published_at?: string; draft?: boolean; prerelease?: boolean }
    if (!j.tag_name || j.draft) throw new Error('no published release')
    const published = j.published_at ? Date.parse(j.published_at) : NaN
    return {
      version: j.tag_name.replace(/^v/i, ''),
      url: j.html_url && /^https:\/\/github\.com\//.test(j.html_url) ? j.html_url : 'https://github.com/wtang2217-eng/quotadeck/releases/latest',
      notes: j.body ? j.body.slice(0, 2000) : undefined,
      publishedAt: Number.isFinite(published) ? published : undefined
    }
  } finally {
    clearTimeout(timer)
  }
}
