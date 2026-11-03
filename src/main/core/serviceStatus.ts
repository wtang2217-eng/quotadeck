// Anthropic's official status, from the public Statuspage feed of status.claude.com. Nothing is sent but a GET.

import type { ServiceStatus } from '@shared/types'

export const STATUS_PAGE = 'https://status.claude.com'
export const STATUS_URL = `${STATUS_PAGE}/api/v2/summary.json`

const INDICATORS = new Set(['none', 'minor', 'major', 'critical'])
/** Shown first: what QuotaDeck's users depend on. */
const KEY = [/claude code/i, /claude api|api\.anthropic/i, /^claude\.ai/i]

/** The summary feed as Statuspage serves it; anything else is rejected. */
export function parseStatus(json: unknown, now = Date.now()): ServiceStatus {
  const j = json as { page?: { url?: string }; status?: { indicator?: string; description?: string }; components?: Array<{ name?: string; status?: string; group?: boolean }> }
  const indicator = j?.status?.indicator
  if (!indicator || !INDICATORS.has(indicator)) throw new Error('not a Statuspage summary')
  const rank = (name: string) => {
    const i = KEY.findIndex((re) => re.test(name))
    return i === -1 ? KEY.length : i
  }
  const components = (Array.isArray(j.components) ? j.components : [])
    .filter((c) => typeof c?.name === 'string' && typeof c.status === 'string' && !c.group)
    .map((c) => ({ name: c.name!, status: c.status! }))
    .sort((a, b) => rank(a.name) - rank(b.name))
  return {
    indicator: indicator as ServiceStatus['indicator'],
    description: typeof j.status?.description === 'string' ? j.status.description : '',
    components,
    checkedAt: now,
    url: typeof j.page?.url === 'string' && /^https:\/\/status\.claude\.com/.test(j.page.url) ? j.page.url : STATUS_PAGE
  }
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export async function fetchServiceStatus(appVersion: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 10_000): Promise<ServiceStatus> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(STATUS_URL, { headers: { Accept: 'application/json', 'User-Agent': `QuotaDeck/${appVersion}` }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`status page answered ${res.status}`)
    return parseStatus(await res.json())
  } finally {
    clearTimeout(timer)
  }
}
