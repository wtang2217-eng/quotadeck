// SMOKE=scripts/smoke/stats.smoke.ts npm run smoke
// Builds the usage ledger from this computer's transcripts and desktop usage samples (read-only) the way the app
// does on its first start, then prints the statistics, how many requests could not be attributed to an account and
// why, and the run-out forecasts. The ledger and scan cache go to a temp folder; emails are masked.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
process.env.QUOTADECK_HOME = path.join(os.tmpdir(), 'quotadeck-stats-smoke')
fs.rmSync(process.env.QUOTADECK_HOME, { recursive: true, force: true })

const mask = (e?: string) => (e ? e.replace(/^(.{3}).*(@.*)$/, '$1***$2') : e)
const HOUR = 3_600_000

it('stats smoke', async () => {
  const { UsageScanner, attribute, estimateUsage } = await import(`${ROOT}/src/main/core/estimate`)
  const { entriesFrom, Ledger } = await import(`${ROOT}/src/main/core/ledger`)
  const { findDesktopDataDir, readUsageSamples, listAccountFolders, readSessions } = await import(`${ROOT}/src/main/core/desktop`)
  const { computeStats } = await import(`${ROOT}/src/main/core/stats`)
  const { computeEta } = await import(`${ROOT}/src/main/core/eta`)
  const { listTranscripts } = await import(`${ROOT}/src/main/core/history`)
  const { planWeight } = await import(`${ROOT}/src/main/core/plan`)

  // The real app's account list, read only.
  const state = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quotadeck', 'state.json'), 'utf8').replace(/^﻿/, ''))
  const accounts: Array<{ id: string; email?: string; nickname?: string; orgUuid?: string; usesDefaultCliDir?: boolean; plan?: { label?: string; kind?: string } }> = state.accounts
  const names = new Map(accounts.map((a) => [a.id, `${mask(a.email)} (${a.plan?.label ?? '?'})`]))
  const dataDir = findDesktopDataDir()
  const samples: Array<{ t: number; org: string; fh?: number; sd?: number }> = dataDir ? readUsageSamples(dataDir) : []
  const orgAt = (t: number) => {
    let found: string | undefined
    for (const s of samples) if (s.t <= t) found = s.org
    return found
  }
  const folders = dataDir ? listAccountFolders(dataDir) : []
  const desktopSessions = new Set<string>()
  for (const f of folders) for (const s of readSessions(f)) if (s.cliSessionId) desktopSessions.add(s.cliSessionId)
  const orgToAccount = new Map(accounts.filter((a) => a.orgUuid).map((a) => [a.orgUuid!, a.id]))
  const def = accounts.find((a) => a.usesDefaultCliDir)?.id ?? ''
  const why = new Map<string, { requests: number; usd: number }>()
  const count = (k: string, n: number, c: number) => {
    const v = why.get(k) ?? { requests: 0, usd: 0 }
    v.requests += n
    v.usd += c
    why.set(k, v)
  }
  const accountOf = (b: { s: string; e?: string; g?: string }) => {
    const known = state.sessionAccounts?.[b.s]?.accountId
    if (known) return known
    const desktop = b.e === 'd' || (b.e === undefined && desktopSessions.has(b.s))
    if (!desktop) return def
    return (b.g && orgToAccount.get(b.g)) || ''
  }
  // Same fallback as the engine: requests older than the desktop samples take the organization of the desktop
  // list the conversation was started in (a list QuotaDeck did not copy it into).
  const { normalize } = await import(`${ROOT}/src/main/core/paths`)
  const copies = new Set(Object.values((state.manifest?.entries ?? {}) as Record<string, { dest: string }>).map((e) => normalize(e.dest)))
  const original = new Map<string, string>()
  for (const f of folders) for (const s of readSessions(f)) if (s.cliSessionId && !original.has(s.cliSessionId) && !copies.has(normalize(s.file))) original.set(s.cliSessionId, f.orgUuid)
  const withOrgs = (bs: Array<{ s: string; e?: string; g?: string }>) => bs.map((b) => (b.g || b.e === 'c' || !original.has(b.s) ? b : { ...b, g: original.get(b.s) }))
  const fallback = process.env.NO_FALLBACK !== '1'
  const prep = (bs: Array<{ s: string; e?: string; g?: string }>) => (fallback ? withOrgs(bs) : bs)
  const ledger = new Ledger(path.join(process.env.QUOTADECK_HOME!, 'ledger'))
  const scanner = new UsageScanner(path.join(process.env.QUOTADECK_HOME!, 'scan.json'))
  let t = Date.now()
  await scanner.scan(Date.now(), { orgAt, deep: true, onDrop: (old: Array<{ s: string; e?: string; g?: string }>) => ledger.sync(entriesFrom(prep(old), accountOf), Date.now(), false) })
  ledger.sync(entriesFrom(prep(Object.values(scanner.buckets)), accountOf), Date.now(), true)
  console.log('original-list fallback', fallback ? 'on' : 'off', '| conversations with an original list', original.size)
  ledger.save(true)
  const files = fs.readdirSync(ledger.dir).map((f) => `${f} ${Math.round(fs.statSync(path.join(ledger.dir, f)).size / 1024)}KB`)
  console.log('first scan, whole history, ms', Date.now() - t, '| ledger rows', ledger.size, '| files', files.join(', '))

  // Attribution: every deduplicated request in the ledger, and why some have no account.
  let requests = 0
  let usd = 0
  for (const e of ledger.entries()) {
    requests += e.n
    usd += e.c
    if (e.a) continue
    if (!e.g) count('desktop request older than the desktop samples, in a conversation with no original desktop list (organization unknown)', e.n, e.c)
    else count(`desktop request under an organization that is not in the panel (${e.g.slice(0, 8)}…)`, e.n, e.c)
  }
  // The same split for the recent ranges, where the desktop samples cover everything.
  for (const days of [7, 30]) {
    let n = 0
    let u = 0
    for (const e of ledger.entries(Date.now() - days * 24 * HOUR)) {
      n += e.n
      if (!e.a) u += e.n
    }
    console.log(`last ${days} days: ${u} of ${n} requests unattributed`)
  }
  const un = [...why.values()].reduce((s, v) => s + v.requests, 0)
  const unUsd = [...why.values()].reduce((s, v) => s + v.usd, 0)
  console.log(`\nattribution: ${un} of ${requests} requests (${((un / requests) * 100).toFixed(1)}%) could not be attributed; $${unUsd.toFixed(2)} of $${usd.toFixed(2)}`)
  console.log('  denominator = every API request (message id + request id, counted once) in all local transcripts, subagents included')
  for (const [k, v] of why) console.log(`  ${v.requests} requests, $${v.usd.toFixed(2)}: ${k}`)

  const metas = new Map(listTranscripts().map((m: { cliSessionId: string }) => [m.cliSessionId, m]))
  const ctx = {
    accountId: 'all',
    now: Date.now(),
    timeZone: 'Asia/Shanghai',
    partial: false,
    note: '按 API 标价折算，仅供参考，订阅不按这个扣费',
    accountOf: (e: { a: string; g?: string }) => e.a || (e.g ? (orgToAccount.get(e.g) ?? '') : ''),
    accountLabel: (id: string) => ({ label: id ? (names.get(id) ?? id.slice(0, 8)) : '不在面板里的号' }),
    session: (id: string) => {
      const m = metas.get(id) as { title?: string; cwd?: string; projectDir?: string } | undefined
      return { title: m?.title, cwd: m?.cwd, projectDir: m?.projectDir ?? scanner.projectOf(id) }
    }
  }
  for (const range of ['today', '7d', '30d', '90d', 'all'] as const) {
    t = Date.now()
    const s = computeStats(ledger.entries(), { ...ctx, range })
    console.log(`\n== ${range} (${Date.now() - t} ms, ${s.days.length} days from ${s.days[0]?.day})`)
    console.log('totals', JSON.stringify({ usd: s.totals.costUsd, requests: s.totals.requests, conversations: s.totals.conversations, activeDays: s.totals.activeDays }), 'tokens', JSON.stringify(s.totals.tokens))
    console.log('fixed', JSON.stringify(s.fixed), 'firstDay', s.firstDay)
    console.log('models', s.models.map((m: { label: string; costUsd: number; requests: number }) => `${m.label} $${m.costUsd} ${m.requests}req`).join(' | '))
    console.log('byAccount', s.byAccount.map((a: { label: string; costUsd: number; requests: number }) => `${a.label} $${a.costUsd} ${a.requests}req`).join(' | '))
    if (range === 'today') console.log('hours', s.hours?.filter((h: { costUsd: number }) => h.costUsd > 0).map((h: { hour: number; costUsd: number }) => `${h.hour}h $${h.costUsd}`).join(' '))
  }

  // Before / after the 2026-11-03 price check: the old table priced Sonnet 5.5 cache reads at $0.20 and had no fast
  // mode, web search or US-only prices. Same ledger, same tokens, both ways.
  const { costOfTokens } = await import(`${ROOT}/src/main/core/pricing`)
  const tiers = new Map<string, number>()
  for (const e of ledger.entries()) if (e.p) tiers.set(e.p, (tiers.get(e.p) ?? 0) + e.n)
  console.log('\nrequests outside the standard tier', JSON.stringify(Object.fromEntries(tiers)), '| web searches', [...ledger.entries()].reduce((s, e) => s + (e.ws ?? 0), 0))
  // The old table already had Haiku 5.5's long-context tier; it had no fast, US-only or web search prices.
  const old = [...ledger.entries()].map((e) => ({ ...e, c: costOfTokens(e.m, (e.p ?? '').replace(/[fu]/g, ''), e, 0) + (/sonnet-5-5/.test(e.m) ? (e.r * 0.1) / 1e6 : 0) }))
  const fixedOf = (entries: Iterable<{ h: number }>, range: '7d' | 'all') => computeStats(entries as never, { ...ctx, range })
  const before7 = fixedOf(old, '7d')
  const after7 = fixedOf(ledger.entries(), '7d')
  const line = (s: { fixed: { todayUsd: number; monthUsd: number; allTimeUsd: number } }, week: number) =>
    `today $${s.fixed.todayUsd} | this month $${s.fixed.monthUsd} | all time $${s.fixed.allTimeUsd} | last 7 days $${week}`
  console.log('before:', line(before7, before7.totals.costUsd))
  console.log('after: ', line(after7, after7.totals.costUsd))

  // Run-out forecast per account, the way the engine computes it.
  const now = Date.now()
  const events = attribute(scanner.events, { samples, sessionAccounts: state.sessionAccounts ?? {}, desktopSessions, defaultCliAccountId: def, orgToAccount })
  const rates = new Map()
  const est = estimateUsage(accounts.map((a) => ({ id: a.id, orgUuid: a.orgUuid, weight: planWeight(a.plan) })), samples, events, now, rates)
  for (const a of accounts) {
    const e = est.get(a.id)
    const own = samples.filter((s) => s.org === a.orgUuid && s.t > now - 24 * HOUR)
    const recent = events.filter((x: { account?: string; t: number }) => x.account === a.id && x.t > now - 3 * HOUR)
    const last = own[own.length - 1]
    const eta = computeEta({ now, fiveHour: e?.fiveHour ?? last?.fh, sevenDay: e?.sevenDay ?? last?.sd, fiveHourResetsAt: e?.fiveHourResetsAt, points: own, rate: rates.get(a.id), events: recent })
    console.log('\naccount', names.get(a.id), '| estimate', JSON.stringify(e && { fh: e.fiveHour, sd: e.sevenDay, resets: e.fiveHourResetsAt && new Date(e.fiveHourResetsAt).toISOString() }))
    console.log('   eta', JSON.stringify(eta && { ...eta, fiveHourFullAt: eta.fiveHourFullAt && new Date(eta.fiveHourFullAt).toISOString(), sevenDayFullAt: eta.sevenDayFullAt && new Date(eta.sevenDayFullAt).toISOString() }))
  }
}, 600_000)
