/** Host cost-meter service: Typert Remote API with live, model-aware pricing. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  DEFAULT_PRICING,
  foldSession,
  normalizeUsage,
  resolvePricing,
  routeKey,
  validatePricing,
  type CostSubagent,
  type PricingConfig,
} from './pricing.js'

export { DEFAULT_PRICING, foldSession, normalizeUsage, resolvePricing, routeKey, validatePricing }
export {
  filterSessionRows,
  querySessionRows,
  sessionRoutes,
  sessionTotalTokens,
  sortSessionRows,
  toggleSessionTableSort,
} from './session-table.js'
export type { CostDetail, CostFold, CostSubagent, HourlyDetail, PartialTokenRates, PricingConfig, PricingPeriod, PricingPlan, TokenRates } from './pricing.js'
export type {
  SessionTableFilter,
  SessionTableRow,
  SessionTableSort,
  SessionTableSortDir,
  SessionTableSortKey,
} from './session-table.js'

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

interface SessionRecord {
  header: {
    id: string
    parentSession?: string
    origin?: string
  }
}

/** One listed session's own fold, without merging descendant subagents. */
export interface SessionCostRecord {
  sessionId: string
  parentSession: string | null
  origin: string | null
  cost: ReturnType<typeof foldSession>
}

interface SessionQueryFace {
  listSessions(): Promise<readonly SessionRecord[]>
  readSession(id: string): Promise<{ events: readonly CostEvent[] }>
}

interface SettingsReaderFace {
  get(namespace: string): unknown
}

function subagentChildren(records: readonly SessionRecord[]): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const record of records) {
    const parent = record.header.parentSession
    if (parent === undefined || record.header.origin !== 'subagent') continue
    const ids = children.get(parent)
    if (ids === undefined) children.set(parent, [record.header.id])
    else ids.push(record.header.id)
  }
  return children
}

async function readSubagentTree(
  query: SessionQueryFace,
  children: ReadonlyMap<string, readonly string[]>,
  sessionId: string,
  config: PricingConfig,
  seen: Set<string>,
): Promise<CostSubagent[]> {
  const ids = children.get(sessionId) ?? []
  const rows: CostSubagent[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const cost = foldSession((await query.readSession(id)).events, config)
    rows.push({ ...cost, sessionId: id, children: await readSubagentTree(query, children, id, config, seen) })
  }
  return rows
}

function mergeCostInto(target: ReturnType<typeof foldSession>, cost: ReturnType<typeof foldSession>): void {
  target.cost += cost.cost
  target.inputCost += cost.inputCost
  target.cacheReadCost += cost.cacheReadCost
  target.cacheWriteCost += cost.cacheWriteCost
  target.outputCost += cost.outputCost
  target.inputTokens += cost.inputTokens
  target.cacheReadTokens += cost.cacheReadTokens
  target.cacheWriteTokens += cost.cacheWriteTokens
  target.outputTokens += cost.outputTokens
  target.details.push(...cost.details)
}

/**
 * Fold every listed session independently.
 * @param query Durable session listing/read face, or undefined when the host has none.
 * @param config Live pricing used for every session.
 * @returns Listed sessions in original order, skipping duplicate ids and unreadable logs. A listing failure returns [].
 */
export async function collectSessionCosts(
  query: SessionQueryFace | undefined,
  config: PricingConfig,
): Promise<SessionCostRecord[]> {
  if (query === undefined) return []
  let records: readonly SessionRecord[]
  try {
    records = await query.listSessions()
  } catch {
    // A listing failure must not fail the Remote method; the overview stays empty.
    return []
  }
  const seen = new Set<string>()
  const rows: SessionCostRecord[] = []
  for (const record of records) {
    const sessionId = record.header.id
    if (sessionId === '' || seen.has(sessionId)) continue
    seen.add(sessionId)
    let events: readonly CostEvent[]
    try {
      events = (await query.readSession(sessionId)).events
    } catch {
      // Skip one unreadable session so the remaining overview still returns.
      continue
    }
    rows.push({
      sessionId,
      parentSession: record.header.parentSession ?? null,
      origin: record.header.origin ?? null,
      cost: foldSession(events, config),
    })
  }
  return rows
}

function mergeCosts(primary: ReturnType<typeof foldSession>, subagents: readonly CostSubagent[]): ReturnType<typeof foldSession> {
  const out = structuredClone(primary)
  out.subagents = structuredClone([...subagents])
  const visit = (rows: readonly CostSubagent[]): void => {
    for (const row of rows) {
      mergeCostInto(out, row)
      visit(row.children)
    }
  }
  visit(subagents)
  return out
}

/** Typert Remote service exposing the cumulative cost of one session. */
export default class CostMeterService extends TypertRemoteService {
  static Config = Config
  static inject = ['settings']

  constructor(ctx: Context) {
    super(ctx, 'costMeter')
  }

  /** Compute one session's cost together with every descendant subagent session. */
  async sessionCost(sessionId: string): Promise<ReturnType<typeof foldSession> | null> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null
    const sessions = this.ctx.get('sessions') as SessionsFace | undefined
    const query = this.ctx.get('sessionQuery') as SessionQueryFace | undefined
    let events = sessions?.get(sessionId)?.events
    if (events === undefined) {
      if (query === undefined) return null
      events = (await query.readSession(sessionId)).events
    }
    const pricing = (this.ctx as Context & { settings: SettingsReaderFace }).settings.get(SETTINGS_NS) as PricingConfig | undefined
    const config = pricing ?? DEFAULT_PRICING
    const cost = foldSession(events, config)
    if (query === undefined) return cost
    const children = subagentChildren(await query.listSessions())
    const subagents = await readSubagentTree(query, children, sessionId, config, new Set<string>([sessionId]))
    return mergeCosts(cost, subagents)
  }

  /** Fold every listed session independently for the all-session overview. */
  async sessionCosts(): Promise<SessionCostRecord[]> {
    const query = this.ctx.get('sessionQuery') as SessionQueryFace | undefined
    const pricing = (this.ctx as Context & { settings: SettingsReaderFace }).settings.get(SETTINGS_NS) as PricingConfig | undefined
    return collectSessionCosts(query, pricing ?? DEFAULT_PRICING)
  }
}
