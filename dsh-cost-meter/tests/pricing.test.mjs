import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PRICING, foldSession, resolvePricing, validatePricing } from '../lib/index.js'

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

test('rejects overlapping and invalid pricing configuration', () => {
  const overlapping = structuredClone(config)
  overlapping.default.periods.push({ id: 'overlap', name: '重叠', start: '06:00', end: '08:00', rates: {} })
  assert.throws(() => validatePricing(overlapping), /overlapping periods/)
  const badZone = structuredClone(config)
  badZone.timezone = 'Mars/Olympus'
  assert.throws(() => validatePricing(badZone), /IANA time zone/)
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
