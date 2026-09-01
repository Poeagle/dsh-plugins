/** Periodic Sub2API key-billing discovery with effective-time multiplier history. */

import type { Context } from '@deepseek-ai/cordis'
import { mapWithConcurrency } from './session-table.js'
import { multiplierOrOne, normalizePricing, type ModelAssignment, type PricingConfig } from './pricing.js'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_SYNC_MULTIPLIER = 100
const BASELINE_EFFECTIVE_AT = 0

interface SettingsScopeFace<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  update(patch: object): Promise<void>
}

interface CredentialsFace {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

interface BillingResponse {
  object?: unknown
  schema_version?: unknown
  billing_scope?: unknown
  group_rate_multiplier?: unknown
  user_rate_multiplier?: unknown
  resolved_rate_multiplier?: unknown
  peak_rate_enabled?: unknown
  effective_rate_multiplier?: unknown
  observed_at?: unknown
}

export interface ProbeResult {
  status: 'ok' | 'unsupported' | 'failed'
  multiplier?: number
  observedAt?: number
  error?: string
}

/** Build the Sub2API key-billing endpoint without duplicating `/v1`. */
export function billingProbeURL(baseURL: string): string {
  const url = new URL(baseURL)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = `${path.endsWith('/v1') ? path : `${path}/v1`}/sub2api/billing`.replace(/\/{2,}/g, '/')
  return url.toString()
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Validate the declared key-level base multiplier returned by a Sub2API upstream. */
export function parseBillingMultiplier(value: unknown): { multiplier: number; observedAt?: number } {
  if (value === null || typeof value !== 'object') throw new Error('invalid billing response')
  const body = value as BillingResponse
  if (body.object !== 'sub2api.key_billing' || body.schema_version !== 1 || body.billing_scope !== 'token') {
    throw new Error('unsupported billing response schema')
  }
  if (!finiteNonNegative(body.group_rate_multiplier) || !finiteNonNegative(body.resolved_rate_multiplier)
    || typeof body.peak_rate_enabled !== 'boolean' || !finiteNonNegative(body.effective_rate_multiplier)) {
    throw new Error('incomplete billing response')
  }
  const expected = body.user_rate_multiplier === undefined ? body.group_rate_multiplier : body.user_rate_multiplier
  if (!finiteNonNegative(expected) || Math.abs(body.resolved_rate_multiplier - expected) > Math.max(1, expected) * 1e-9) {
    throw new Error('inconsistent resolved billing multiplier')
  }
  if (body.resolved_rate_multiplier <= 0 || body.resolved_rate_multiplier > MAX_SYNC_MULTIPLIER) {
    throw new Error(`declared multiplier must be greater than 0 and at most ${MAX_SYNC_MULTIPLIER}`)
  }
  const observedAt = typeof body.observed_at === 'string' ? Date.parse(body.observed_at) : NaN
  return { multiplier: body.resolved_rate_multiplier, observedAt: Number.isFinite(observedAt) ? observedAt : undefined }
}

/** Append a newly observed multiplier without changing pricing before observation time. */
export function assignmentWithObservedMultiplier(assignment: ModelAssignment, multiplier: number, observedAt: number): ModelAssignment {
  const history = [...(assignment.discountMultiplierHistory ?? [])]
  if (history.length === 0) {
    history.push({ effectiveAt: BASELINE_EFFECTIVE_AT, discountMultiplier: multiplierOrOne(assignment.discountMultiplier) })
  }
  const active = history[history.length - 1]?.discountMultiplier ?? multiplierOrOne(assignment.discountMultiplier)
  if (active !== multiplier) history.push({ effectiveAt: Math.max(observedAt, (history[history.length - 1]?.effectiveAt ?? -1) + 1), discountMultiplier: multiplier, source: 'probe' })
  return {
    ...assignment,
    discountMultiplier: multiplier,
    discountMultiplierHistory: history,
    lastProbedAt: Math.max(observedAt, assignment.lastProbedAt ?? 0),
  }
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
      throw new Error('billing response exceeds 64 KiB')
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

async function probe(baseURL: string, apiKeyEnv: string, credentials: CredentialsFace | undefined): Promise<ProbeResult> {
  const credential = await credentials?.resolve(apiKeyEnv)
  if (credential === undefined || credential.value === '') return { status: 'failed', error: `credential ${apiKeyEnv} is unavailable` }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(billingProbeURL(baseURL), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${credential.value}` },
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.status === 404 || response.status === 405) return { status: 'unsupported', error: `HTTP ${response.status}` }
    if (!response.ok) return { status: 'failed', error: `HTTP ${response.status}` }
    const parsed = parseBillingMultiplier(await readBoundedJson(response))
    return { status: 'ok', multiplier: parsed.multiplier, observedAt: parsed.observedAt }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timeout)
  }
}

/** Install one process-local runner; settings persist multiplier history across restarts. */
export function installUpstreamBillingProbes(ctx: Context, scope: SettingsScopeFace<PricingConfig>): () => void {
  const credentials = ctx.get('credentials') as CredentialsFace | undefined
  const settings = ctx.get('settings') as { get(namespace: string): unknown }
  const due = new Map<string, number>()
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  const schedule = (delay = 1_000): void => {
    if (!disposed) { if (timer !== undefined) clearTimeout(timer); timer = setTimeout(() => { void run() }, delay) }
  }
  const run = async (): Promise<void> => {
    if (disposed || running) return
    running = true
    try {
      const config = normalizePricing(scope.get())
      const billing = config.billingProbe
      if (billing?.enabled !== true) return
      const providers = (settings?.get('llm-pi-ai') as { providers?: Record<string, { baseURL?: string; apiKeyEnv?: string }> } | undefined)?.providers ?? {}
      const now = Date.now()
      const targets = new Map<string, { provider: string; baseURL: string; apiKeyEnv: string }>()
      for (const route of Object.keys(config.models)) {
        const provider = route.slice(0, route.indexOf('/'))
        if (billing.providers !== undefined && !billing.providers.includes(provider)) continue
        const source = providers[provider]
        if (source?.baseURL === undefined || source.apiKeyEnv === undefined || source.apiKeyEnv === '') continue
        const identity = `${source.baseURL}\u0000${source.apiKeyEnv}`
        if ((due.get(identity) ?? 0) <= now) targets.set(identity, { provider, baseURL: source.baseURL, apiKeyEnv: source.apiKeyEnv })
      }
      const results = await mapWithConcurrency([...targets.values()], billing.concurrency ?? 2, async target => ({ target, result: await probe(target.baseURL, target.apiKeyEnv, credentials) }))
      if (disposed) return
      const patched: Record<string, ModelAssignment> = {}
      const latest = normalizePricing(scope.get())
      for (const item of results) {
        if (item === null) continue
        due.set(`${item.target.baseURL}\u0000${item.target.apiKeyEnv}`, Date.now() + (billing.intervalMinutes ?? 30) * 60_000)
        if (item.result.status !== 'ok' || item.result.multiplier === undefined) continue
        for (const [route, assignment] of Object.entries(latest.models)) {
          if (route.startsWith(`${item.target.provider}/`)) patched[route] = assignmentWithObservedMultiplier(assignment, item.result.multiplier, item.result.observedAt ?? Date.now())
        }
      }
      if (Object.keys(patched).length > 0) await scope.update({ models: patched })
    } finally { running = false; schedule(60_000) }
  }
  const unwatch = scope.watch(() => schedule(60_000))
  schedule()
  return () => { disposed = true; unwatch(); if (timer !== undefined) clearTimeout(timer) }
}
