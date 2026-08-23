import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PRICING,
  contextTokensOf,
  foldSession,
  formatContextSurcharge,
  formatTokenThreshold,
  normalizeUsage,
  resolveContextMultiplier,
  resolvePricing,
  validatePricing,
} from '../lib/index.js'

const config = structuredClone(DEFAULT_PRICING)
config.default.periods = [{
  id: 'default-night', name: '默认低峰', start: '23:00', end: '07:00',
  rates: { input: 0.5, output: 1 },
}]
config.models['vendor/model-a'] = {
  rates: { input: 3, cacheRead: 0.3 },
  periods: [{ id: 'model-peak', name: '模型高峰', start: '09:00', end: '12:00', rates: { output: 9 } }],
}

test('resolves model, period, and default rates independently', () => {
  const peak = resolvePricing(config, 'vendor', 'model-a', Date.parse('2026-01-01T02:00:00Z'))
  assert.deepEqual(peak, {
    rates: { input: 3, cacheRead: 0.3, cacheWrite: 1, output: 9 },
    source: 'model-period', periodName: '模型高峰',
  })
  const nightFallback = resolvePricing(config, 'vendor', 'unknown', Date.parse('2026-01-01T16:00:00Z'))
  assert.deepEqual(nightFallback, {
    rates: { input: 0.5, cacheRead: 0.02, cacheWrite: 1, output: 1 },
    source: 'default-period', periodName: '默认低峰',
  })
})

test('normalizes common provider usage formats', () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 16_000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 12_000 } }), {
    inputTokens: 4_000, cacheReadTokens: 12_000, cacheWriteTokens: 0, outputTokens: 500,
  })
  assert.deepEqual(normalizeUsage({ input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 15_000, cache_creation_input_tokens: 8_000 }), {
    inputTokens: 1200, cacheReadTokens: 15_000, cacheWriteTokens: 8_000, outputTokens: 300,
  })
  assert.deepEqual(normalizeUsage({ prompt_tokens: 14_297, prompt_cache_hit_tokens: 12_867, completion_tokens: 140 }), {
    inputTokens: 1430, cacheReadTokens: 12_867, cacheWriteTokens: 0, outputTokens: 140,
  })
})

test('rejects overlapping and invalid pricing configuration', () => {
  const overlapping = structuredClone(config)
  overlapping.default.periods.push({ id: 'overlap', name: '重叠', start: '06:00', end: '08:00', rates: {} })
  assert.throws(() => validatePricing(overlapping), /overlapping periods/)
  const badZone = structuredClone(config)
  badZone.timezone = 'Mars/Olympus'
  assert.throws(() => validatePricing(badZone), /IANA time zone/)
})

test('rejects invalid context surcharge configuration', () => {
  const duplicate = structuredClone(config)
  duplicate.default.contextSurcharges = [
    { afterTokens: 200_000, multiplier: 2 },
    { afterTokens: 200_000, multiplier: 3 },
  ]
  assert.throws(() => validatePricing(duplicate), /duplicate afterTokens/)
  const fractional = structuredClone(config)
  fractional.default.contextSurcharges = [{ afterTokens: 200_000.5, multiplier: 2 }]
  assert.throws(() => validatePricing(fractional), /afterTokens/)
  const negative = structuredClone(config)
  negative.models['vendor/model-a'].contextSurcharges = [{ afterTokens: 200_000, multiplier: -1 }]
  assert.throws(() => validatePricing(negative), /multiplier/)
})

test('prices each request route and replaces duplicate step usage', () => {
  const events = [
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'vendor', model: 'model-a' } } } },
    { type: 'assistant/chunk', time: Date.parse('2026-01-01T02:00:00Z'), data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } } } },
    { type: 'assistant/message', time: Date.parse('2026-01-01T02:00:01Z'), data: { turn: 1, step: 1, usage: { inputTokens: 500_000, outputTokens: 500_000 } } },
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'vendor', model: 'unknown' } } } },
    { type: 'assistant/message', time: Date.parse('2026-01-01T16:00:00Z'), data: { turn: 1, step: 2, usage: { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, outputTokens: 1_000_000 } } },
  ]
  const result = foldSession(events, config)
  assert.equal(result.inputCost, 2)
  assert.equal(result.cacheReadCost, 0.02)
  assert.equal(result.cacheWriteCost, 1)
  assert.equal(result.outputCost, 5.5)
  assert.equal(result.cost, 8.52)
  assert.equal(result.route, 'vendor/unknown')
  assert.equal(result.pricingSource, 'default-period')
})

test('context surcharge multiplies the whole request after the threshold', () => {
  const priced = structuredClone(DEFAULT_PRICING)
  priced.default.contextSurcharges = [{ afterTokens: 200_000, multiplier: 2 }]
  priced.models['grok/grok-4.6'] = {
    rates: { input: 0.24, cacheRead: 0.024, cacheWrite: 0.24, output: 0.72 },
    contextSurcharges: [{ afterTokens: 200_000, multiplier: 2 }],
  }
  const below = foldSession([
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'grok', model: 'grok-4.6' } } } },
    { type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 443, cacheReadTokens: 199_557, outputTokens: 1_316 } } },
  ], priced)
  const above = foldSession([
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'grok', model: 'grok-4.6' } } } },
    { type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 443, cacheReadTokens: 202_200, outputTokens: 1_316 } } },
  ], priced)
  const unit = 1_000_000
  const costOf = (tokens, multiplier) => (
    tokens.input * 0.24 / unit * multiplier
    + tokens.cacheRead * 0.024 / unit * multiplier
    + tokens.output * 0.72 / unit * multiplier
  )
  const belowTokens = { input: 443, cacheRead: 199_557, cacheWrite: 0, output: 1_316 }
  const aboveTokens = { input: 443, cacheRead: 202_200, cacheWrite: 0, output: 1_316 }
  assert.equal(contextTokensOf(belowTokens), 200_000)
  assert.equal(resolveContextMultiplier(priced, 'grok', 'grok-4.6', 200_000), 1)
  assert.equal(resolveContextMultiplier(priced, 'grok', 'grok-4.6', 202_643), 2)
  assert.equal(below.inputCost, belowTokens.input * 0.24 / unit)
  assert.equal(below.cacheReadCost, belowTokens.cacheRead * 0.024 / unit)
  assert.equal(below.outputCost, belowTokens.output * 0.72 / unit)
  assert.equal(below.cost, below.inputCost + below.cacheReadCost + below.outputCost)
  assert.equal(below.cost, costOf(belowTokens, 1))
  assert.equal(above.inputCost, aboveTokens.input * 0.24 / unit * 2)
  assert.equal(above.cacheReadCost, aboveTokens.cacheRead * 0.024 / unit * 2)
  assert.equal(above.outputCost, aboveTokens.output * 0.72 / unit * 2)
  assert.equal(above.cost, above.inputCost + above.cacheReadCost + above.outputCost)
  assert.equal(above.cost, costOf(aboveTokens, 2))
  assert.equal(above.details[0].contextMultiplier, 2)
  assert.equal(above.details[0].contextAfterTokens, 200_000)
  assert.equal(above.hourly[0].contextMultiplier, 2)
  assert.equal(above.hourly[0].contextAfterTokens, 200_000)
  assert.equal(below.details[0].contextMultiplier, 1)
  assert.equal(below.details[0].contextAfterTokens, null)
  assert.equal(formatTokenThreshold(200_000), '200K')
  assert.equal(formatContextSurcharge(200_000, 2), '超过 200K ×2')
  assert.equal(formatContextSurcharge(null, 1), null)
})

test('context surcharge uses the highest matching threshold and model lists replace default', () => {
  const priced = structuredClone(DEFAULT_PRICING)
  priced.default.contextSurcharges = [
    { afterTokens: 200_000, multiplier: 2 },
    { afterTokens: 400_000, multiplier: 4 },
  ]
  priced.models['vendor/plain'] = { rates: { input: 1 } }
  priced.models['vendor/exempt'] = { rates: { input: 1 }, contextSurcharges: [] }
  const mixed = foldSession([
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'vendor', model: 'plain' } } } },
    { type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 200_001, outputTokens: 1_000_000 } } },
    { type: 'assistant/message', time: 2, data: { turn: 1, step: 2, usage: { inputTokens: 400_001, outputTokens: 1_000_000 } } },
    { type: 'request/header', time: 3, data: { header: { config: { provider: 'vendor', model: 'exempt' } } } },
    { type: 'assistant/message', time: 4, data: { turn: 1, step: 3, usage: { inputTokens: 500_000, outputTokens: 1_000_000 } } },
  ], priced)
  assert.equal(mixed.inputCost, 200_001 / 1_000_000 * 2 + 400_001 / 1_000_000 * 4 + 500_000 / 1_000_000)
  assert.equal(mixed.outputCost, 2 * 2 + 2 * 4 + 2)
  assert.equal(mixed.cost, mixed.inputCost + mixed.outputCost)
  assert.deepEqual(mixed.details.map(detail => [detail.model, detail.contextMultiplier]).sort(), [
    ['exempt', 1],
    ['plain', 2],
    ['plain', 4],
  ])
})

test('context threshold counts cache write and ignores output tokens', () => {
  const priced = structuredClone(DEFAULT_PRICING)
  priced.default.contextSurcharges = [{ afterTokens: 200_000, multiplier: 2 }]
  const cacheWriteOnly = foldSession([
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'vendor', model: 'plain' } } } },
    { type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 1, cacheWriteTokens: 200_000, outputTokens: 1_000_000 } } },
  ], priced)
  const outputHeavy = foldSession([
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'vendor', model: 'plain' } } } },
    { type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 200_000, outputTokens: 2_000_000 } } },
  ], priced)
  assert.equal(cacheWriteOnly.cacheWriteCost, 200_000 / 1_000_000 * 2)
  assert.equal(cacheWriteOnly.outputCost, 4)
  assert.equal(outputHeavy.inputCost, 0.2)
  assert.equal(outputHeavy.outputCost, 4)
  assert.equal(outputHeavy.details[0].contextMultiplier, 1)
})

test('later usage for the same step replaces a previous surcharge', () => {
  const priced = structuredClone(DEFAULT_PRICING)
  priced.default.contextSurcharges = [{ afterTokens: 200_000, multiplier: 2 }]
  const result = foldSession([
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'vendor', model: 'plain' } } } },
    { type: 'assistant/chunk', time: 1, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 300_000, outputTokens: 1_000_000 } } } },
    { type: 'assistant/message', time: 2, data: { turn: 1, step: 1, usage: { inputTokens: 100_000, outputTokens: 500_000 } } },
  ], priced)
  assert.equal(result.inputCost, 0.1)
  assert.equal(result.outputCost, 1)
  assert.equal(result.cost, 1.1)
  assert.equal(result.details.length, 1)
  assert.equal(result.details[0].contextMultiplier, 1)
  assert.equal(result.hourly.length, 1)
  assert.equal(result.hourly[0].contextMultiplier, 1)
})
