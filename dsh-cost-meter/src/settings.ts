/** Host settings registration and pricing HTTP route for dsh-cost-meter. */

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './index.js'
import { assignmentWithManualMultiplier, normalizePricing, validatePricing, type PricingConfig } from './pricing.js'
import { installUpstreamBillingProbes } from './upstream-billing-probe.js'

interface SettingsScopeFace<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  update(patch: object): Promise<void>
}

interface SettingsFace {
  register<T>(namespace: string, schema: typeof Config, options: { base: T; validate(value: T): void }): SettingsScopeFace<T>
  replace(namespace: string, section: object): Promise<void>
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

/** Register the live pricing namespace and the browser settings-card route. */
export function apply(ctx: Context, config: PricingConfig): void {
  const settings = ctx.get('settings') as SettingsFace | undefined
  if (settings === undefined) return
  const scope = settings.register(SETTINGS_NS, Config, {
    base: config,
    validate: (value) => validatePricing(normalizePricing(value)),
  })
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
