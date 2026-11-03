// SMOKE=scripts/smoke/stats.smoke.ts npm run smoke
// Reads this computer's transcripts and desktop usage samples (read-only) and prints the statistics and run-out
// forecasts QuotaDeck would show. The scan cache goes to a temp folder; emails and paths are masked.
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
  const { findDesktopDataDir, readUsageSamples, listAccountFolders, readSessions } = await import(`${ROOT}/src/main/core/desktop`)
  const { computeStats } = await import(`${ROOT}/src/main/core/stats`)
  const { computeEta } = await import(`${ROOT}/src/main/core/eta`)
  const { listTranscripts } = await import(`${ROOT}/src/main/core/history`)
  const { planWeight } = await import(`${ROOT}/src/main/core/plan`)

  // The real app's account list, read only.
  const state = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quotadeck', 'state.json'), 'utf8').replace(/^﻿/, ''))
  const accounts: Array<{ id: string; email?: string; orgUuid?: string; usesDefaultCliDir?: boolean; plan?: { label?: string; kind?: string } }> = state.accounts
  const names = new Map(accounts.map((a) => [a.id, `${mask(a.email)} (${a.plan?.label ?? '?'})`]))
  const dataDir = findDesktopDataDir()
  const samples = dataDir ? readUsageSamples(dataDir) : []
  const orgAt = (t: number) => {
    let found: string | undefined
    for (const s of samples) if (s.t <= t) found = s.org
    return found
  }
  const scanner = new UsageScanner(path.join(process.env.QUOTADECK_HOME!, 'scan.json'))
  let t = Date.now()
  await scanner.scan(Date.now(), orgAt)
  console.log('first scan (31 days) ms', Date.now() - t, 'buckets', Object.keys(scanner.buckets).length, 'events (7d)', scanner.events.length, 'complete', scanner.complete)

  const folders = dataDir ? listAccountFolders(dataDir) : []
  const desktopSessions = new Set<string>()
  for (const f of folders) for (const s of readSessions(f)) if (s.cliSessionId) desktopSessions.add(s.cliSessionId)
  const orgToAccount = new Map(accounts.filter((a) => a.orgUuid).map((a) => [a.orgUuid!, a.id]))
  const def = accounts.find((a) => a.usesDefaultCliDir)?.id ?? ''
  const accountOf = (b: { s: string; e?: string; g?: string }) => {
    const known = state.sessionAccounts?.[b.s]?.accountId
    if (known) return known
    const desktop = b.e === 'd' || (b.e === undefined && desktopSessions.has(b.s))
    return desktop ? ((b.g && orgToAccount.get(b.g)) || '') : def
  }
  const metas = new Map(listTranscripts().map((m: { cliSessionId: string }) => [m.cliSessionId, m]))
  for (const range of ['7d', '30d'] as const) {
    t = Date.now()
    const s = computeStats(Object.values(scanner.buckets), {
      range,
      now: Date.now(),
      timeZone: 'Asia/Shanghai',
      partial: false,
      accountOf,
      session: (id: string) => {
        const m = metas.get(id) as { title?: string; cwd?: string; projectDir?: string } | undefined
        return { title: m?.title, cwd: m?.cwd, projectDir: m?.projectDir ?? scanner.projectOf(id) }
      }
    })
    console.log(`\n== ${range} (computed in ${Date.now() - t} ms)`)
    console.log('totals', JSON.stringify({ ...s.totals, tokens: undefined }), 'tokens', JSON.stringify(s.totals.tokens))
    console.log('days', s.days.map((d: { day: string; units: number; costUsd: number }) => `${d.day.slice(5)} ${d.units}u $${d.costUsd}`).join(' | '))
    console.log('models', s.models.map((m: { label: string; units: number; costUsd: number; replies: number }) => `${m.label} ${m.units}u $${m.costUsd} ${m.replies}r`).join(' | '))
    console.log('projects', s.projects.slice(0, 5).map((p: { name: string; units: number; conversations: number }) => `${p.name} ${p.units}u ${p.conversations}c`).join(' | '))
    console.log('top', s.topConversations.slice(0, 3).map((c: { title: string; units: number; costUsd: number }) => `${c.title.slice(0, 16)} ${c.units}u $${c.costUsd}`).join(' | '))
    console.log('byAccount', s.byAccount.map((a: { accountId: string; units: number; costUsd: number }) => `${names.get(a.accountId) ?? (a.accountId ? 'other' : 'unattributed')} ${a.units}u $${a.costUsd}`).join(' | '))
    const peak = s.heatmap.flatMap((row: number[], wd: number) => row.map((u: number, h: number) => ({ wd, h, u }))).sort((a: { u: number }, b: { u: number }) => b.u - a.u)[0]
    console.log('busiest hour', peak)
  }

  // Run-out forecast per account, the way the engine computes it.
  const now = Date.now()
  const events = attribute(scanner.events, { samples, sessionAccounts: state.sessionAccounts ?? {}, desktopSessions, defaultCliAccountId: def, orgToAccount })
  const rates = new Map()
  const est = estimateUsage(accounts.map((a) => ({ id: a.id, orgUuid: a.orgUuid, weight: planWeight(a.plan) })), samples, events, now, rates)
  for (const a of accounts) {
    const e = est.get(a.id)
    const own = samples.filter((s: { org: string; t: number }) => s.org === a.orgUuid && s.t > now - 24 * HOUR)
    const recent = events.filter((x: { account?: string; t: number }) => x.account === a.id && x.t > now - 3 * HOUR)
    const last = own[own.length - 1]
    const eta = computeEta({
      now,
      fiveHour: e?.fiveHour ?? last?.fh,
      sevenDay: e?.sevenDay ?? last?.sd,
      fiveHourResetsAt: e?.fiveHourResetsAt,
      points: own.map((s: { t: number; fh?: number; sd?: number }) => ({ t: s.t, fh: s.fh, sd: s.sd })),
      rate: rates.get(a.id),
      events: recent
    })
    console.log('\naccount', names.get(a.id), '| estimate', JSON.stringify(e && { fh: e.fiveHour, sd: e.sevenDay, resets: e.fiveHourResetsAt && new Date(e.fiveHourResetsAt).toISOString() }))
    console.log('   rate', JSON.stringify(rates.get(a.id)), 'recent replies (3h)', recent.length, 'last record', last && `${Math.round((now - last.t) / 60000)} min ago fh=${last.fh} sd=${last.sd}`)
    console.log('   eta', JSON.stringify(eta && { ...eta, fiveHourFullAt: eta.fiveHourFullAt && new Date(eta.fiveHourFullAt).toISOString(), sevenDayFullAt: eta.sevenDayFullAt && new Date(eta.sevenDayFullAt).toISOString() }))
  }
}, 300_000)
