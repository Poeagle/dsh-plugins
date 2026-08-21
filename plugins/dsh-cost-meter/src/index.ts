/** Host cost-meter service: Typert Remote API with live, model-aware pricing. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  DEFAULT_PRICING,
  foldSession,
  resolvePricing,
  routeKey,
  validatePricing,
  type PricingConfig,
} from './pricing.js'

export { DEFAULT_PRICING, foldSession, resolvePricing, routeKey, validatePricing }
export type { CostDetail, CostFold, HourlyDetail, PartialTokenRates, PricingConfig, PricingPeriod, PricingPlan, TokenRates } from './pricing.js'

const ratesSchema = z.object({
  input: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
  output: z.number().min(0),
})
const periodSchema = z.object({
  id: z.string().required(),
  name: z.string().required(),
  start: z.string().required(),
  end: z.string().required(),
  rates: ratesSchema,
})
const planSchema = z.object({ rates: ratesSchema, periods: z.array(periodSchema) })

export const Config: z<PricingConfig> = z.object({
  currency: z.string().default(DEFAULT_PRICING.currency),
  unitTokens: z.number().step(1).min(1).default(DEFAULT_PRICING.unitTokens),
  timezone: z.string().default(DEFAULT_PRICING.timezone),
  default: z.object({
    rates: z.object({
      input: z.number().min(0).default(DEFAULT_PRICING.default.rates.input),
      cacheRead: z.number().min(0).default(DEFAULT_PRICING.default.rates.cacheRead),
      cacheWrite: z.number().min(0).default(DEFAULT_PRICING.default.rates.cacheWrite),
      output: z.number().min(0).default(DEFAULT_PRICING.default.rates.output),
    }),
    periods: z.array(periodSchema),
  }),
  models: z.dict(planSchema).default({}),
})

const SETTINGS_NS = 'cost-meter'

interface CostEvent {
  type: string
  time: number
  data: {
    turn?: number
    step?: number
    header?: { config?: { provider?: unknown; model?: unknown } }
    usage?: Record<string, unknown>
    chunk?: { type?: string; usage?: Record<string, unknown> }
  }
}

interface SessionsFace {
  get(id: string): { events: readonly CostEvent[] } | undefined
}

interface SessionQueryFace {
  readSession(id: string): Promise<{ events: readonly CostEvent[] }>
}

interface SettingsReaderFace {
  get(namespace: string): unknown
}

/** Typert Remote service exposing the cumulative cost of one session. */
export default class CostMeterService extends TypertRemoteService {
  static Config = Config
  static inject = ['settings']

  constructor(ctx: Context) {
    super(ctx, 'costMeter')
  }

  /** Compute the current cumulative cost for one live or persisted session. */
  async sessionCost(sessionId: string): Promise<ReturnType<typeof foldSession> | null> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null
    const sessions = this.ctx.get('sessions') as SessionsFace | undefined
    let events = sessions?.get(sessionId)?.events
    if (events === undefined) {
      const query = this.ctx.get('sessionQuery') as SessionQueryFace | undefined
      if (query === undefined) return null
      events = (await query.readSession(sessionId)).events
    }
    const pricing = (this.ctx as Context & { settings: SettingsReaderFace }).settings.get(SETTINGS_NS) as PricingConfig | undefined
    return foldSession(events, pricing ?? DEFAULT_PRICING)
  }
}
