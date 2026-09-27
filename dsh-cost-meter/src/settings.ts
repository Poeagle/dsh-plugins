/** Host settings bridge and pricing HTTP route for dsh-cost-meter. */

import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Volatile config values were committed into the running fiber without a remount. */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}
import {
  DEFAULT_PRICING,
  assignmentWithManualMultiplier,
  normalizePricing,
  validatePricing,
  type PricingConfig,
} from './pricing.js'
import { installUpstreamBillingProbes, type SettingsScopeFace } from './upstream-billing-probe.js'

/**
 * The harness settings service face used by this row. The pre-`0.1.7`
 * per-plugin `settings.register()`/`settings.get(ns)` API was removed; the
 * live namespace is now the profile entry's own volatile Config and every
 * read goes through `describe()`.
 */
interface SettingsFormsFace {
  describe(): { ns: string; value: unknown }[]
  update(ns: string, patch: object): Promise<void>
  replace(ns: string, section: object): Promise<void>
  mutate(ns: string, ops: readonly ({ op: 'set'; path: readonly string[]; value: unknown } | { op: 'unset'; path: readonly string[] })[]): Promise<void>
}

interface WebServerFace {
  register(route: {
    name: string
    kind: string
    path: string
    handler(req: any, res: any): Promise<void> | void
  }): unknown
}

const SETTINGS_NS = 'cost-meter'
const ROUTE_PATH = '/cost-meter/pricing'

/** Read the resolved value of one profile entry's settings namespace. */
function settingsValue(ctx: Context, ns: string): unknown {
  const settings = ctx.get('settings') as SettingsFormsFace | undefined
  return settings?.describe?.().find(row => row.ns === ns)?.value
}

function mergeHistory(current: PricingConfig, incoming: PricingConfig): PricingConfig {
  const models = { ...incoming.models }
  const now = Date.now()
  for (const [key, next] of Object.entries(models)) {
    const previous = current.models[key]
    if (previous === undefined) continue
    models[key] = assignmentWithManualMultiplier(previous, next, now)
  }
  return { ...incoming, models }
}

/** Same-origin loopback fence for the pricing route (mirrors dsh's /api trust model). */
function isTrustedRequest(req: any): boolean {
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHost(hostUrl.hostname)) return false
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

export const name = 'cost-meter-settings'
export const inject = ['settings']

/** Bridge the live pricing namespace to the browser settings-card route. */
export function apply(ctx: Context): void {
  const scope: SettingsScopeFace<PricingConfig> = {
    get: () => normalizePricing(settingsValue(ctx, SETTINGS_NS) ?? DEFAULT_PRICING),
    update: patch => (ctx.get('settings') as SettingsFormsFace).update(SETTINGS_NS, patch),
    watch: callback => ctx.on('loader/volatile-update', () => { void callback() }),
  }
  ctx.effect(() => installUpstreamBillingProbes(ctx, scope), 'cost-meter upstream billing probes')
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = (webCtx as Context & { webServer: WebServerFace }).webServer
    webServer.register({
      name: 'cost-meter-pricing',
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req: any, res: any) => {
        const send = (status: number, body: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (!isTrustedRequest(req)) {
          send(403, { ok: false, error: 'request refused: this route answers same-origin loopback only' })
          return
        }
        const settings = ctx.get('settings') as SettingsFormsFace | undefined
        if (settings === undefined) {
          send(503, { ok: false, error: 'settings service unavailable' })
          return
        }
        if (req.method === 'GET') {
          try {
            send(200, { ok: true, value: normalizePricing(scope.get()) })
          } catch (error) {
            send(409, { ok: false, error: String(error instanceof Error ? error.message : error) })
          }
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405).end()
          return
        }
        try {
          const chunks: Buffer[] = []
          let total = 0
          for await (const chunk of req) {
            total += chunk.length
            if (total > 256 * 1024) {
              send(413, { ok: false, error: 'pricing payload too large' })
              req.destroy()
              return
            }
            chunks.push(chunk)
          }
          const body = normalizePricing(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          const merged = mergeHistory(normalizePricing(scope.get()), body)
          validatePricing(merged)
          await settings.replace(SETTINGS_NS, merged)
          send(200, { ok: true, value: merged })
        } catch (error) {
          send(400, { ok: false, error: String(error instanceof Error ? error.message : error) })
        }
      },
    })
  })
}
