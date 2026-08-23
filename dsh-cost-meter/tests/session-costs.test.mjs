import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PRICING,
  SessionFoldCache,
  collectSessionCosts,
  filterHourlyEntries,
  filterSessionRows,
  flattenHourlyEntries,
  foldSession,
  localDateOfHour,
  logFingerprint,
  mapWithConcurrency,
  mergeListedSessionCost,
  pricingFingerprint,
  queryHourlyOverview,
  querySessionRows,
  sharedContextSurcharge,
  sortSessionRows,
  sumHourlySlices,
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

test('collectSessionCosts returns an empty list when listing sessions fails', async () => {
  assert.deepEqual(await collectSessionCosts({
    async listSessions() { throw new Error('listing failed') },
    async readSession() { throw new Error('should not read') },
  }, DEFAULT_PRICING), [])
})

test('own-fold cache reuses unchanged historical sessions and skips reread', async () => {
  let reads = 0
  const sessions = [
    { header: { id: 'hist', origin: 'user' }, events: parentEvents },
    { header: { id: 'live', origin: 'user' }, events: childEvents },
  ]
  const query = {
    async listSessions() {
      return sessions.map(session => ({ header: session.header }))
    },
    async readSession(id) {
      reads += 1
      const session = sessions.find(item => item.header.id === id)
      if (!session) throw new Error(`missing ${id}`)
      return { events: session.events }
    },
  }
  const liveMap = { get(id) { return id === 'live' ? { events: childEvents } : undefined } }
  const store = new SessionFoldCache()
  const first = await collectSessionCosts(query, DEFAULT_PRICING, store, liveMap)
  assert.equal(reads, 1)
  assert.equal(store.stats.misses, 2)
  assert.equal(store.stats.hits, 0)
  const second = await collectSessionCosts(query, DEFAULT_PRICING, store, liveMap)
  assert.equal(reads, 1)
  assert.equal(store.stats.hits, 2)
  assert.equal(store.stats.misses, 2)
  assert.equal(second[0].cost.cost, first[0].cost.cost)
  assert.equal(second[1].cost.cost, first[1].cost.cost)
})

test('own-fold cache invalidates on pricing change, live rewrite, and deleted sessions', async () => {
  const keep = { header: { id: 'keep', origin: 'user' }, events: parentEvents }
  const gone = { header: { id: 'gone', origin: 'user' }, events: childEvents }
  const listed = [keep, gone]
  const query = {
    async listSessions() {
      return listed.map(session => ({ header: session.header }))
    },
    async readSession(id) {
      const session = listed.find(item => item.header.id === id)
      if (!session) throw new Error(`missing ${id}`)
      return { events: session.events }
    },
  }
  const liveMap = {
    get(id) {
      return id === 'keep' ? { events: keep.events } : undefined
    },
  }
  const store = new SessionFoldCache()
  const first = await collectSessionCosts(query, DEFAULT_PRICING, store, liveMap)
  assert.equal(first.length, 2)
  assert.equal(store.size, 2)
  listed.pop()
  keep.events = usageEvents('vendor', 'model-a', peak, { inputTokens: 2_000_000, outputTokens: 500_000 })
  const afterRewrite = await collectSessionCosts(query, DEFAULT_PRICING, store, liveMap)
  assert.equal(afterRewrite.length, 1)
  assert.equal(store.size, 1)
  assert.equal(afterRewrite[0].cost.inputTokens, 2_000_000)
  const cheaper = structuredClone(DEFAULT_PRICING)
  cheaper.default.rates.input = 0.5
  const afterPrice = await collectSessionCosts(query, cheaper, store, liveMap)
  assert.equal(afterPrice[0].cost.inputCost, 1)
  assert.equal(afterRewrite[0].cost.inputCost, 2)
  assert.notEqual(pricingFingerprint(DEFAULT_PRICING), pricingFingerprint(cheaper))
})

test('log fingerprint changes when later usage replaces the same step', () => {
  const first = [
    { type: 'request/header', time: 0, data: { header: { config: { provider: 'vendor', model: 'a' } } } },
    { type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 300_000, outputTokens: 10 } } },
  ]
  const replaced = [
    first[0],
    { type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 100_000, outputTokens: 10 } } },
  ]
  assert.notEqual(logFingerprint(first), logFingerprint(replaced))
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

test('mergeListedSessionCost keeps listing metadata with an independent fold', () => {
  const row = mergeListedSessionCost(
    { sessionId: 'child', parentSessionId: 'parent', origin: 'subagent' },
    { cost: 3, inputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 0, outputTokens: 4, route: 'wz/gpt-5.6-terra' },
  )
  assert.deepEqual(row, {
    sessionId: 'child',
    parentSession: 'parent',
    origin: 'subagent',
    cost: { cost: 3, inputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 0, outputTokens: 4, route: 'wz/gpt-5.6-terra' },
  })
})

test('mapWithConcurrency preserves order and bounds in-flight work', async () => {
  let inflight = 0
  let peak = 0
  const values = await mapWithConcurrency([3, 1, 2, 4], 2, async (value) => {
    inflight += 1
    peak = Math.max(peak, inflight)
    await new Promise(resolve => setTimeout(resolve, 5))
    inflight -= 1
    return value * 10
  })
  assert.deepEqual(values, [30, 10, 20, 40])
  assert.equal(peak <= 2, true)
})

function localHour(year, month, day, hour) {
  const date = new Date(year, month - 1, day, hour, 0, 0, 0)
  const label = `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59`
  return { hour: date.toISOString(), hourLabel: label }
}

test('groups filtered hourly entries by date and hour', () => {
  const morning = localHour(2026, 8, 23, 9)
  const midnight = localHour(2026, 8, 22, 0)
  const rows = [
    {
      sessionId: 'sess-a',
      parentSession: null,
      origin: 'user',
      cost: {
        cost: 3,
        inputTokens: 10,
        cacheReadTokens: 2,
        cacheWriteTokens: 0,
        outputTokens: 4,
        hourly: [{
          ...morning,
          turns: 1,
          steps: 2,
          toolCalls: 0,
          inputTokens: 10,
          cacheReadTokens: 2,
          cacheWriteTokens: 0,
          outputTokens: 4,
          inputCost: 1,
          cacheReadCost: 0.1,
          cacheWriteCost: 0,
          outputCost: 2,
          cost: 3.1,
          cacheRate: 0.125,
          provider: 'wz',
          model: 'gpt-5.6-terra',
          periodName: null,
        }],
      },
    },
    {
      sessionId: 'sess-b',
      parentSession: 'sess-a',
      origin: 'subagent',
      cost: {
        cost: 1,
        inputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        hourly: [{
          ...morning,
          turns: 1,
          steps: 1,
          toolCalls: 1,
          inputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1,
          inputCost: 0.5,
          cacheReadCost: 0,
          cacheWriteCost: 0,
          outputCost: 0.5,
          cost: 1,
          cacheRate: 0,
          provider: 'ds',
          model: 'deepseek-v4-flash',
          periodName: null,
        }, {
          ...midnight,
          turns: 1,
          steps: 1,
          toolCalls: 0,
          inputTokens: 8,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 2,
          inputCost: 0.8,
          cacheReadCost: 0,
          cacheWriteCost: 0,
          outputCost: 0.4,
          cost: 1.2,
          cacheRate: 0,
          provider: 'ds',
          model: 'deepseek-v4-flash',
          periodName: null,
        }],
      },
    },
  ]
  const morningGroups = queryHourlyOverview(rows, { date: '', hour: morning.hourLabel, sessionId: '', origin: '', route: '' })
  assert.equal(morningGroups.length, 1)
  assert.equal(morningGroups[0].sessions.length, 2)
  assert.equal(morningGroups[0].totals.cost, 4.1)
  assert.equal(morningGroups[0].totals.inputTokens, 15)
  const oneDay = queryHourlyOverview(rows, { date: '2026-08-23', hour: '', sessionId: '', origin: '', route: '' })
  assert.deepEqual(oneDay.map(group => group.hourLabel), [morning.hourLabel])
  const oneRoute = queryHourlyOverview(rows, { date: '', hour: '', sessionId: '', origin: '', route: 'ds/deepseek-v4-flash' })
  assert.equal(oneRoute.length, 2)
  assert.equal(oneRoute.every(group => group.sessions.every(item => item.entry.model === 'deepseek-v4-flash')), true)
})

test('filters session rows by text, origin, and route', () => {
  assert.deepEqual(filterSessionRows(tableRows, { sessionId: 'sess-a', origin: '', parentSession: '', route: '' }).map(row => row.sessionId), ['sess-a'])
  assert.deepEqual(filterSessionRows(tableRows, { sessionId: '', origin: 'user', parentSession: '', route: '' }).map(row => row.sessionId), ['sess-a', 'sess-c'])
  assert.deepEqual(filterSessionRows(tableRows, { sessionId: '', origin: '', parentSession: 'root', route: '' }).map(row => row.sessionId), ['sess-b', 'sess-c'])
  assert.deepEqual(filterSessionRows(tableRows, { sessionId: '', origin: '', parentSession: '', route: 'wz/gpt-5.6-terra' }).map(row => row.sessionId), ['sess-b', 'sess-c'])
  assert.deepEqual(querySessionRows(tableRows, { sessionId: '', origin: 'user', parentSession: '', route: '', minCost: 2 }, { key: 'cost', dir: 'asc' }).map(row => row.sessionId), ['sess-a'])
})

function mergeCostInto(target, cost) {
  target.cost += cost.cost
  target.inputCost += cost.inputCost
  target.cacheReadCost += cost.cacheReadCost
  target.cacheWriteCost += cost.cacheWriteCost
  target.outputCost += cost.outputCost
  target.inputTokens += cost.inputTokens
  target.cacheReadTokens += cost.cacheReadTokens
  target.cacheWriteTokens += cost.cacheWriteTokens
  target.outputTokens += cost.outputTokens
}

function sessionCostLike(primary, children) {
  const out = structuredClone(primary)
  out.subagents = structuredClone(children)
  for (const child of children) mergeCostInto(out, child)
  return out
}

function totalsOf(slices) {
  return slices.reduce((acc, row) => {
    acc.cost += row.cost
    acc.inputTokens += row.inputTokens
    acc.cacheReadTokens += row.cacheReadTokens
    acc.cacheWriteTokens += row.cacheWriteTokens
    acc.outputTokens += row.outputTokens
    return acc
  }, { cost: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
}

test('hourly overview uses each session own fold and does not inherit merged parent totals', async () => {
  const sameHour = Date.parse('2026-08-23T01:00:00Z')
  const laterHour = Date.parse('2026-08-23T03:00:00Z')
  const parentFold = foldSession(usageEvents('wz', 'gpt-5.6-terra', sameHour, {
    inputTokens: 1_000_000, cacheReadTokens: 2_000_000, outputTokens: 100_000,
  }), DEFAULT_PRICING)
  const childFold = foldSession(usageEvents('ds', 'deepseek-v4-flash', sameHour, {
    inputTokens: 500_000, outputTokens: 50_000,
  }), DEFAULT_PRICING)
  const otherFold = foldSession(usageEvents('grok', 'grok-4.6', laterHour, {
    inputTokens: 250_000, outputTokens: 25_000,
  }), DEFAULT_PRICING)
  const mergedParent = sessionCostLike(parentFold, [{ ...childFold, sessionId: 'child', children: [] }])

  assert.equal(mergedParent.cost, parentFold.cost + childFold.cost)
  assert.equal(mergedParent.inputTokens, parentFold.inputTokens + childFold.inputTokens)
  assert.deepEqual(mergedParent.hourly.map(row => row.model), parentFold.hourly.map(row => row.model))
  assert.equal(totalsOf(mergedParent.hourly).cost, parentFold.cost)
  assert.notEqual(mergedParent.cost, totalsOf(mergedParent.hourly).cost)

  const listed = [
    mergeListedSessionCost({ sessionId: 'parent', origin: 'user' }, mergedParent),
    mergeListedSessionCost({ sessionId: 'child', parentSessionId: 'parent', origin: 'subagent' }, childFold),
    mergeListedSessionCost({ sessionId: 'other' }, otherFold),
  ]
  const groups = queryHourlyOverview(listed, { date: '', hour: '', sessionId: '', origin: '', route: '' })
  const allHourly = groups.flatMap(group => group.sessions.map(item => item.entry))
  const overview = totalsOf(allHourly)
  const own = totalsOf([...parentFold.hourly, ...childFold.hourly, ...otherFold.hourly])

  assert.equal(overview.cost, own.cost)
  assert.equal(overview.inputTokens, own.inputTokens)
  assert.equal(overview.cacheReadTokens, own.cacheReadTokens)
  assert.equal(overview.outputTokens, own.outputTokens)
  assert.notEqual(overview.cost, mergedParent.cost + childFold.cost + otherFold.cost)
  assert.equal(overview.cost, parentFold.cost + childFold.cost + otherFold.cost)

  const firstHour = groups.find(group => group.sessions.some(item => item.sessionId === 'parent'))
  assert.equal(firstHour.sessions.map(item => item.sessionId).sort().join(','), 'child,parent')
  assert.equal(firstHour.totals.cost, parentFold.cost + childFold.cost)
  assert.equal(firstHour.totals.inputTokens, parentFold.inputTokens + childFold.inputTokens)
  assert.equal(firstHour.totals.outputTokens, parentFold.outputTokens + childFold.outputTokens)
  const cacheTokens = firstHour.totals.cacheReadTokens + firstHour.totals.cacheWriteTokens
  const totalTokens = firstHour.totals.inputTokens + cacheTokens + firstHour.totals.outputTokens
  assert.equal(firstHour.totals.cacheRate, cacheTokens / totalTokens)
})

test('hourly overview totals equal the sum of visible group totals after filters', () => {
  const morning = localHour(2026, 8, 23, 9)
  const noon = localHour(2026, 8, 23, 12)
  const yesterday = localHour(2026, 8, 22, 21)
  const slice = (bucket, session, extra) => ({
    sessionId: session,
    origin: extra.origin ?? null,
    parentSession: extra.parentSession ?? null,
    entry: {
      hour: bucket.hour,
      hourLabel: bucket.hourLabel,
      turns: extra.turns ?? 1,
      steps: extra.steps ?? 1,
      toolCalls: extra.toolCalls ?? 0,
      inputTokens: extra.inputTokens,
      cacheReadTokens: extra.cacheReadTokens ?? 0,
      cacheWriteTokens: extra.cacheWriteTokens ?? 0,
      outputTokens: extra.outputTokens,
      inputCost: extra.inputCost,
      cacheReadCost: extra.cacheReadCost ?? 0,
      cacheWriteCost: extra.cacheWriteCost ?? 0,
      outputCost: extra.outputCost,
      cost: extra.inputCost + (extra.cacheReadCost ?? 0) + (extra.cacheWriteCost ?? 0) + extra.outputCost,
      cacheRate: 0,
      provider: extra.provider,
      model: extra.model,
      periodName: extra.periodName ?? null,
    },
  })
  const entries = [
    slice(morning, 'sess-a', { origin: 'user', inputTokens: 10, outputTokens: 2, inputCost: 1, outputCost: 2, provider: 'wz', model: 'gpt-5.6-terra' }),
    slice(morning, 'sess-b', { origin: 'subagent', parentSession: 'sess-a', inputTokens: 5, outputTokens: 1, inputCost: 0.5, outputCost: 0.5, provider: 'ds', model: 'deepseek-v4-flash' }),
    slice(noon, 'sess-a', { origin: 'user', inputTokens: 8, cacheReadTokens: 4, outputTokens: 3, inputCost: 0.8, cacheReadCost: 0.04, outputCost: 1.2, provider: 'wz', model: 'gpt-5.6-terra' }),
    slice(yesterday, 'sess-c', { origin: 'user', inputTokens: 20, outputTokens: 6, inputCost: 2, outputCost: 3, provider: 'grok', model: 'grok-4.6' }),
  ]
  const empty = { date: '', hour: '', sessionId: '', origin: '', route: '' }
  const all = queryHourlyOverview(entries.map(item => ({
    sessionId: item.sessionId,
    parentSession: item.parentSession,
    origin: item.origin,
    cost: { cost: item.entry.cost, inputTokens: item.entry.inputTokens, cacheReadTokens: item.entry.cacheReadTokens, cacheWriteTokens: item.entry.cacheWriteTokens, outputTokens: item.entry.outputTokens, hourly: [item.entry] },
  })), empty)
  const grand = sumHourlySlices(all.flatMap(group => group.sessions.map(item => item.entry)))
  assert.equal(all.length, 3)
  assert.equal(grand.cost, 1 + 2 + 0.5 + 0.5 + 0.8 + 0.04 + 1.2 + 2 + 3)
  assert.equal(grand.inputTokens, 10 + 5 + 8 + 20)
  assert.equal(grand.cacheReadTokens, 4)
  assert.equal(grand.outputTokens, 2 + 1 + 3 + 6)
  assert.equal(grand.cost, all.reduce((sum, group) => sum + group.totals.cost, 0))

  const byDate = filterHourlyEntries(flattenHourlyEntries(all.flatMap(group => group.sessions.map(item => ({
    sessionId: item.sessionId,
    parentSession: item.parentSession,
    origin: item.origin,
    cost: { cost: item.entry.cost, inputTokens: item.entry.inputTokens, cacheReadTokens: item.entry.cacheReadTokens, cacheWriteTokens: item.entry.cacheWriteTokens, outputTokens: item.entry.outputTokens, hourly: [item.entry] },
  })))), { ...empty, date: localDateOfHour(morning.hour) })
  assert.equal(byDate.every(item => localDateOfHour(item.entry.hour) === localDateOfHour(morning.hour)), true)
  assert.equal(byDate.length, 3)

  const byHour = filterHourlyEntries(entries, { ...empty, hour: morning.hourLabel })
  assert.deepEqual(byHour.map(item => item.sessionId).sort(), ['sess-a', 'sess-b'])

  const bySession = filterHourlyEntries(entries, { ...empty, sessionId: 'sess-a' })
  assert.equal(bySession.length, 2)
  assert.equal(bySession.every(item => item.sessionId === 'sess-a'), true)

  const byOrigin = filterHourlyEntries(entries, { ...empty, origin: 'subagent' })
  assert.deepEqual(byOrigin.map(item => item.sessionId), ['sess-b'])

  const byRoute = filterHourlyEntries(entries, { ...empty, route: 'grok/grok-4.6' })
  assert.deepEqual(byRoute.map(item => item.sessionId), ['sess-c'])
})

test('flattenHourlyEntries skips buckets without an hour and keeps independent session rows', () => {
  const morning = localHour(2026, 8, 23, 9)
  const entries = flattenHourlyEntries([
    {
      sessionId: 'ok',
      parentSession: null,
      origin: 'user',
      cost: {
        cost: 1,
        inputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        hourly: [
          { ...morning, provider: 'wz', model: 'gpt-5.6-terra', inputTokens: 1, outputTokens: 1, cost: 1 },
          { provider: 'wz', model: 'missing-hour', inputTokens: 9, outputTokens: 9, cost: 9 },
        ],
      },
    },
    {
      sessionId: 'empty',
      parentSession: null,
      origin: 'user',
      cost: { cost: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, hourly: [] },
    },
  ])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].sessionId, 'ok')
  assert.equal(entries[0].entry.hour, morning.hour)
})

test('sharedContextSurcharge stays silent when an hour mixes charged and uncharged requests', () => {
  assert.deepEqual(sharedContextSurcharge([
    { contextAfterTokens: 200_000, contextMultiplier: 2 },
    { contextAfterTokens: 200_000, contextMultiplier: 2 },
  ]), { afterTokens: 200_000, multiplier: 2 })
  assert.equal(sharedContextSurcharge([
    { contextAfterTokens: null, contextMultiplier: 1 },
    { contextAfterTokens: 200_000, contextMultiplier: 2 },
  ]), null)
  assert.equal(sharedContextSurcharge([]), null)
})

test('mapWithConcurrency treats empty lists and invalid limits as no-op or serial work', async () => {
  assert.deepEqual(await mapWithConcurrency([], 8, async value => value), [])
  const serial = await mapWithConcurrency(['a', 'b'], 0, async value => value.toUpperCase())
  assert.deepEqual(serial, ['A', 'B'])
})
