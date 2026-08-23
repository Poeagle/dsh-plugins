import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PRICING,
  collectSessionCosts,
  filterSessionRows,
  querySessionRows,
  sortSessionRows,
} from '../lib/index.js'

const peak = Date.parse('2026-01-01T02:00:00Z')
const later = Date.parse('2026-01-01T16:00:00Z')

function usageEvents(provider, model, time, tokens) {
  return [
    { type: 'request/header', time, data: { header: { config: { provider, model } } } },
    { type: 'assistant/message', time, data: { turn: 1, step: 1, usage: tokens } },
  ]
}

function queryFace(sessions) {
  return {
    async listSessions() {
      return sessions.map(session => ({ header: session.header }))
    },
    async readSession(id) {
      const session = sessions.find(item => item.header.id === id)
      if (!session) throw new Error(`missing ${id}`)
      if (session.fail) throw new Error(`unreadable ${id}`)
      return { events: session.events }
    },
  }
}

const parentEvents = usageEvents('vendor', 'model-a', peak, { inputTokens: 1_000_000, outputTokens: 500_000 })
const childEvents = usageEvents('vendor', 'model-b', later, { inputTokens: 2_000_000, cacheReadTokens: 1_000_000, outputTokens: 250_000 })

test('collectSessionCosts folds each listed session independently', async () => {
  const rows = await collectSessionCosts(queryFace([
    { header: { id: 'parent', origin: 'user' }, events: parentEvents },
    { header: { id: 'child', parentSession: 'parent', origin: 'subagent' }, events: childEvents },
  ]), DEFAULT_PRICING)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].sessionId, 'parent')
  assert.equal(rows[0].parentSession, null)
  assert.equal(rows[0].origin, 'user')
  assert.equal(rows[0].cost.inputTokens, 1_000_000)
  assert.equal(rows[0].cost.outputTokens, 500_000)
  assert.equal(rows[0].cost.route, 'vendor/model-a')
  assert.equal(rows[1].sessionId, 'child')
  assert.equal(rows[1].parentSession, 'parent')
  assert.equal(rows[1].origin, 'subagent')
  assert.equal(rows[1].cost.inputTokens, 2_000_000)
  assert.equal(rows[1].cost.cacheReadTokens, 1_000_000)
  assert.equal(rows[1].cost.outputTokens, 250_000)
  assert.equal(rows[1].cost.route, 'vendor/model-b')
  assert.notEqual(rows[0].cost.hourly[0]?.hour, undefined)
  assert.notDeepEqual(rows[0].cost.hourly, rows[1].cost.hourly)
  assert.equal(rows[0].cost.hourly.every(row => row.model === 'model-a'), true)
  assert.equal(rows[1].cost.hourly.every(row => row.model === 'model-b'), true)
})

test('collectSessionCosts skips unreadable sessions and duplicate ids', async () => {
  const rows = await collectSessionCosts(queryFace([
    { header: { id: 'ok', origin: 'user' }, events: parentEvents },
    { header: { id: 'bad', origin: 'user' }, events: [], fail: true },
    { header: { id: 'ok', origin: 'duplicate' }, events: childEvents },
  ]), DEFAULT_PRICING)
  assert.deepEqual(rows.map(row => row.sessionId), ['ok'])
  assert.equal(rows[0].origin, 'user')
  assert.equal(rows[0].cost.route, 'vendor/model-a')
})

test('collectSessionCosts returns an empty list without sessionQuery', async () => {
  assert.deepEqual(await collectSessionCosts(undefined, DEFAULT_PRICING), [])
})

const tableRows = [
  {
    sessionId: 'sess-b',
    parentSession: 'root',
    origin: 'subagent',
    cost: {
      cost: 3,
      inputTokens: 30,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      outputTokens: 8,
      route: 'wz/gpt-5.6-terra',
      hourly: [{ provider: 'wz', model: 'gpt-5.6-terra' }],
    },
  },
  {
    sessionId: 'sess-a',
    parentSession: null,
    origin: 'user',
    cost: {
      cost: 9,
      inputTokens: 10,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      outputTokens: 40,
      route: 'ds/deepseek-v4-flash',
      hourly: [{ provider: 'ds', model: 'deepseek-v4-flash' }],
    },
  },
  {
    sessionId: 'sess-c',
    parentSession: 'root',
    origin: 'user',
    cost: {
      cost: 1,
      inputTokens: 50,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
      outputTokens: 4,
      route: 'wz/gpt-5.6-terra',
      hourly: [{ provider: 'wz', model: 'gpt-5.6-terra' }],
    },
  },
]

test('sorts session rows by cost and tokens', () => {
  assert.deepEqual(sortSessionRows(tableRows, { key: 'cost', dir: 'asc' }).map(row => row.sessionId), ['sess-c', 'sess-b', 'sess-a'])
  assert.deepEqual(sortSessionRows(tableRows, { key: 'cost', dir: 'desc' }).map(row => row.sessionId), ['sess-a', 'sess-b', 'sess-c'])
  assert.deepEqual(sortSessionRows(tableRows, { key: 'inputTokens', dir: 'asc' }).map(row => row.sessionId), ['sess-a', 'sess-b', 'sess-c'])
  assert.deepEqual(sortSessionRows(tableRows, { key: 'cacheReadTokens', dir: 'desc' }).map(row => row.sessionId), ['sess-a', 'sess-b', 'sess-c'])
  assert.deepEqual(sortSessionRows(tableRows, { key: 'outputTokens', dir: 'asc' }).map(row => row.sessionId), ['sess-c', 'sess-b', 'sess-a'])
  assert.deepEqual(sortSessionRows(tableRows, { key: 'totalTokens', dir: 'desc' }).map(row => row.sessionId), ['sess-a', 'sess-c', 'sess-b'])
})

test('filters session rows by text, origin, and route', () => {
  assert.deepEqual(filterSessionRows(tableRows, { sessionId: 'sess-a', origin: '', parentSession: '', route: '' }).map(row => row.sessionId), ['sess-a'])
  assert.deepEqual(filterSessionRows(tableRows, { sessionId: '', origin: 'user', parentSession: '', route: '' }).map(row => row.sessionId), ['sess-a', 'sess-c'])
  assert.deepEqual(filterSessionRows(tableRows, { sessionId: '', origin: '', parentSession: 'root', route: '' }).map(row => row.sessionId), ['sess-b', 'sess-c'])
  assert.deepEqual(filterSessionRows(tableRows, { sessionId: '', origin: '', parentSession: '', route: 'wz/gpt-5.6-terra' }).map(row => row.sessionId), ['sess-b', 'sess-c'])
  assert.deepEqual(querySessionRows(tableRows, { sessionId: '', origin: 'user', parentSession: '', route: '', minCost: 2 }, { key: 'cost', dir: 'asc' }).map(row => row.sessionId), ['sess-a'])
})
