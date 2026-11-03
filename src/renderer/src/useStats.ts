// Usage statistics for a page, cached per query so moving between pages shows numbers at once. Refreshed every minute.

import { useEffect, useState } from 'react'
import type { QuotaDeckApi } from '@shared/api'
import type { StatsQuery, UsageStats } from '@shared/types'

const cache = new Map<string, UsageStats>()
const keyOf = (q: StatsQuery) => `${q.range}|${q.accountId ?? '*'}`

export function useStats(api: QuotaDeckApi, query: StatsQuery | null): UsageStats | undefined {
  const key = query ? keyOf(query) : ''
  const [data, setData] = useState<UsageStats | undefined>(() => (query ? cache.get(key) : undefined))
  useEffect(() => {
    if (!query) return
    let alive = true
    setData(cache.get(key))
    const load = () =>
      api
        .getStats(query)
        .then((s) => {
          cache.set(key, s)
          if (alive) setData(s)
        })
        .catch(() => undefined)
    void load()
    const id = window.setInterval(load, 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [api, key])
  return data
}

/** The same range for several accounts at once (one query each), keyed by account id. */
export function useStatsFor(api: QuotaDeckApi, range: StatsQuery['range'], ids: string[]): Record<string, UsageStats> {
  const joined = ids.join(',')
  const [data, setData] = useState<Record<string, UsageStats>>({})
  useEffect(() => {
    let alive = true
    const load = () =>
      Promise.all(
        ids.map((id) =>
          api
            .getStats({ range, accountId: id })
            .then((s) => {
              cache.set(keyOf({ range, accountId: id }), s)
              return [id, s] as const
            })
            .catch(() => undefined)
        )
      ).then((list) => {
        if (!alive) return
        const next: Record<string, UsageStats> = {}
        for (const item of list) if (item) next[item[0]] = item[1]
        setData(next)
      })
    const seeded: Record<string, UsageStats> = {}
    for (const id of ids) {
      const hit = cache.get(keyOf({ range, accountId: id }))
      if (hit) seeded[id] = hit
    }
    setData(seeded)
    void load()
    const t = window.setInterval(load, 60_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [api, range, joined])
  return data
}
