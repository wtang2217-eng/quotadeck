// What the tokens in a transcript would cost at Anthropic's API list prices. Subscriptions are not billed this
// way; the number only shows how much work an account did, and the UI labels it "for reference only".

import type { ModelFamily, ModelPrice } from '@shared/types'

/** The official price page these prices were read from, and when. */
export const PRICE_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'
export const PRICE_LIST_DATE = '2026-11-03'
/** Server-side web search: $10 per 1,000 searches. */
export const WEB_SEARCH_USD = 0.01
/** US-only inference (inference_geo "us…") costs 1.1x on every token category for Claude 4.6 and later models. */
export const US_ONLY_MULTIPLIER = 1.1

interface PriceRow extends ModelPrice {
  match: RegExp
}

/**
 * US dollars per million tokens, one row per model; the first matching row wins. Cache writes cost 1.25x input
 * (5 minutes) or 2x input (1 hour); cache reads 0.1x input unless a row says otherwise. Fast mode replaces the input
 * and output prices; the cache multipliers then apply to the fast prices.
 */
const ROWS: PriceRow[] = [
  { model: 'Fable 5.1', match: /(fable|mythos)-5-1(?!\d)/i, input: 10, output: 50, cacheRead: 0.25 },
  { model: 'Fable 5', match: /(fable|mythos)-5(?![-\d])|(fable|mythos)-5-\d{8}/i, input: 10, output: 50, cacheRead: 1 },
  { model: 'Opus 5.5', match: /opus-5-5(?!\d)/i, input: 4, output: 20, cacheRead: 0.2, fast: { input: 8, output: 40 } },
  { model: 'Opus 5', match: /opus-5(?![-\d])|opus-5-\d{8}/i, input: 5, output: 25, fast: { input: 10, output: 50 } },
  { model: 'Opus 4.8', match: /opus-4-8(?!\d)/i, input: 5, output: 25, fast: { input: 10, output: 50 } },
  { model: 'Opus 4.7', match: /opus-4-7(?!\d)/i, input: 5, output: 25 },
  { model: 'Opus 4.6', match: /opus-4-6(?!\d)/i, input: 5, output: 25 },
  { model: 'Opus 4.5', match: /opus-4-5(?!\d)/i, input: 5, output: 25 },
  { model: 'Opus 4.1', match: /opus-4-1(?!\d)/i, input: 15, output: 75 },
  { model: 'Opus 4', match: /opus-4(?![-\d])|opus-4-\d{8}/i, input: 15, output: 75 },
  { model: 'Opus 3', match: /3-opus/i, input: 15, output: 75 },
  // The price page lists $0.10 for Sonnet 5.5 cache reads (0.05x input). Claude Code's own cost-state still uses
  // $0.20, so its costUSD is higher than ours for conversations with Sonnet 5.5 cache reads.
  { model: 'Sonnet 5.5', match: /sonnet-5-5(?!\d)/i, input: 2, output: 10, cacheRead: 0.1 },
  { model: 'Sonnet 5', match: /sonnet-5(?![-\d])|sonnet-5-\d{8}/i, input: 2, output: 10 },
  { model: 'Sonnet 4.6', match: /sonnet-4-6(?!\d)/i, input: 3, output: 15 },
  { model: 'Sonnet 4.5', match: /sonnet-4-5(?!\d)/i, input: 3, output: 15 },
  { model: 'Sonnet 4', match: /sonnet-4(?![-\d])|sonnet-4-\d{8}/i, input: 3, output: 15 },
  { model: 'Sonnet 3.7', match: /3-7-sonnet/i, input: 3, output: 15 },
  { model: 'Sonnet 3.5', match: /3-5-sonnet/i, input: 3, output: 15 },
  // Haiku 5.5 is priced higher when a prompt is over 100K tokens.
  { model: 'Haiku 5.5', match: /haiku-5-5(?!\d)/i, input: 0.1, output: 0.5, longContext: { above: 100_000, input: 0.5, output: 2.5 } },
  { model: 'Haiku 4.5', match: /haiku-4-5(?!\d)/i, input: 1, output: 5 },
  { model: 'Haiku 3.5', match: /3-5-haiku/i, input: 0.8, output: 4 },
  { model: 'Haiku 3', match: /3-haiku/i, input: 0.25, output: 1.25 }
]

/** Used for a model the table does not know (a new release before this table is updated). */
const FALLBACK: Record<ModelFamily, ModelPrice> = {
  fable: { model: 'Fable', input: 10, output: 50 },
  opus: { model: 'Opus', input: 4, output: 20, cacheRead: 0.2 },
  sonnet: { model: 'Sonnet', input: 2, output: 10, cacheRead: 0.1 },
  haiku: { model: 'Haiku', input: 0.1, output: 0.5 },
  other: { model: 'other', input: 3, output: 15 }
}

/** Changes whenever a price above changes, so stored costs know they have to be computed again. */
export const PRICE_VERSION = (() => {
  const text = JSON.stringify([ROWS.map(({ match, ...p }) => [match.source, p]), FALLBACK, WEB_SEARCH_USD, US_ONLY_MULTIPLIER])
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return `${PRICE_LIST_DATE}.${h.toString(16).padStart(8, '0')}`
})()

export interface ModelInfo {
  family: ModelFamily
  major?: number
  minor?: number
  /** "Opus 5.5", "Haiku 3.5", or the raw id when it is not a Claude model name. */
  label: string
}

const FAMILY_NAME: Record<Exclude<ModelFamily, 'other'>, string> = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }

/** Family and version from a model id such as "claude-opus-4-1-20250805" or "claude-3-5-haiku-20241022". */
export function modelInfo(model: string): ModelInfo {
  // Versions have one or two digits; longer numbers are release dates.
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  const old = m ? undefined : /claude-(\d)-(\d)-(opus|sonnet|haiku)|claude-(\d)-(opus|sonnet|haiku)/i.exec(model)
  const name = (m?.[1] ?? old?.[3] ?? old?.[5])?.toLowerCase()
  if (!name) return { family: 'other', label: model || '?' }
  const family = (name === 'mythos' ? 'fable' : name) as Exclude<ModelFamily, 'other'>
  const major = Number(m ? m[2] : (old![1] ?? old![4]))
  const minorText = m ? m[3] : old![2]
  const minor = minorText !== undefined ? Number(minorText) : undefined
  const display = name === 'mythos' ? 'Mythos' : FAMILY_NAME[family]
  return { family, major, minor, label: `${display} ${major}${minor !== undefined ? `.${minor}` : ''}` }
}

/** The list price of a model id. */
export function priceOf(model: string): ModelPrice {
  const row = ROWS.find((r) => r.match.test(model))
  if (row) {
    const { match: _match, ...price } = row
    return price
  }
  return FALLBACK[modelInfo(model).family]
}

/** Every row of the table, for showing the prices used. */
export function priceTable(): ModelPrice[] {
  return ROWS.map(({ match: _match, ...price }) => price)
}

/** Claude 4.6 and later (US-only inference costs more for these). */
function isGeoPriced(model: string): boolean {
  const info = modelInfo(model)
  if (info.family === 'other' || info.major === undefined) return false
  return info.major > 4 || (info.major === 4 && (info.minor ?? 0) >= 6)
}

export interface ReplyUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }
  /** "fast" for fast mode. */
  speed?: string | null
  /** "us…" when the request asked for US-only inference; "global" or "not_available" otherwise. */
  inference_geo?: string | null
  server_tool_use?: { web_search_requests?: number }
}

export interface TokenCounts {
  i: number
  o: number
  w5: number
  w1: number
  r: number
}

/** Token counts of one reply, with cache writes split by lifetime (they are priced differently). */
export function tokensOf(u: ReplyUsage): { input: number; output: number; cacheRead: number; write5m: number; write1h: number } {
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1h)
  return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, write5m, write1h }
}

/**
 * The price tier of one request: "f" fast mode, "l" a prompt over the model's long-context threshold, "u" US-only
 * inference on a model where that costs more; "" is the standard price. Letters are always in this order.
 */
export function tierOf(u: ReplyUsage, model: string): string {
  const p = priceOf(model)
  const t = tokensOf(u)
  let tier = ''
  if (u.speed === 'fast' && p.fast) tier += 'f'
  if (p.longContext && t.input + t.cacheRead + t.write5m + t.write1h > p.longContext.above) tier += 'l'
  if (typeof u.inference_geo === 'string' && /^us/i.test(u.inference_geo) && isGeoPriced(model)) tier += 'u'
  return tier
}

export function webSearchesOf(u: ReplyUsage): number {
  const n = u.server_tool_use?.web_search_requests
  return typeof n === 'number' && n > 0 ? n : 0
}

/** Per-token prices (US dollars per million) of a model in a tier, and the US-only multiplier. */
function tierPrices(model: string, tier: string): { input: number; output: number; read: number; geo: number } {
  const p = priceOf(model)
  let input = p.input
  let output = p.output
  if (tier.includes('f') && p.fast) {
    input = p.fast.input
    output = p.fast.output
  } else if (tier.includes('l') && p.longContext) {
    input = p.longContext.input
    output = p.longContext.output
  }
  // A listed cache-read price is a ratio of the input price, and keeps that ratio in the fast and long tiers.
  const readRatio = p.cacheRead !== undefined ? p.cacheRead / p.input : 0.1
  return { input, output, read: input * readRatio, geo: tier.includes('u') ? US_ONLY_MULTIPLIER : 1 }
}

/** US dollars at list price for tokens of one model and tier, plus web searches. */
export function costOfTokens(model: string, tier: string, t: TokenCounts, webSearches = 0): number {
  const { input, output, read, geo } = tierPrices(model, tier)
  const tokens = t.i * input + t.o * output + t.r * read + t.w5 * input * 1.25 + t.w1 * input * 2
  return (geo * tokens) / 1e6 + webSearches * WEB_SEARCH_USD
}

/**
 * What prompt caching did for these tokens: `savings` = cache reads × (input price − cache-read price); `noCache` =
 * the cost if every cached token (read or written) had been billed as plain input.
 */
export function cacheEconomics(model: string, tier: string, t: TokenCounts, webSearches = 0): { savings: number; noCache: number } {
  const { input, output, read, geo } = tierPrices(model, tier)
  return {
    savings: (geo * t.r * (input - read)) / 1e6,
    noCache: (geo * ((t.i + t.r + t.w5 + t.w1) * input + t.o * output)) / 1e6 + webSearches * WEB_SEARCH_USD
  }
}

/** US dollars at list price for one request. */
export function costOf(u: ReplyUsage, model: string): number {
  const t = tokensOf(u)
  return costOfTokens(model, tierOf(u, model), { i: t.input, o: t.output, w5: t.write5m, w1: t.write1h, r: t.cacheRead }, webSearchesOf(u))
}
