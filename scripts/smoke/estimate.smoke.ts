// npm run smoke with SMOKE=scripts/smoke/estimate.smoke.ts: scans this computer's transcripts (read-only) and checks
// how well the live estimate would have predicted each real desktop record of the last week.
import os from 'node:os'
import path from 'node:path'
import { it } from 'vitest'

it('estimate backtest', async () => {
  const { UsageScanner, attribute, backtest, estimateUsage, learnRate } = await import('../../src/main/core/estimate')
  const { findDesktopDataDir, listAccountFolders, readSessions, readUsageSamples } = await import('../../src/main/core/desktop')
  const { readJson } = await import('../../src/main/core/jsonfile')
  const { planWeight } = await import('../../src/main/core/plan')
  const state = readJson<{ accounts: Array<{ id: string; orgUuid?: string; email?: string; plan?: never; usesDefaultCliDir?: boolean }>; sessionAccounts: Record<string, { accountId: string }> }>(
    path.join(os.homedir(), '.quotadeck', 'state.json')
  )!
  const dir = findDesktopDataDir()!
  const samples = readUsageSamples(dir)
  const desktopSessions = new Set<string>()
  for (const f of listAccountFolders(dir)) for (const s of readSessions(f)) if (s.cliSessionId) desktopSessions.add(s.cliSessionId)

  const scanner = new UsageScanner(path.join(os.tmpdir(), 'quotadeck-usage-scan.json'))
  let t = Date.now()
  await scanner.scan()
  console.log('scan ms', Date.now() - t, 'events', scanner.events.length)
  t = Date.now()
  await scanner.scan()
  console.log('rescan ms', Date.now() - t)

  const orgToAccount = new Map(state.accounts.filter((a) => a.orgUuid).map((a) => [a.orgUuid!, a.id]))
  const evs = attribute(scanner.events, {
    samples,
    sessionAccounts: state.sessionAccounts ?? {},
    desktopSessions,
    defaultCliAccountId: state.accounts.find((a) => a.usesDefaultCliDir)?.id,
    orgToAccount
  })
  for (const a of state.accounts) {
    const own = samples.filter((s) => s.org === a.orgUuid)
    const mine = evs.filter((e) => e.account === a.id)
    const rate = learnRate(own, mine, Date.now())
    const bt = backtest(own, mine)
    console.log(a.email?.slice(0, 3) + '***', 'records', own.length, 'replies', mine.length, 'rate %/unit', rate.fh?.toFixed(3), 'pairs', rate.pairs, '| backtest pairs', bt.pairs, 'MAE', bt.mae.toFixed(2), 'pts, bias', bt.bias.toFixed(2))
  }
  const est = estimateUsage(
    state.accounts.map((a) => ({ id: a.id, orgUuid: a.orgUuid, weight: planWeight(a.plan) })),
    samples,
    evs
  )
  for (const a of state.accounts) {
    const last = samples.filter((s) => s.org === a.orgUuid).pop()
    const e = est.get(a.id)
    console.log(a.email?.slice(0, 3) + '***', 'last record', last && `${new Date(last.t).toISOString().slice(11, 16)}Z fh=${last.fh} sd=${last.sd}`, '→ estimate', e && JSON.stringify({ fh: e.fiveHour, sd: e.sevenDay, resets: e.fiveHourResetsAt && new Date(e.fiveHourResetsAt).toISOString().slice(11, 16) + 'Z', basis: e.basis }))
  }
}, 600_000)
