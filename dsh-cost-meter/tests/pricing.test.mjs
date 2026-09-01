import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Config,
  DEFAULT_PRICING,
  assignmentWithObservedMultiplier,
  billedOutputTokens,
  discountMultiplierAt,
  lastProbeAt,
  contextTokensOf,
  foldSession,
  formatContextSurcharge,
  formatTokenThreshold,
  normalizePricing,
  normalizeUsage,
  resolveContextMultiplier,
  resolvePricing,
  resolveReasoningExtra,
  validatePricing,
} from '../lib/index.js'

const config = structuredClone(DEFAULT_PRICING)
config.groups[0].periods = [{
  id: 'default-night', name: '默认低峰', start: '23:00', end: '07:00', multiplier: 0.5,
}]
config.groups.push({
  id: 'vendor-a',
  name: 'vendor-a',
  input: 3,
  output: 2,
  cacheReadMultiplier: 0.1,
  cacheWriteMultiplier: 1,
  periods: [{ id: 'model-peak', name: '模型高峰', start: '09:00', end: '12:00', multiplier: 4.5 }],
  contextSurcharges: [],
})
config.models['vendor/model-a'] = { groupId: 'vendor-a' }

test('resolves group rates, period multipliers, and default fallback', () => {
  const peak = resolvePricing(config, 'vendor', 'model-a', Date.parse('2026-01-01T02:00:00Z'))
  assert.equal(peak.source, 'group-period')
  assert.equal(peak.periodName, '模型高峰')
  assert.equal(peak.groupId, 'vendor-a')
  assert.deepEqual(peak.rates, { input: 13.5, cacheRead: 1.35, cacheWrite: 13.5, output: 9 })
  const nightFallback = resolvePricing(config, 'vendor', 'unknown', Date.parse('2026-01-01T16:00:00Z'))
  assert.equal(nightFallback.source, 'group-period')
  assert.equal(nightFallback.periodName, '默认低峰')
  assert.equal(nightFallback.groupId, 'default')
  assert.deepEqual(nightFallback.rates, { input: 0.5, cacheRead: 0.01, cacheWrite: 0.5, output: 1 })
})

test('selects discount multiplier by effective time history', () => {
  const assignment = { groupId: 'default', discountMultiplier: 0.1, discountMultiplierHistory: [{ effectiveAt: 0, discountMultiplier: 0.04 }, { effectiveAt: 1000, discountMultiplier: 0.1 }] }
  assert.equal(discountMultiplierAt(assignment, 999), 0.04)
  assert.equal(discountMultiplierAt(assignment, 1000), 0.1)
})

test('lastProbeAt prefers lastProbedAt then the latest probe history entry', () => {
  assert.equal(lastProbeAt(undefined), null)
  assert.equal(lastProbeAt({ groupId: 'default' }), null)
  assert.equal(lastProbeAt({
    groupId: 'default',
    lastProbedAt: 5000,
    discountMultiplierHistory: [{ effectiveAt: 1000, discountMultiplier: 0.1, source: 'probe' }],
  }), 5000)
  assert.equal(lastProbeAt({
    groupId: 'default',
    discountMultiplierHistory: [
      { effectiveAt: 0, discountMultiplier: 1 },
      { effectiveAt: 1000, discountMultiplier: 0.1, source: 'probe' },
      { effectiveAt: 2000, discountMultiplier: 0.2, source: 'manual' },
    ],
  }), 1000)
})

test('assignmentWithObservedMultiplier records lastProbedAt even when the multiplier is unchanged', () => {
  const same = assignmentWithObservedMultiplier({ groupId: 'default', discountMultiplier: 0.8 }, 0.8, 9_000)
  assert.equal(same.discountMultiplier, 0.8)
  assert.equal(same.lastProbedAt, 9_000)
  assert.equal(same.discountMultiplierHistory?.at(-1)?.source, undefined)
  const changed = assignmentWithObservedMultiplier({ groupId: 'default', discountMultiplier: 0.8, lastProbedAt: 1_000 }, 0.5, 9_000)
  assert.equal(changed.discountMultiplier, 0.5)
  assert.equal(changed.lastProbedAt, 9_000)
  assert.equal(changed.discountMultiplierHistory?.at(-1)?.source, 'probe')
  assert.equal(changed.discountMultiplierHistory?.at(-1)?.effectiveAt, 9_000)
})

test('applies discount and model multipliers after group rates', () => {
  const priced = structuredClone(DEFAULT_PRICING)
  priced.models['vendor/promo'] = { groupId: 'default', discountMultiplier: 0.5, modelMultiplier: 1.5 }
  const resolved = resolvePricing(priced, 'vendor', 'promo', Date.parse('2026-01-01T04:00:00Z'))
  assert.equal(resolved.discountMultiplier, 0.5)
  assert.equal(resolved.modelMultiplier, 1.5)
  assert.deepEqual(resolved.rates, { input: 0.75, cacheRead: 0.015, cacheWrite: 0.75, output: 1.5 })
})

test('normalizes common provider usage formats', () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 16_000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 12_000 } }), {
    inputTokens: 4_000, cacheReadTokens: 12_000, cacheWriteTokens: 0, outputTokens: 500, reasoningTokens: 0,
  })
  assert.deepEqual(normalizeUsage({ input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 15_000, cache_creation_input_tokens: 8_000 }), {
    inputTokens: 1200, cacheReadTokens: 15_000, cacheWriteTokens: 8_000, outputTokens: 300, reasoningTokens: 0,
  })
  assert.deepEqual(normalizeUsage({ prompt_tokens: 14_297, prompt_cache_hit_tokens: 12_867, completion_tokens: 140 }), {
    inputTokens: 1430, cacheReadTokens: 12_867, cacheWriteTokens: 0, outputTokens: 140, reasoningTokens: 0,
  })
  assert.deepEqual(normalizeUsage({
    inputTokens: 4_270,
    cacheReadTokens: 81_792,
    outputTokens: 133,
    reasoningTokens: 4_143,
  }), {
    inputTokens: 4_270, cacheReadTokens: 81_792, cacheWriteTokens: 0, outputTokens: 133, reasoningTokens: 4_143,
  })
  assert.deepEqual(normalizeUsage({
    prompt_tokens: 642,
    completion_tokens: 1,
    prompt_tokens_details: { cached_tokens: 512 },
    completion_tokens_details: { reasoning_tokens: 379 },
  }), {
    inputTokens: 130, cacheReadTokens: 512, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 379,
  })
})

test('bills disjoint reasoning tokens at the output rate', () => {
  assert.equal(billedOutputTokens(133, 4_143, true), 4_276)
  assert.equal(billedOutputTokens(26, 24, false), 26)
  assert.equal(billedOutputTokens(133, 4_143, undefined), 4_276)
  assert.equal(billedOutputTokens(5_000, 2_000, undefined), 5_000)
  const priced = structuredClone(DEFAULT_PRICING)
  priced.groups[0] = {
    ...priced.groups[0],
    input: 0.24,
    output: 0.72,
    cacheReadMultiplier: 0.25,
    cacheWriteMultiplier: 0.25,
  }
  priced.models['grok/grok-4.6'] = { groupId: 'default', reasoningExtra: true }
  assert.equal(resolveReasoningExtra(priced, 'grok', 'grok-4.6'), true)
  const folded = foldSession([
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'grok', model: 'grok-4.6' } } } },
    { type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: {
      inputTokens: 4_270, cacheReadTokens: 81_792, outputTokens: 133, reasoningTokens: 4_143,
    } } },
  ], priced)
  assert.equal(folded.outputTokens, 4_276)
  assert.equal(folded.outputCost, 4_276 * 0.72 / 1_000_000)
})

test('rejects overlapping and invalid pricing configuration', () => {
  const overlapping = structuredClone(config)
  overlapping.groups[0].periods.push({ id: 'overlap', name: '重叠', start: '06:00', end: '08:00', multiplier: 1 })
  assert.throws(() => validatePricing(overlapping), /overlapping periods/)
  const badZone = structuredClone(config)
  badZone.timezone = 'Mars/Olympus'
  assert.throws(() => validatePricing(badZone), /IANA time zone/)
  const missingGroup = structuredClone(DEFAULT_PRICING)
  missingGroup.models['vendor/a'] = { groupId: 'missing' }
  assert.throws(() => validatePricing(missingGroup), /does not match a pricing group/)
})

test('rejects invalid context surcharge configuration', () => {
  const duplicate = structuredClone(config)
  duplicate.groups[0].contextSurcharges = [
    { afterTokens: 200_000, multiplier: 2 },
    { afterTokens: 200_000, multiplier: 3 },
  ]
  assert.throws(() => validatePricing(duplicate), /duplicate afterTokens/)
  const fractional = structuredClone(config)
  fractional.groups[0].contextSurcharges = [{ afterTokens: 200_000.5, multiplier: 2 }]
  assert.throws(() => validatePricing(fractional), /afterTokens/)
  const negative = structuredClone(config)
  negative.groups[1].contextSurcharges = [{ afterTokens: 200_000, multiplier: -1 }]
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
  assert.equal(result.inputCost, 500_000 * 13.5 / 1_000_000 + 0.5)
  assert.equal(result.cacheReadCost, 0.01)
  assert.equal(result.cacheWriteCost, 0.5)
  assert.equal(result.outputCost, 500_000 * 9 / 1_000_000 + 1)
  assert.equal(result.cost, result.inputCost + result.cacheReadCost + result.cacheWriteCost + result.outputCost)
  assert.equal(result.route, 'vendor/unknown')
  assert.equal(result.pricingSource, 'group-period')
})

test('context surcharge multiplies the whole request after the threshold', () => {
  const priced = structuredClone(DEFAULT_PRICING)
  priced.groups[0] = {
    id: 'default',
    name: '默认',
    input: 0.24,
    output: 0.72,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1,
    periods: [],
    contextSurcharges: [{ afterTokens: 200_000, multiplier: 2 }],
  }
  priced.models['grok/grok-4.6'] = { groupId: 'default' }
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
  assert.equal(above.hourly[0].rates?.input, 0.24)
  assert.equal(above.hourly[0].rates?.cacheRead, 0.024)
  assert.equal(above.hourly[0].rates?.output, 0.72)
  assert.equal(below.details[0].contextMultiplier, 1)
  assert.equal(below.details[0].contextAfterTokens, null)
  assert.equal(formatTokenThreshold(200_000), '200K')
  assert.equal(formatContextSurcharge(200_000, 2), '超过 200K ×2')
  assert.equal(formatContextSurcharge(null, 1), null)
})

test('context surcharge uses the highest matching threshold and group lists replace default', () => {
  const priced = structuredClone(DEFAULT_PRICING)
  priced.groups[0].contextSurcharges = [
    { afterTokens: 200_000, multiplier: 2 },
    { afterTokens: 400_000, multiplier: 4 },
  ]
  priced.groups.push({
    id: 'exempt',
    name: 'exempt',
    input: 1,
    output: 2,
    cacheReadMultiplier: 0.02,
    cacheWriteMultiplier: 1,
    periods: [],
    contextSurcharges: [],
  })
  priced.models['vendor/plain'] = { groupId: 'default' }
  priced.models['vendor/exempt'] = { groupId: 'exempt' }
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
  priced.groups[0].contextSurcharges = [{ afterTokens: 200_000, multiplier: 2 }]
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
  priced.groups[0].contextSurcharges = [{ afterTokens: 200_000, multiplier: 2 }]
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

test('migrates legacy default/models absolute rates into groups', () => {
  const migrated = normalizePricing({
    currency: 'CNY',
    unitTokens: 1_000_000,
    timezone: 'Asia/Shanghai',
    default: {
      rates: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 2 },
      periods: [{ id: 'night', name: '低峰', start: '00:00', end: '08:00', rates: { input: 0.5, output: 1 } }],
    },
    models: {
      'grok/grok-4.6': {
        rates: { input: 0.24, cacheRead: 0.06, cacheWrite: 0.06, output: 0.72 },
        contextSurcharges: [{ afterTokens: 200_000, multiplier: 2 }],
        reasoningExtra: true,
      },
      'gpt-008/gpt-5.6-terra': {
        rates: { input: 0.16, cacheRead: 0.016, cacheWrite: 0.016, output: 0.96 },
        contextSurcharges: [{ afterTokens: 200_000, multiplier: 2 }],
      },
      'ds/kimi-k2.6': { rates: {}, periods: [] },
    },
  })
  validatePricing(migrated)
  assert.equal(migrated.groups.length, 3)
  assert.equal(migrated.models['ds/kimi-k2.6'].groupId, 'default')
  assert.equal(migrated.models['grok/grok-4.6'].reasoningExtra, true)
  const grok = resolvePricing(migrated, 'grok', 'grok-4.6', Date.parse('2026-01-01T04:00:00Z'))
  assert.equal(grok.rates.input, 0.24)
  assert.equal(grok.rates.cacheRead, 0.06)
  assert.equal(grok.rates.output, 0.72)
  const night = resolvePricing(migrated, 'ds', 'kimi-k2.6', Date.parse('2026-01-01T16:00:00Z'))
  assert.equal(night.rates.input, 0.5)
  assert.equal(night.rates.output, 1)
  assert.equal(resolveContextMultiplier(migrated, 'grok', 'grok-4.6', 200_001), 2)
  assert.equal(resolveContextMultiplier(migrated, 'ds', 'kimi-k2.6', 200_001), 1)
})

test('settings schema persists group assignments over a leftover default section', () => {
  const merged = {
    currency: 'CNY',
    unitTokens: 1_000_000,
    timezone: 'Asia/Shanghai',
    default: {
      rates: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 2 },
      periods: [],
    },
    groups: [
      { id: 'default', name: '默认', input: 1, output: 2, cacheReadMultiplier: 0.02, cacheWriteMultiplier: 1, periods: [], contextSurcharges: [] },
      { id: 'group-1', name: '新分组', input: 1, output: 2, cacheReadMultiplier: 0.02, cacheWriteMultiplier: 1, periods: [], contextSurcharges: [] },
    ],
    models: {
      'wz/gpt-5.6-sol': { groupId: 'group-1', discountMultiplier: 1, modelMultiplier: 1 },
      'wz/gpt-5.6-terra': { groupId: 'group-1' },
    },
  }
  const stored = Config(merged)
  assert.equal('default' in stored, false)
  assert.deepEqual(stored.groups.map(group => group.id), ['default', 'group-1'])
  assert.equal(stored.models['wz/gpt-5.6-sol'].groupId, 'group-1')
  assert.equal(stored.models['wz/gpt-5.6-terra'].groupId, 'group-1')
  validatePricing(stored)
})

test('settings schema migrates a stored legacy document', () => {
  const stored = Config({
    currency: 'CNY',
    unitTokens: 1_000_000,
    timezone: 'Asia/Shanghai',
    default: { rates: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 2 }, periods: [] },
    models: {
      'grok/grok-4.6': {
        rates: { input: 0.24, cacheRead: 0.06, cacheWrite: 0.06, output: 0.72 },
        reasoningExtra: true,
      },
    },
  })
  assert.equal(stored.groups.length >= 2, true)
  assert.equal(stored.models['grok/grok-4.6'].groupId !== 'default', true)
  assert.equal(stored.models['grok/grok-4.6'].reasoningExtra, true)
})
