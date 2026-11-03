// What the tokens in a transcript would cost at Anthropic's API list prices. Subscriptions are not billed this
// way; the number only shows how much work an account did, and the UI labels it "for reference only".

import type { ModelFamily, TokenTotals } from '@shared/types'

/** Date of the price list below. */
export const PRICE_LIST_DATE = '2026-10-06'

interface Price {
  /** US dollars per million input tokens. */
  input: number
  output: number
  /** Cache reads; 10% of input unless the list says otherwise. */
  cacheRead?: number
}

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
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  const old = m ? undefined : /claude-(\d)-(\d)-(opus|sonnet|haiku)/i.exec(model)
  const name = (m?.[1] ?? old?.[3])?.toLowerCase()
  if (!name) return { family: 'other', label: model || '?' }
  const family = (name === 'mythos' ? 'fable' : name) as Exclude<ModelFamily, 'other'>
  const major = Number(m ? m[2] : old![1])
  const minorText = m ? m[3] : old![2]
  const minor = minorText !== undefined ? Number(minorText) : undefined
  const display = name === 'mythos' ? 'Mythos' : FAMILY_NAME[family]
  return { family, major, minor, label: `${display} ${major}${minor !== undefined ? `.${minor}` : ''}` }
}

function priceFor(info: ModelInfo): Price {
  const v = (info.major ?? 0) + (info.minor ?? 0) / 10
  switch (info.family) {
    case 'fable':
      return v >= 5.1 ? { input: 10, output: 50, cacheRead: 0.25 } : { input: 10, output: 50 }
    case 'opus':
      if (v >= 5.5) return { input: 4, output: 20, cacheRead: 0.2 }
      if (v >= 4.5) return { input: 5, output: 25 }
      return { input: 15, output: 75 }
    case 'sonnet':
      if (v >= 5) return { input: 2, output: 10, cacheRead: 0.2 }
      return { input: 3, output: 15 }
    case 'haiku':
      if (v >= 5) return { input: 0.1, output: 0.5 }
      if (v >= 4) return { input: 1, output: 5 }
      if (v >= 3.5) return { input: 0.8, output: 4 }
      return { input: 0.25, output: 1.25 }
    default:
      return { input: 3, output: 15 }
  }
}

export interface ReplyUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }
}

/** Token counts of one reply, with cache writes split by lifetime (they are priced differently). */
export function tokensOf(u: ReplyUsage): TokenTotals & { write5m: number; write1h: number } {
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1h)
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: write5m + write1h,
    write5m,
    write1h
  }
}

/** US dollars at list price. Cache writes cost 1.25x input for 5 minutes and 2x for 1 hour. */
export function costOf(u: ReplyUsage, model: string): number {
  const p = priceFor(modelInfo(model))
  const t = tokensOf(u)
  const read = p.cacheRead ?? p.input * 0.1
  return (t.input * p.input + t.output * p.output + t.cacheRead * read + t.write5m * p.input * 1.25 + t.write1h * p.input * 2) / 1e6
}
