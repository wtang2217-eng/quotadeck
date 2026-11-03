// Prices from the official price page (2026-11-03): Sonnet 5.5 cache reads, fast mode, web search, US-only inference.
import { describe, expect, it } from 'vitest'
import { costOf, costOfTokens, PRICE_VERSION, tierOf } from '../src/main/core/pricing'

const M = 1e6

describe('official price page details', () => {
  it('prices Sonnet 5.5 cache reads at $0.10 per million (0.05x input)', () => {
    expect(costOf({ cache_read_input_tokens: M }, 'claude-sonnet-5-5')).toBeCloseTo(0.1)
    // Claude Code's own cost-state still counts $0.20; the price page is what counts here.
    expect(costOf({ cache_read_input_tokens: 20_794_000, output_tokens: 10_000 }, 'claude-sonnet-5-5')).toBeCloseTo(2.0794 + 0.1, 4)
  })

  it('prices fast mode, with the cache multipliers on the fast prices', () => {
    const fast = { speed: 'fast' as const }
    expect(tierOf({ ...fast, input_tokens: 1 }, 'claude-opus-5-5')).toBe('f')
    expect(costOf({ ...fast, input_tokens: M }, 'claude-opus-5-5')).toBeCloseTo(8)
    expect(costOf({ ...fast, output_tokens: M }, 'claude-opus-5-5')).toBeCloseTo(40)
    // Opus 5.5 keeps its 0.05x cache-read ratio: $8 × 0.05.
    expect(costOf({ ...fast, cache_read_input_tokens: M }, 'claude-opus-5-5')).toBeCloseTo(0.4)
    expect(costOf({ ...fast, cache_creation_input_tokens: M, cache_creation: { ephemeral_1h_input_tokens: M } }, 'claude-opus-5-5')).toBeCloseTo(16)
    expect(costOf({ ...fast, input_tokens: M, output_tokens: M }, 'claude-opus-5')).toBeCloseTo(10 + 50)
    expect(costOf({ ...fast, input_tokens: M, cache_read_input_tokens: M }, 'claude-opus-4-8')).toBeCloseTo(10 + 1)
    expect(costOf({ ...fast, cache_creation_input_tokens: M }, 'claude-opus-4-8')).toBeCloseTo(12.5)
    // Models without fast mode keep their standard price.
    expect(tierOf({ ...fast }, 'claude-sonnet-5-5')).toBe('')
    expect(costOf({ speed: 'standard', input_tokens: M }, 'claude-opus-5-5')).toBeCloseTo(4)
  })

  it('charges $0.01 per server-side web search', () => {
    expect(costOf({ input_tokens: 0, server_tool_use: { web_search_requests: 3 } }, 'claude-haiku-5-5')).toBeCloseTo(0.03)
    expect(costOfTokens('claude-opus-5-5', '', { i: M, o: 0, w5: 0, w1: 0, r: 0 }, 1000)).toBeCloseTo(4 + 10)
  })

  it('adds 10% for US-only inference on Claude 4.6 and later, on every token category', () => {
    const us = { inference_geo: 'us' }
    expect(tierOf(us, 'claude-opus-5-5')).toBe('u')
    expect(costOf({ ...us, input_tokens: M, output_tokens: M, cache_read_input_tokens: M }, 'claude-opus-5-5')).toBeCloseTo(1.1 * (4 + 20 + 0.2))
    expect(costOf({ ...us, input_tokens: M }, 'claude-sonnet-4-6')).toBeCloseTo(3.3)
    // 100K tokens stays in Haiku 5.5's standard tier; one million would be its long-context price ($0.50 × 1.1).
    expect(costOf({ ...us, input_tokens: 100_000 }, 'claude-haiku-5-5')).toBeCloseTo(0.011, 5)
    expect(costOf({ ...us, input_tokens: M }, 'claude-haiku-5-5')).toBeCloseTo(0.55)
    // Older models and other regions are not affected.
    expect(tierOf(us, 'claude-haiku-4-5-20251001')).toBe('')
    expect(tierOf(us, 'claude-sonnet-4-5-20250929')).toBe('')
    expect(tierOf({ inference_geo: 'global' }, 'claude-opus-5-5')).toBe('')
    expect(tierOf({ inference_geo: 'not_available' }, 'claude-opus-5-5')).toBe('')
    // Fast mode and US-only together.
    expect(costOf({ speed: 'fast', inference_geo: 'us', input_tokens: M }, 'claude-opus-5-5')).toBeCloseTo(8.8)
  })

  it('keeps the long-context tier of Haiku 5.5 apart', () => {
    expect(tierOf({ input_tokens: 100_001 }, 'claude-haiku-5-5')).toBe('l')
    expect(tierOf({ input_tokens: 100_000 }, 'claude-haiku-5-5')).toBe('')
    expect(costOfTokens('claude-haiku-5-5', 'l', { i: M, o: M, w5: 0, w1: 0, r: 0 })).toBeCloseTo(0.5 + 2.5)
    expect(costOfTokens('claude-haiku-5-5', 'lu', { i: M, o: 0, w5: 0, w1: 0, r: 0 })).toBeCloseTo(0.55)
  })

  it('names the price version after the page date', () => {
    expect(PRICE_VERSION).toMatch(/^2026-11-03\.[0-9a-f]{8}$/)
  })
})
