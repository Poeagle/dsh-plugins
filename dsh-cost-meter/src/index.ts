/** Host cost-meter service: Typert Remote API with live, model-aware pricing. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  DEFAULT_GROUP,
  DEFAULT_PRICING,
  billedOutputTokens,
  discountMultiplierAt,
  lastProbeAt,
  contextTokensOf,
  foldSession,
  formatContextSurcharge,
  formatTokenThreshold,
  normalizePricing,
  normalizeUsage,
  resolveContextMultiplier,
  resolveContextSurcharge,
  resolvePricing,
  resolveReasoningExtra,
  routeKey,
  validatePricing,
  type CostEvent,
  type CostSubagent,
  type PricingConfig,
} from './pricing.js'
import { SessionFoldCache, logFingerprint, pricingFingerprint } from './session-fold-cache.js'
import { installUsageTap } from './usage-tap.js'

export { DEFAULT_GROUP, DEFAULT_PRICING, billedOutputTokens, contextTokensOf, discountMultiplierAt, foldSession, formatContextSurcharge, formatTokenThreshold, lastProbeAt, normalizePricing, normalizeUsage, resolveContextMultiplier, resolveContextSurcharge, resolvePricing, resolveReasoningExtra, routeKey, validatePricing }
export { assignmentWithObservedMultiplier, billingProbeURL, parseBillingMultiplier } from './upstream-billing-probe.js'
export { applyWireUsage, attachReasoningToChunk, installUsageTap, reasoningFromWireUsage, scanSseBuffer, shouldTapRequest, tapFetchResponse, wrapLlmStream, wrapPrepareCall } from './usage-tap.js'
export { SessionFoldCache, logFingerprint, pricingFingerprint }
export {
  activityText,
  averageUnitPrice,
  costTableColumnValues,
  costTableTotals,
  defaultChildCostTableSort,
  defaultCostTableSort,
  defaultVisibleCostColumns,
  displayCellText,
  filterCostTableRows,
  filterHourlyEntries,
  filterSessionRows,
  flattenCostTableRows,
  flattenHourlyEntries,
  formatCacheRatedCost,
  formatMoneyAmount,
  formatRatedCost,
  formatUnitTokensLabel,
  formatUsageCell,
  groupCostTableRows,
  groupDailyOverview,
  groupHourlyEntries,
  isNumericCostTableColumn,
  localDateOfHour,
  localTodayDate,
  mapWithConcurrency,
  mergeListedSessionCost,
  metricCost,
  metricTokens,
  optionalCostTableColumns,
  overviewCost,
  queryCostTable,
  queryCostTableGroups,
  queryDailyOverview,
  queryHourlyOverview,
  querySessionRows,
  resolveVisibleCostColumns,
  rowTotalTokens,
  sessionRoutes,
  sharedContextSurcharge,
  sessionTotalTokens,
  sortCostTableRows,
  sortSessionRows,
  sumHourlySlices,
  toggleCostTableSort,
  toggleSessionTableSort,
} from './session-table.js'
export type { BillingProbeConfig, ContextSurcharge, CostDetail, CostFold, CostSubagent, HourlyDetail, ModelAssignment, MultiplierHistoryEntry, PartialTokenRates, PricingConfig, PricingGroup, PricingPeriod, PricingPlan, TokenRates } from './pricing.js'
export type {
  CostDisplayColumn,
  CostRateKind,
  CostTableColumn,
  CostTableFilter,
  CostTableGroup,
  CostTableRow,
  CostTableSort,
  CostView,
  DailyOverviewGroup,
  HourlyOverviewFilter,
  HourlyOverviewGroup,
  HourlySessionEntry,
  HourlySlice,
  SessionTableFilter,
  SessionTableRow,
  SessionTableSort,
  SessionTableSortDir,
  SessionTableSortKey,
} from './session-table.js'

/**
 * Settings schema admits both the current group document and the previous
 * default/models document, then stores the normalized group form.
 */
export const Config = z.transform(z.any(), (value) => {
  const normalized = normalizePricing(value ?? {})
  validatePricing(normalized)
  return normalized
})

const SETTINGS_NS = 'cost-meter'

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

export interface SessionFoldStore {
  fold(sessionId: string, events: readonly CostEvent[], config: PricingConfig): ReturnType<typeof foldSession>
  peek?(sessionId: string, config: PricingConfig): ReturnType<typeof foldSession> | undefined
  retain?(sessionIds: Iterable<string>): void
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

function resolveEvents(
  sessionId: string,
  sessions: SessionsFace | undefined,
  query: SessionQueryFace | undefined,
): Promise<readonly CostEvent[] | undefined> | readonly CostEvent[] | undefined {
  const live = sessions?.get(sessionId)?.events
  if (live !== undefined) return live
  if (query === undefined) return undefined
  return query.readSession(sessionId).then(snapshot => snapshot.events)
}

async function foldOwnSession(
  sessionId: string,
  events: readonly CostEvent[],
  config: PricingConfig,
  store: SessionFoldStore | undefined,
): Promise<ReturnType<typeof foldSession>> {
  return store === undefined ? foldSession(events, config) : store.fold(sessionId, events, config)
}

async function ownFoldFor(
  sessionId: string,
  config: PricingConfig,
  sessions: SessionsFace | undefined,
  query: SessionQueryFace | undefined,
  store: SessionFoldStore | undefined,
): Promise<ReturnType<typeof foldSession> | undefined> {
  const live = sessions?.get(sessionId)?.events
  if (live === undefined && store?.peek !== undefined) {
    const cached = store.peek(sessionId, config)
    if (cached !== undefined) return cached
  }
  const events = live ?? await resolveEvents(sessionId, undefined, query)
  if (events === undefined) return undefined
  return foldOwnSession(sessionId, events, config, store)
}

async function readSubagentTree(
  query: SessionQueryFace,
  children: ReadonlyMap<string, readonly string[]>,
  sessionId: string,
  config: PricingConfig,
  seen: Set<string>,
  sessions?: SessionsFace,
  store?: SessionFoldStore,
): Promise<CostSubagent[]> {
  const ids = children.get(sessionId) ?? []
  const rows: CostSubagent[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const cost = await ownFoldFor(id, config, sessions, query, store)
    if (cost === undefined) continue
    rows.push({ ...cost, sessionId: id, children: await readSubagentTree(query, children, id, config, seen, sessions, store) })
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
 * @param store Optional own-fold cache. Hits reuse the previous fold for an unchanged log and pricing.
 * @param sessions Optional live session map. Live events take precedence over a durable read.
 * @returns Listed sessions in original order, skipping duplicate ids and unreadable logs. A listing failure returns [].
 */
export async function collectSessionCosts(
  query: SessionQueryFace | undefined,
  config: PricingConfig,
  store?: SessionFoldStore,
  sessions?: SessionsFace,
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
    let cost: ReturnType<typeof foldSession> | undefined
    try {
      cost = await ownFoldFor(sessionId, config, sessions, query, store)
    } catch {
      // Skip one unreadable session so the remaining overview still returns.
      continue
    }
    if (cost === undefined) continue
    rows.push({
      sessionId,
      parentSession: record.header.parentSession ?? null,
      origin: record.header.origin ?? null,
      cost,
    })
  }
  store?.retain?.(seen)
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

  private readonly folds = new SessionFoldCache()

  constructor(ctx: Context) {
    super(ctx, 'costMeter')
    ctx.effect(() => installUsageTap(ctx as unknown as Parameters<typeof installUsageTap>[0]))
  }

  /** Compute one session's cost together with every descendant subagent session. */
  async sessionCost(sessionId: string): Promise<ReturnType<typeof foldSession> | null> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null
    const sessions = this.ctx.get('sessions') as SessionsFace | undefined
    const query = this.ctx.get('sessionQuery') as SessionQueryFace | undefined
    const pricing = (this.ctx as Context & { settings: SettingsReaderFace }).settings.get(SETTINGS_NS) as PricingConfig | undefined
    const config = normalizePricing(pricing ?? DEFAULT_PRICING)
    const cost = await ownFoldFor(sessionId, config, sessions, query, this.folds)
    if (cost === undefined) return null
    if (query === undefined) return cost
    const children = subagentChildren(await query.listSessions())
    const subagents = await readSubagentTree(query, children, sessionId, config, new Set<string>([sessionId]), sessions, this.folds)
    return mergeCosts(cost, subagents)
  }

  /** Fold every listed session independently for the all-session overview. */
  async sessionCosts(): Promise<SessionCostRecord[]> {
    const query = this.ctx.get('sessionQuery') as SessionQueryFace | undefined
    const sessions = this.ctx.get('sessions') as SessionsFace | undefined
    const pricing = (this.ctx as Context & { settings: SettingsReaderFace }).settings.get(SETTINGS_NS) as PricingConfig | undefined
    return collectSessionCosts(query, normalizePricing(pricing ?? DEFAULT_PRICING), this.folds, sessions)
  }
}
