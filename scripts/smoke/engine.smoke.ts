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
  await e.stop()
}, 120_000)
