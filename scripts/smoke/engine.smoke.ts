// npm run smoke: runs the real Engine headless against this computer's Claude data. QuotaDeck's own state goes to a temp folder;
// Claude Code and desktop data are only read. Prints a short, masked report.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
process.env.QUOTADECK_HOME = path.join(os.tmpdir(), 'quotadeck-smoke')
fs.rmSync(process.env.QUOTADECK_HOME, { recursive: true, force: true })

const mask = (e?: string) => (e ? e.replace(/^(.{3}).*(@.*)$/, '$1***$2') : e)

it('engine smoke', async () => {
  const { Engine } = await import(`${ROOT}/src/main/core/engine`)
  const notices: unknown[] = []
  const e = new Engine({ appVersion: 'dev', locale: 'zh-CN', notify: (n: unknown) => notices.push(n), trash: async () => {}, openDesktop: async () => true })
  let t = Date.now()
  await e.start()
  console.log('start ms', Date.now() - t)
  let st = e.getState()
  console.log('cli', st.cli, '\ndesktop', { ...st.desktop, dataDir: st.desktop.dataDir?.slice(-30) }, '\ncandidate', { ...st.defaultCliCandidate, email: mask(st.defaultCliCandidate?.email) }, '\nintegration', st.integration)
  t = Date.now()
  await e.adoptDefaultCli()
  console.log('adopt ms', Date.now() - t)
  st = e.getState()
  for (const a of st.accounts) {
    console.log('account', mask(a.email), a.plan, 'status', a.status, 'desktopCurrent', a.isDesktopCurrent, 'sessions', a.desktopSessionCount, 'history', a.history.length, 'usage', JSON.stringify(a.usage), 'loggedIn', a.cliLoggedIn)
  }
  t = Date.now()
  const convs = e.listConversations({})
  console.log('conversations', convs.length, 'ms', Date.now() - t)
  for (const c of convs.slice(0, 6)) console.log('  ', c.title.slice(0, 28), '|', c.entrypoint, '|', c.cwd?.slice(-24), '| desk', c.desktopAccountIds.length, '| lines', c.lines)
  t = Date.now()
  const again = e.listConversations({ search: '账号' })
  console.log('search 账号', again.length, 'ms (cached)', Date.now() - t)
  const now = Date.now() / 1000
  console.log(
    'statusline:',
    JSON.stringify(
      e.onStatusline({
        transcript_path: path.join(os.homedir(), '.claude', 'projects', 'x', 'y.jsonl'),
        session_id: 'abc',
        rate_limits: { five_hour: { used_percentage: 86, resets_at: now + 3600 }, seven_day: { used_percentage: 66, resets_at: now + 86400 * 3 } }
      })
    )
  )
  st = e.getState()
  console.log('after statusline usage', JSON.stringify(st.accounts[0]?.usage), 'status', st.accounts[0]?.status)
  console.log('events', st.events.map((x: { type: string; title: string }) => `${x.type}: ${x.title}`))
  console.log('notices', JSON.stringify(notices))

  // v0.2: setup checklist, forecasts, statistics, conversation filters. Nothing here writes outside the temp folder.
  console.log('\nneedsSetup', st.needsSetup, 'pendingSwitch', st.pendingSwitch, 'update', st.update)
  for (const a of st.accounts) console.log('eta', mask(a.email), JSON.stringify(a.eta && { ...a.eta, fiveHourFullAt: a.eta.fiveHourFullAt && new Date(a.eta.fiveHourFullAt).toISOString() }))
  t = Date.now()
  const setup = await e.getSetupStatus()
  console.log('setup ms', Date.now() - t, 'ready', setup.ready, setup.checks.map((c: { id: string; state: string; detail: string }) => `${c.id}=${c.state} (${c.detail})`))
  t = Date.now()
  const stats = await e.getStats({ range: '7d' })
  console.log('stats 7d ms', Date.now() - t, 'partial', stats.partial, 'totals', JSON.stringify({ usd: stats.totals.costUsd, requests: stats.totals.requests, conversations: stats.totals.conversations }), 'fixed', JSON.stringify(stats.fixed))
  const everything = await e.getStats({ range: 'all' })
  console.log(
    'rows (all)',
    everything.byAccount.map((a: { kind: string; label: string; email?: string; costUsd: number; requests: number }) => `${a.kind}:${a.kind === 'account' ? mask(a.email) : a.label} $${a.costUsd} ${a.requests}req`),
    '| total',
    everything.totals.costUsd,
    'requests',
    everything.totals.requests
  )
  // Background requests booked from cost-state: today / this month / all time with and without them.
  const { zonedClock } = await import(`${ROOT}/src/main/core/stats`)
  const clock = zonedClock('Asia/Shanghai')
  const today = clock(Date.now())
  const sums = { today: [0, 0], month: [0, 0], all: [0, 0] }
  for (const x of (e as unknown as { ledger: { entries(): Iterable<{ h: number; c: number; k?: string }> } }).ledger.entries()) {
    const day = clock(x.h)
    const slot = x.k === 'b' ? 1 : 0
    sums.all[slot] += x.c
    if (day.month === today.month) sums.month[slot] += x.c
    if (day.day === today.day) sums.today[slot] += x.c
  }
  for (const [k, [req, bg]] of Object.entries(sums)) console.log(`${k}: transcript only $${req.toFixed(2)} → with background $${(req + bg).toFixed(2)} (background $${bg.toFixed(2)})`)
  console.log('background line (all):', JSON.stringify(everything.totals.background))
  const month = await e.getStats({ range: '30d' })
  console.log('cache (30d):', JSON.stringify({ hit: month.totals.cacheHitRate, saved: month.totals.cacheSavingsUsd, noCache: month.totals.noCacheUsd, actual: month.totals.costUsd }))
  console.log('subscription:', JSON.stringify(month.subscription))
  console.log('service status:', JSON.stringify(e.getState().serviceStatus && { ...e.getState().serviceStatus, components: e.getState().serviceStatus.components.slice(0, 3) }))
  const csv = await e.ledgerCsv({ range: '30d', accountId: 'all' })
  console.log('csv rows (30d, day × account × model)', csv.csv.trimEnd().split('\r\n').length - 1, 'file', csv.fileName)
  t = Date.now()
  const again2 = await e.getStats({ range: '7d' })
  console.log('stats cached ms', Date.now() - t, again2 === stats)
  const mainId = st.accounts[0]?.id
  const mine = e.listConversations({ accountId: mainId })
  const desk = e.listConversations({ entrypoint: 'desktop' })
  const term = e.listConversations({ entrypoint: 'terminal' })
  const all = e.listConversations({})
  console.log('conversations all', all.length, '| main account', mine.length, '| desktop', desk.length, '| terminal', term.length, '| with desktop id', all.filter((c: { desktopSessionId?: string }) => c.desktopSessionId).length)
  const projects = e.listProjects()
  console.log('projects', projects.length, projects.slice(0, 4).map((p: { name: string; conversations: number }) => `${p.name}:${p.conversations}`))
  const byCwd = projects[0]?.cwd ? e.listConversations({ cwd: projects[0].cwd }) : []
  console.log('filter by first project', byCwd.length, '(expected', projects[0]?.conversations, ')')
  const withId = all.find((c: { desktopSessionId?: string }) => c.desktopSessionId)
  console.log('desktop link (not opened)', withId && e.desktopLinkFor({ cliSessionId: withId.cliSessionId })?.replace(/session=local_.{8}/, 'session=local_********'))
  e.setFavorite(all[0].cliSessionId, true)
  console.log('favorites only', e.listConversations({ favoritesOnly: true }).length)
  t = Date.now()
  const md = await e.exportMarkdown(all[1]?.cliSessionId ?? all[0].cliSessionId)
  console.log('export ms', Date.now() - t, 'chars', md?.markdown.length, 'file name ok', !!md && !/[\\/:*?"<>|]/.test(md.fileName))
  await e.stop()
}, 120_000)
