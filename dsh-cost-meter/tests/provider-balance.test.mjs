import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collapseBalanceChips,
  collectProviderBalances,
  gatewayOrigin,
  groupProviderBalanceTargetsByOrigin,
  listProviderBalanceTargets,
  modelsURL,
  parseProviderBalance,
  probeProviderAvailability,
  probeProviderBalance,
  routesForProvider,
  shouldRemoveUnavailableProvider,
  usageURL,
  walletHref,
} from '../lib/index.js'

test('usageURL appends /usage without duplicating /v1', () => {
  assert.equal(usageURL('https://sub.wanzhao.top/v1'), 'https://sub.wanzhao.top/v1/usage')
  assert.equal(usageURL('https://sub.wanzhao.top/v1/'), 'https://sub.wanzhao.top/v1/usage')
  assert.equal(usageURL('https://xindu.xyz'), 'https://xindu.xyz/v1/usage')
})

test('modelsURL appends /models without duplicating /v1', () => {
  assert.equal(modelsURL('https://sub.wanzhao.top/v1'), 'https://sub.wanzhao.top/v1/models')
  assert.equal(modelsURL('https://sub.wanzhao.top/v1/'), 'https://sub.wanzhao.top/v1/models')
  assert.equal(modelsURL('https://xindu.xyz'), 'https://xindu.xyz/v1/models')
})

test('shouldRemoveUnavailableProvider requires a down API and remaining funds', () => {
  assert.equal(shouldRemoveUnavailableProvider(false, 12.5), true)
  assert.equal(shouldRemoveUnavailableProvider(false, 0), false)
  assert.equal(shouldRemoveUnavailableProvider(false, null), false)
  assert.equal(shouldRemoveUnavailableProvider(true, 12.5), false)
})

test('routesForProvider lists only that provider id', () => {
  assert.deepEqual(routesForProvider({
    'gpt-008/gpt-5.6-terra': {},
    'gpt-008/gpt-5.6-sol': {},
    'grok/grok-4.6': {},
  }, 'gpt-008'), ['gpt-008/gpt-5.6-terra', 'gpt-008/gpt-5.6-sol'])
  assert.deepEqual(routesForProvider({ 'grok/grok-4.6': {} }, 'gpt-008'), [])
})

test('gatewayOrigin keeps scheme and host, drops path', () => {
  assert.equal(gatewayOrigin('https://sub.wanzhao.top/v1'), 'https://sub.wanzhao.top')
  assert.equal(gatewayOrigin('https://xindu.xyz'), 'https://xindu.xyz')
  assert.equal(gatewayOrigin('not a url'), null)
})

test('lists one target per provider id that has a credential and origin', () => {
  const targets = listProviderBalanceTargets({
    wz: { displayName: 'wanzhao', baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'WZ_API_KEY' },
    grok: { baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'GROK_API_KEY' },
    skip: { baseURL: 'https://sub.wanzhao.top/v1' },
    bad: { baseURL: 'not a url', apiKeyEnv: 'BAD_KEY' },
  })
  assert.deepEqual(targets.map(item => item.provider), ['grok', 'wz'])
})

test('groups providers that share an origin', () => {
  const groups = groupProviderBalanceTargetsByOrigin(listProviderBalanceTargets({
    grok: { baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'GROK_API_KEY' },
    wz: { displayName: 'wanzhao', baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'WZ_API_KEY' },
    xindu: { baseURL: 'https://xindu.xyz/v1', apiKeyEnv: 'DS_XINDU_API_KEY' },
  }))
  assert.deepEqual(groups.map(group => ({
    origin: group.origin,
    providers: group.targets.map(item => item.provider),
  })), [
    { origin: 'https://sub.wanzhao.top', providers: ['grok', 'wz'] },
    { origin: 'https://xindu.xyz', providers: ['xindu'] },
  ])
})

test('parses wallet, remaining, and quota remaining', () => {
  assert.deepEqual(parseProviderBalance({ mode: 'unrestricted', balance: 12.5, remaining: 12.5, unit: 'USD' }), {
    remaining: 12.5, unit: 'USD', mode: 'unrestricted',
  })
  assert.deepEqual(parseProviderBalance({ mode: 'quota_limited', remaining: 3, unit: 'USD' }), {
    remaining: 3, unit: 'USD', mode: 'quota_limited',
  })
  assert.deepEqual(parseProviderBalance({ quota: { remaining: 1.25, unit: 'CNY' } }), {
    remaining: 1.25, unit: 'CNY', mode: null,
  })
  assert.throws(() => parseProviderBalance({ mode: 'unrestricted' }), /no remaining balance/)
})

test('collects one successful balance per origin and labels the chip with the host', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.authorization })
    const remaining = String(url).includes('xindu') ? 6.1 : 66.49
    return new Response(JSON.stringify({ mode: 'unrestricted', balance: remaining, remaining, unit: 'USD' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const rows = await collectProviderBalances({
    providers: {
      grok: { baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'GROK_API_KEY' },
      wz: { displayName: 'wanzhao', baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'WZ_API_KEY' },
      xindu: { baseURL: 'https://xindu.xyz/v1', apiKeyEnv: 'DS_XINDU_API_KEY' },
    },
    credentials: {
      async resolve() {
        return { value: 'key' }
      },
    },
    fetchImpl,
    now: () => 1,
  })
  assert.equal(seen.length, 2)
  assert.deepEqual(rows.map(item => ({ name: item.name, origin: item.origin, remaining: item.remaining })), [
    { name: 'sub.wanzhao.top', origin: 'https://sub.wanzhao.top', remaining: 66.49 },
    { name: 'xindu.xyz', origin: 'https://xindu.xyz', remaining: 6.1 },
  ])
})

test('tries the next credential on the same origin after a failure', async () => {
  const seen = []
  const fetchImpl = async (_url, init) => {
    seen.push(init.headers.authorization)
    if (init.headers.authorization === 'Bearer grok-key') throw new Error('network')
    return new Response(JSON.stringify({ mode: 'unrestricted', balance: 19.5, remaining: 19.5, unit: 'USD' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const rows = await collectProviderBalances({
    providers: {
      grok: { baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'GROK_API_KEY' },
      wz: { displayName: 'wanzhao', baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'WZ_API_KEY' },
    },
    credentials: {
      async resolve(ref) {
        return { value: ref === 'WZ_API_KEY' ? 'wz-key' : 'grok-key' }
      },
    },
    fetchImpl,
    now: () => 1,
  })
  assert.deepEqual(seen, ['Bearer grok-key', 'Bearer wz-key'])
  assert.deepEqual(rows.map(item => ({ origin: item.origin, remaining: item.remaining })), [
    { origin: 'https://sub.wanzhao.top', remaining: 19.5 },
  ])
})

test('walletHref accepts only http(s) origins', () => {
  assert.equal(walletHref('https://sub.wanzhao.top/v1'), 'https://sub.wanzhao.top')
  assert.equal(walletHref('http://127.0.0.1:8080'), 'http://127.0.0.1:8080')
  assert.equal(walletHref('ftp://xindu.xyz'), undefined)
  assert.equal(walletHref('not a url'), undefined)
  assert.equal(walletHref(undefined), undefined)
})

test('collapseBalanceChips keeps one chip per openable origin', () => {
  const chips = collapseBalanceChips([
    { provider: 'diffusion', name: 'diffusion', remaining: 0, unit: 'USD', mode: null, observedAt: 1 },
    { provider: 'gpt-008', name: 'gpt-008', remaining: 66.12, unit: 'USD', mode: 'unrestricted', observedAt: 2 },
    { provider: 'gpt-012', name: 'gpt-012', origin: 'https://sub.wanzhao.top/v1', remaining: 66.12, unit: 'USD', mode: 'unrestricted', observedAt: 3 },
    { provider: 'grok', name: 'grok', origin: 'https://sub.wanzhao.top', remaining: 65.36, unit: 'USD', mode: 'unrestricted', observedAt: 4 },
    { provider: 'xindu', name: 'ds-xindu', origin: 'https://xindu.xyz', remaining: 5.94, unit: 'USD', mode: 'unrestricted', observedAt: 5 },
    { provider: 'fail', name: 'fail', origin: 'https://xindu.xyz', remaining: null, unit: 'USD', mode: null, error: 'HTTP 401', observedAt: 6 },
  ])
  assert.deepEqual(chips.map(item => ({ name: item.name, remaining: item.remaining, origin: item.origin })), [
    { name: 'sub.wanzhao.top', remaining: 66.12, origin: 'https://sub.wanzhao.top' },
    { name: 'xindu.xyz', remaining: 5.94, origin: 'https://xindu.xyz' },
  ])
})

test('probeProviderAvailability is one models request per provider', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })
  }
  const target = { provider: 'gpt-008', name: 'gpt-008', baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'GPT_008_API_KEY' }
  const result = await probeProviderAvailability(target, { async resolve() { return { value: 'key' } } }, fetchImpl)
  assert.deepEqual(seen, ['https://sub.wanzhao.top/v1/models'])
  assert.deepEqual(result, { provider: 'gpt-008', available: false, error: 'HTTP 503' })
})

test('probeProviderBalance reads remaining for one provider credential', async () => {
  const target = { provider: 'gpt-008', name: 'gpt-008', baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'GPT_008_API_KEY' }
  const row = await probeProviderBalance(target, { async resolve() { return { value: 'key' } } }, async () => new Response(JSON.stringify({ remaining: 12.5, unit: 'USD' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }), () => 9)
  assert.equal(row.remaining, 12.5)
  assert.equal(row.provider, 'gpt-008')
})

test('omits an origin when every credential fails', async () => {
  const rows = await collectProviderBalances({
    providers: {
      grok: { baseURL: 'https://sub.wanzhao.top/v1', apiKeyEnv: 'GROK_API_KEY' },
      xindu: { baseURL: 'https://xindu.xyz/v1', apiKeyEnv: 'DS_XINDU_API_KEY' },
    },
    credentials: {
      async resolve(ref) {
        return ref === 'DS_XINDU_API_KEY' ? { value: 'xindu-key' } : undefined
      },
    },
    fetchImpl: async () => new Response(JSON.stringify({ mode: 'unrestricted', balance: 8, remaining: 8, unit: 'USD' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    now: () => 1,
  })
  assert.deepEqual(rows.map(item => item.origin), ['https://xindu.xyz'])
})
