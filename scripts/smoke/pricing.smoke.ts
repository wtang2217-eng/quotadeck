// SMOKE=scripts/smoke/pricing.smoke.ts npm run smoke
// Checks QuotaDeck's prices against Claude Code's own bookkeeping. Every transcript that holds a "cost-state" record
// (Claude Code's running total for one run of a conversation, with costUSD per model) is one segment: the requests
// QuotaDeck reads from that transcript and its subagents since the run started are priced and compared with the last
// cost-state record. Read-only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

interface ModelUse {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests?: number
  costUSD: number
}

interface Ours {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  webSearches: number
  usd: number
  /** Same, with Sonnet 5.5 cache reads at the $0.20 Claude Code still uses. */
  usdCcBasis: number
  requests: number
}

const cents = (x: number) => Math.round(x * 100)

it('pricing smoke', async () => {
  const { costOf, tokensOf, webSearchesOf, PRICE_LIST_DATE } = await import(`${ROOT}/src/main/core/pricing`)
  const projects = path.join(process.env.QUOTADECK_CLAUDE_DIR || path.join(os.homedir(), '.claude'), 'projects')
  const mains: string[] = []
  for (const proj of fs.readdirSync(projects)) {
    const dir = path.join(projects, proj)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.jsonl')) mains.push(path.join(dir, name))
  }

  const segments: Array<{ id: string; key: string; start: number; resumed: boolean; cc: Record<string, ModelUse>; ccTotal: number; ours: Record<string, Ours>; ourAll: number }> = []
  for (const file of mains) {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.includes('"type":"cost-state"')) continue
    let last: { startTime: number; totalCostUSD: number; modelUsage: Record<string, ModelUse> } | undefined
    for (const line of text.split('\n')) {
      if (!line.includes('"type":"cost-state"')) continue
      try {
        const j = JSON.parse(line)
        if (!last || j.totalCostUSD >= last.totalCostUSD) last = j
      } catch {
        /* cut-off line */
      }
    }
    if (!last) continue
    const session = path.basename(file, '.jsonl')
    const subDir = path.join(path.dirname(file), session, 'subagents')
    const files = [file, ...(fs.existsSync(subDir) ? fs.readdirSync(subDir).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(subDir, n)) : [])]
    const ours: Record<string, Ours> = {}
    const seen = new Set<string>()
    let resumed = false
    let ourAll = 0
    for (const f of files) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line.includes('"usage"') || !line.includes('"type":"assistant"')) continue
        let j: { timestamp?: string; requestId?: string; message?: { id?: string; model?: string; usage?: Record<string, unknown> } }
        try {
          j = JSON.parse(line)
        } catch {
          continue
        }
        const m = j.message?.model
        const u = j.message?.usage
        const t = Date.parse(j.timestamp ?? '')
        if (!m || !u || m === '<synthetic>' || !Number.isFinite(t)) continue
        const key = `${j.message!.id}:${j.requestId}`
        if (seen.has(key)) continue
        seen.add(key)
        const usd = costOf(u, m)
        ourAll += usd
        if (t < last.startTime) {
          resumed = true
          continue
        }
        const tok = tokensOf(u)
        const o = (ours[m] ??= { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, webSearches: 0, usd: 0, usdCcBasis: 0, requests: 0 })
        o.input += tok.input
        o.output += tok.output
        o.cacheRead += tok.cacheRead
        o.cacheCreation += tok.write5m + tok.write1h
        o.webSearches += webSearchesOf(u)
        o.usd += usd
        o.usdCcBasis += usd + (/sonnet-5-5/.test(m) ? (tok.cacheRead * 0.1) / 1e6 : 0)
        o.requests++
      }
    }
    segments.push({ id: session.slice(0, 8), key: `${(last as { sessionId?: string }).sessionId ?? session}@${last.startTime}`, start: last.startTime, resumed, cc: last.modelUsage ?? {}, ccTotal: last.totalCostUSD, ours, ourAll })
  }

  // Judge each model of each segment on its own, then sum up.
  let cacheMatch = 0
  let exact = 0
  let ccTotal = 0
  let ourTotal = 0
  let ourCcBasis = 0
  const pairs = { total: 0, sameTokens: 0, sameTokensExact: 0, sonnetOldPrice: 0, ccMore: 0, oursMore: 0 }
  const reasons = { sonnetOldPrice: new Set<string>(), background: new Set<string>(), webSearch: new Set<string>(), resumedOff: new Set<string>(), notFinal: new Set<string>() }
  let backgroundUsd = 0
  let sonnetUsd = 0
  for (const s of segments) {
    const models = new Set([...Object.keys(s.cc), ...Object.keys(s.ours)])
    const our = Object.values(s.ours).reduce((x, o) => x + o.usd, 0)
    ccTotal += s.ccTotal
    ourTotal += our
    ourCcBasis += Object.values(s.ours).reduce((x, o) => x + o.usdCcBasis, 0)
    if ([...models].every((m) => (s.cc[m]?.cacheReadInputTokens ?? 0) === (s.ours[m]?.cacheRead ?? 0))) {
      cacheMatch++
      if (cents(our) === cents(s.ccTotal)) exact++
    }
    for (const m of models) {
      const c = s.cc[m]
      const o = s.ours[m]
      if (!c && o && o.requests === 0) continue
      pairs.total++
      const cT = c ? [c.inputTokens, c.outputTokens, c.cacheReadInputTokens, c.cacheCreationInputTokens] : [0, 0, 0, 0]
      const oT = o ? [o.input, o.output, o.cacheRead, o.cacheCreation] : [0, 0, 0, 0]
      const cSum = cT.reduce((a, b) => a + b, 0)
      const oSum = oT.reduce((a, b) => a + b, 0)
      if (cT.every((v, i) => v === oT[i]) && (c?.webSearchRequests ?? 0) === (o?.webSearches ?? 0)) {
        pairs.sameTokens++
        if (cents(o?.usd ?? 0) === cents(c?.costUSD ?? 0)) pairs.sameTokensExact++
        else if (cents(o?.usdCcBasis ?? 0) === cents(c?.costUSD ?? 0)) {
          pairs.sonnetOldPrice++
          reasons.sonnetOldPrice.add(s.id)
          sonnetUsd += (c?.costUSD ?? 0) - (o?.usd ?? 0)
        }
      } else if (cSum >= oSum && (c?.webSearchRequests ?? 0) >= (o?.webSearches ?? 0)) {
        pairs.ccMore++
        reasons.background.add(s.id)
        if ((c?.webSearchRequests ?? 0) > (o?.webSearches ?? 0)) reasons.webSearch.add(s.id)
        backgroundUsd += (c?.costUSD ?? 0) - (o?.usdCcBasis ?? 0)
      } else {
        pairs.oursMore++
        if (s.resumed) reasons.resumedOff.add(s.id)
        else reasons.notFinal.add(s.id)
      }
    }
  }
  const resumed = segments.filter((s) => s.resumed)

  console.log(`price list ${PRICE_LIST_DATE}`)
  console.log(`segments: ${segments.length} — every main transcript under ~/.claude/projects with a cost-state record (one run each; the last record of the run is compared)`)
  console.log(`cache reads equal for every model: ${cacheMatch} of ${segments.length} segments; of those, total dollars equal to the cent: ${exact} of ${cacheMatch}`)
  console.log(`model rows: ${pairs.total} (one per model per segment, from either side)`)
  console.log(`  ${pairs.sameTokens} of ${pairs.total}: every token count identical; of those ${pairs.sameTokensExact} equal to the cent, ${pairs.sonnetOldPrice} equal only with Sonnet 5.5 cache reads at $0.20`)
  console.log(`  ${pairs.ccMore} of ${pairs.total}: Claude Code counted more tokens than the transcript holds (requests that never reach the transcript)`)
  console.log(`  ${pairs.oursMore} of ${pairs.total}: the transcript holds more than the last cost-state`)
  console.log('causes (a segment can have several; denominator = the 121 segments):')
  console.log(`  ${reasons.sonnetOldPrice.size}: Sonnet 5.5 old cache-read price in Claude Code — $${sonnetUsd.toFixed(2)} of the difference`)
  console.log(`  ${reasons.background.size}: background requests Claude Code counted that are not in the transcript (compaction, titles, …), ${reasons.webSearch.size} of them with web searches by Haiku — $${backgroundUsd.toFixed(2)}`)
  console.log(`  ${resumed.length}: resumed conversations (requests before the run's start, left out of the comparison); ${reasons.resumedOff.size} of them still differ`)
  console.log(`  ${reasons.notFinal.size}: not resumed, and the transcript has requests after the last cost-state was written`)
  console.log(`dollars over all segments: Claude Code $${ccTotal.toFixed(2)} | QuotaDeck $${ourTotal.toFixed(2)} | QuotaDeck with Sonnet 5.5 cache reads at $0.20: $${ourCcBasis.toFixed(2)}`)
  console.log(
    `resumed conversations, whole transcript vs last cost-state: QuotaDeck $${resumed.reduce((x, s) => x + s.ourAll, 0).toFixed(2)} vs Claude Code $${resumed.reduce((x, s) => x + s.ccTotal, 0).toFixed(2)} (the cost-state leaves out earlier runs)`
  )
  console.log(`examples: Sonnet 5.5 ${[...reasons.sonnetOldPrice].slice(0, 4).join(', ')} | background ${[...reasons.background].slice(0, 4).join(', ')} | not final ${[...reasons.notFinal].slice(0, 3).join(', ')}`)

  // With the background requests booked the way the app does it (cost-state minus transcript, per run).
  const { UsageScanner } = await import(`${ROOT}/src/main/core/estimate`)
  const { costOfTokens } = await import(`${ROOT}/src/main/core/pricing`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-pricing-'))
  const scanner = new UsageScanner(path.join(tmp, 'scan.json'))
  type Bg = { key: string; negatives: number; models: Record<string, { i: number; o: number; r: number; w5: number; w1: number; ws: number }> }
  const runs: Bg[] = []
  // Runs older than the scanner's month are handed over before it forgets them, as the app books them.
  await scanner.scan(Date.now(), { deep: true, onDropBackground: (old: Bg[]) => runs.push(...old) })
  runs.push(...(scanner.backgroundRuns as Bg[]))
  const bgByKey = new Map<string, { usd: number; usdCc: number; negatives: number }>()
  for (const bg of runs) {
    let usd = 0
    let usdCc = 0
    for (const [m, t] of Object.entries(bg.models)) {
      const c = costOfTokens(m, '', t, t.ws)
      usd += c
      usdCc += c + (/sonnet-5-5/.test(m) ? (t.r * 0.1) / 1e6 : 0)
    }
    bgByKey.set(bg.key, { usd, usdCc, negatives: bg.negatives })
  }
  let withBg = 0
  let withBgCc = 0
  let matched = 0
  let exactAfter = 0
  let negSegments = 0
  let overshoot = 0
  for (const s of segments) {
    const bg = bgByKey.get(s.key)
    const our = Object.values(s.ours).reduce((x, o) => x + o.usd, 0) + (bg?.usd ?? 0)
    const ourCc = Object.values(s.ours).reduce((x, o) => x + o.usdCcBasis, 0) + (bg?.usdCc ?? 0)
    withBg += our
    withBgCc += ourCc
    if (bg) matched++
    if (cents(ourCc) === cents(s.ccTotal)) exactAfter++
    if (bg?.negatives) {
      negSegments++
      overshoot += Math.max(0, ourCc - s.ccTotal)
    }
  }
  console.log(`\nwith background requests booked (${bgByKey.size} runs in the scanner, ${matched} of ${segments.length} segments joined):`)
  console.log(`  Claude Code $${ccTotal.toFixed(2)} | QuotaDeck $${withBg.toFixed(2)} (price page) | QuotaDeck at Claude Code's Sonnet 5.5 price $${withBgCc.toFixed(2)}`)
  console.log(`  segments equal to the cent at Claude Code's prices: ${exactAfter} of ${segments.length}`)
  console.log(`  segments with a negative difference (the transcript held more than the last record): ${negSegments}, QuotaDeck above Claude Code there by $${overshoot.toFixed(2)}`)
  console.log(`  token categories taken as 0 because negative: ${runs.reduce((x, r) => x + r.negatives, 0)} (over ${runs.length} runs × models × 5 categories)`)
  const rest = segments
    .map((s) => {
      const bg = bgByKey.get(s.key)
      const ourCc = Object.values(s.ours).reduce((x, o) => x + o.usdCcBasis, 0) + (bg?.usdCc ?? 0)
      return { id: s.id, resumed: s.resumed, negatives: bg?.negatives ?? 0, diff: ourCc - s.ccTotal }
    })
    .filter((x) => !x.negatives && cents(x.diff) !== 0)
  console.log(`  the other ${rest.length} segments not equal to the cent: ${rest.map((x) => `${x.id}${x.resumed ? ' (resumed)' : ''} ${x.diff >= 0 ? '+' : ''}$${x.diff.toFixed(2)}`).join(', ')}`)
}, 600_000)
