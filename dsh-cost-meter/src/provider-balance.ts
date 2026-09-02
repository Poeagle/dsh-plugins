/** Live per-provider wallet/quota remaining from Sub2API-compatible `/v1/usage`. */

import { mapWithConcurrency } from './session-table.js'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 64 * 1024
const DEFAULT_CONCURRENCY = 4

interface CredentialsFace {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

export interface ProviderSource {
  displayName?: string
  baseURL?: string
  apiKeyEnv?: string
}

export interface ProviderBalanceTarget {
  provider: string
  name: string
  baseURL: string
  apiKeyEnv: string
}

export interface ProviderBalance {
  provider: string
  name: string
  origin?: string
  remaining: number | null
  unit: string
  mode: string | null
  error?: string
  observedAt: number
}

/** Build a `/v1/{leaf}` endpoint without duplicating `/v1`. */
function v1URL(baseURL: string, leaf: string): string {
  const url = new URL(baseURL)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = `${path.endsWith('/v1') ? path : `${path}/v1`}/${leaf}`.replace(/\/{2,}/g, '/')
  return url.toString()
}

/** Build the key-scoped usage endpoint without duplicating `/v1`. */
export function usageURL(baseURL: string): string {
  return v1URL(baseURL, 'usage')
}

/** Build the provider-level models endpoint without duplicating `/v1`. */
export function modelsURL(baseURL: string): string {
  return v1URL(baseURL, 'models')
}

/** True when the provider API is down and that same credential still has remaining funds. */
export function shouldRemoveUnavailableProvider(available: boolean, remaining: number | null): boolean {
  return available === false && remaining !== null && remaining > 0
}

/** Pricing routes owned by one provider id. */
export function routesForProvider(models: Record<string, unknown>, provider: string): string[] {
  const prefix = `${provider}/`
  return Object.keys(models).filter(key => key.startsWith(prefix))
}

/** Origin used to collapse providers that share a gateway host. */
export function gatewayOrigin(baseURL: string): string | null {
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function firstFinite(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = finiteNumber(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/**
 * Read remaining funds from a Sub2API `/v1/usage` body.
 * Wallet mode exposes `balance`; quota and subscription modes expose `remaining`.
 */
export function parseProviderBalance(value: unknown): { remaining: number; unit: string; mode: string | null } {
  if (value === null || typeof value !== 'object') throw new Error('invalid usage response')
  const body = value as Record<string, unknown>
  const quota = body.quota !== null && typeof body.quota === 'object' ? body.quota as Record<string, unknown> : undefined
  const remaining = firstFinite(body.balance, body.remaining, quota?.remaining)
  if (remaining === undefined) throw new Error('usage response has no remaining balance')
  const unit = typeof body.unit === 'string' && body.unit !== ''
    ? body.unit
    : typeof quota?.unit === 'string' && quota.unit !== ''
      ? quota.unit
      : 'USD'
  return { remaining, unit, mode: typeof body.mode === 'string' ? body.mode : null }
}

/** One target per provider id that has a base URL and credential. */
export function listProviderBalanceTargets(providers: Record<string, ProviderSource> | undefined): ProviderBalanceTarget[] {
  const out: ProviderBalanceTarget[] = []
  for (const [id, source] of Object.entries(providers ?? {})) {
    if (id.trim() === '' || source.baseURL === undefined || source.apiKeyEnv === undefined || source.apiKeyEnv === '') continue
    if (gatewayOrigin(source.baseURL) === null) continue
    const name = typeof source.displayName === 'string' && source.displayName.trim() !== '' ? source.displayName.trim() : id
    out.push({ provider: id, name, baseURL: source.baseURL, apiKeyEnv: source.apiKeyEnv })
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider))
}

/** Collapse configured providers onto one probe group per gateway origin. */
export function groupProviderBalanceTargetsByOrigin(
  targets: readonly ProviderBalanceTarget[],
): Array<{ origin: string; targets: ProviderBalanceTarget[] }> {
  const groups = new Map<string, ProviderBalanceTarget[]>()
  for (const target of targets) {
    const origin = gatewayOrigin(target.baseURL)
    if (origin === null) continue
    const list = groups.get(origin)
    if (list === undefined) groups.set(origin, [target])
    else list.push(target)
  }
  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([origin, grouped]) => ({ origin, targets: grouped }))
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (reader === undefined) return response.json()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('usage response exceeds 64 KiB')
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

/** Remaining balance for one provider credential. Failures keep `remaining: null`. */
export async function probeProviderBalance(
  target: ProviderBalanceTarget,
  credentials: CredentialsFace | undefined,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<ProviderBalance> {
  const observedAt = now()
  const failed = (error: string): ProviderBalance => ({
    provider: target.provider,
    name: target.name,
    origin: gatewayOrigin(target.baseURL) ?? target.baseURL,
    remaining: null,
    unit: 'USD',
    mode: null,
    error,
    observedAt,
  })
  const credential = await credentials?.resolve(target.apiKeyEnv)
  if (credential === undefined || credential.value === '') return failed(`credential ${target.apiKeyEnv} is unavailable`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(usageURL(target.baseURL), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${credential.value}` },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) return failed(`HTTP ${response.status}`)
    const parsed = parseProviderBalance(await readBoundedJson(response))
    const origin = gatewayOrigin(target.baseURL) ?? target.baseURL
    return {
      provider: target.provider,
      name: new URL(origin).host,
      origin,
      remaining: parsed.remaining,
      unit: parsed.unit,
      mode: parsed.mode,
      observedAt: now(),
    }
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timeout)
  }
}

/** Provider-level `/v1/models` availability for one credential. */
export async function probeProviderAvailability(
  target: ProviderBalanceTarget,
  credentials: CredentialsFace | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ provider: string; available: boolean; error?: string }> {
  const credential = await credentials?.resolve(target.apiKeyEnv)
  if (credential === undefined || credential.value === '') {
    return { provider: target.provider, available: false, error: `credential ${target.apiKeyEnv} is unavailable` }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(modelsURL(target.baseURL), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${credential.value}` },
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.ok) return { provider: target.provider, available: true }
    return { provider: target.provider, available: false, error: `HTTP ${response.status}` }
  } catch (error) {
    return { provider: target.provider, available: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timeout)
  }
}

function succeeded(row: ProviderBalance): boolean {
  return row.remaining !== null && row.error === undefined
}

function gatewayHost(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/** True when `origin` is an http(s) wallet URL that can be opened. */
export function walletHref(origin: string | undefined): string | undefined {
  if (origin === undefined || origin === '') return undefined
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * One chip per gateway origin. Failed probes and rows without an openable
 * origin are dropped so a chip never appears without a host and href.
 */
export function collapseBalanceChips(rows: readonly ProviderBalance[]): ProviderBalance[] {
  const order: string[] = []
  const byOrigin = new Map<string, ProviderBalance>()
  for (const row of rows) {
    if (!succeeded(row)) continue
    const origin = walletHref(row.origin)
    if (origin === undefined || byOrigin.has(origin)) continue
    order.push(origin)
    byOrigin.set(origin, { ...row, origin, name: gatewayHost(origin) })
  }
  return order.map(origin => byOrigin.get(origin)!)
}

/** Fetch remaining balance once per gateway origin. Failed origins are omitted. */
export async function collectProviderBalances(input: {
  providers: Record<string, ProviderSource> | undefined
  credentials?: CredentialsFace
  fetchImpl?: typeof fetch
  concurrency?: number
  now?: () => number
}): Promise<ProviderBalance[]> {
  const groups = groupProviderBalanceTargetsByOrigin(listProviderBalanceTargets(input.providers))
  if (groups.length === 0) return []
  const fetchImpl = input.fetchImpl ?? fetch
  const now = input.now ?? Date.now
  const rows = await mapWithConcurrency(groups, input.concurrency ?? DEFAULT_CONCURRENCY, async group => {
    for (const target of group.targets) {
      const row = await probeProviderBalance(target, input.credentials, fetchImpl, now)
      if (succeeded(row)) return { ...row, origin: group.origin, name: new URL(group.origin).host }
    }
    return null
  })
  const out: ProviderBalance[] = []
  for (const row of rows) {
    if (row !== null) out.push(row)
  }
  return out
}
