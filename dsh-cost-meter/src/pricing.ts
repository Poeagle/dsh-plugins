/** Shared pricing configuration and deterministic rate selection. */

export interface TokenRates {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export interface PartialTokenRates {
  input?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
}

/** Time window that scales every group rate by one multiplier. */
export interface PricingPeriod {
  id: string
  name: string
  start: string
  end: string
  multiplier: number
}

/** Multiply one request's entire cost when its context exceeds `afterTokens`. */
export interface ContextSurcharge {
  afterTokens: number
  multiplier: number
}

/** Shared base rates and adjustment multipliers for a set of models. */
export interface PricingGroup {
  id: string
  name: string
  /** Base uncached-input price per `unitTokens`. */
  input: number
  /** Base output price per `unitTokens`. */
  output: number
  /** Cache-read price as a multiple of `input`. */
  cacheReadMultiplier: number
  /** Cache-write price as a multiple of `input`. */
  cacheWriteMultiplier: number
  periods?: PricingPeriod[]
  contextSurcharges?: ContextSurcharge[]
}

/**
 * Per-model assignment onto a pricing group.
 * Final price = group rates (after period) × discountMultiplier × modelMultiplier,
 * then the request-wide context surcharge.
 */
export interface ModelAssignment {
  groupId: string
  /** 优惠倍率. Omitted or empty treats as 1. */
  discountMultiplier?: number
  /** 模型倍率. Omitted or empty treats as 1. */
  modelMultiplier?: number
  /**
   * When true, `reasoningTokens` are billed at the output rate in addition to
   * `outputTokens` (Wanzhao grok: `completion_tokens` is visible-only).
   * When false, reasoning is treated as a subset of `outputTokens`.
   * When omitted, extra billing applies only if `reasoningTokens > outputTokens`.
   */
  reasoningExtra?: boolean
}

/** @deprecated Legacy per-model absolute plan; accepted only by `normalizePricing()`. */
export interface PricingPlan {
  groupId?: string
  discountMultiplier?: number
  modelMultiplier?: number
  rates?: PartialTokenRates
  periods?: Array<PricingPeriod | { id: string; name: string; start: string; end: string; rates?: PartialTokenRates; multiplier?: number }>
  contextSurcharges?: ContextSurcharge[]
  reasoningExtra?: boolean
}

export interface PricingConfig {
  currency: string
  unitTokens: number
  timezone: string
  groups: PricingGroup[]
  models: Record<string, ModelAssignment>
}

export interface ResolvedPricing {
  rates: TokenRates
  source: 'group-period' | 'group'
  periodName?: string
  groupId: string
  groupName: string
  periodMultiplier: number
  discountMultiplier: number
  modelMultiplier: number
}

export const DEFAULT_GROUP: PricingGroup = {
  id: 'default',
  name: '默认',
  input: 1,
  output: 2,
  cacheReadMultiplier: 0.02,
  cacheWriteMultiplier: 1,
  periods: [],
  contextSurcharges: [],
}

export const DEFAULT_PRICING: PricingConfig = {
  currency: 'CNY',
  unitTokens: 1_000_000,
  timezone: 'Asia/Shanghai',
  groups: [DEFAULT_GROUP],
  models: {},
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const DEFAULT_GROUP_ID = 'default'

export function routeKey(provider: string | null, model: string | null): string | null {
  return provider && model ? `${provider}/${model}` : null
}

function minuteOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour! * 60 + minute!
}

function localMinute(time: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(time))
  const hour = Number(parts.find(part => part.type === 'hour')?.value)
  const minute = Number(parts.find(part => part.type === 'minute')?.value)
  return hour * 60 + minute
}

function includesMinute(period: PricingPeriod, minute: number): boolean {
  const start = minuteOfDay(period.start)
  const end = minuteOfDay(period.end)
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

function activePeriod(periods: readonly PricingPeriod[] | undefined, minute: number): PricingPeriod | undefined {
  return periods?.find(period => includesMinute(period, minute))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

/** One when the multiplier is omitted, empty, or non-finite. */
export function multiplierOrOne(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 1
}

export function findGroup(config: PricingConfig, groupId: string | undefined): PricingGroup {
  const id = groupId !== undefined && groupId.trim() !== '' ? groupId : DEFAULT_GROUP_ID
  return config.groups.find(group => group.id === id)
    ?? config.groups.find(group => group.id === DEFAULT_GROUP_ID)
    ?? config.groups[0]
    ?? DEFAULT_GROUP
}

export function assignmentOf(config: PricingConfig, provider: string | null, model: string | null): ModelAssignment | undefined {
  const key = routeKey(provider, model)
  return key === null ? undefined : config.models[key]
}

function groupRates(group: PricingGroup, periodMultiplier: number, discountMultiplier: number, modelMultiplier: number): TokenRates {
  const scale = periodMultiplier * discountMultiplier * modelMultiplier
  return {
    input: group.input * scale,
    cacheRead: group.input * group.cacheReadMultiplier * scale,
    cacheWrite: group.input * group.cacheWriteMultiplier * scale,
    output: group.output * scale,
  }
}

export function resolvePricing(config: PricingConfig, provider: string | null, model: string | null, time: number): ResolvedPricing {
  config = normalizePricing(config)
  const minute = localMinute(time, config.timezone)
  const assignment = assignmentOf(config, provider, model)
  const group = findGroup(config, assignment?.groupId)
  const period = activePeriod(group.periods, minute)
  const periodMultiplier = multiplierOrOne(period?.multiplier)
  const discountMultiplier = multiplierOrOne(assignment?.discountMultiplier)
  const modelMultiplier = multiplierOrOne(assignment?.modelMultiplier)
  return {
    rates: groupRates(group, periodMultiplier, discountMultiplier, modelMultiplier),
    source: period !== undefined ? 'group-period' : 'group',
    periodName: period?.name,
    groupId: group.id,
    groupName: group.name,
    periodMultiplier,
    discountMultiplier,
    modelMultiplier,
  }
}

/**
 * Prompt-side tokens that count as this request's context size.
 * @param tokens Disjoint prompt buckets from one usage report.
 * @returns `input + cacheRead + cacheWrite`. Output is excluded.
 */
export function contextTokensOf(tokens: { input: number; cacheRead: number; cacheWrite: number }): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite
}

/**
 * Resolve the request-wide cost multiplier for one context size.
 * The assigned group's list is used. Among matching tiers
 * (`contextTokens > afterTokens`), the highest threshold wins.
 * @param config Live pricing, including group surcharge lists.
 * @param provider Request provider id, or null when unknown.
 * @param model Request model id, or null when unknown.
 * @param contextTokens Prompt-side token count from `contextTokensOf()`.
 * @returns The matching tier, or null when no surcharge applies.
 */
export function resolveContextSurcharge(
  config: PricingConfig,
  provider: string | null,
  model: string | null,
  contextTokens: number,
): ContextSurcharge | null {
  config = normalizePricing(config)
  const assignment = assignmentOf(config, provider, model)
  const group = findGroup(config, assignment?.groupId)
  const tiers = group.contextSurcharges
  if (tiers === undefined) return null
  let matched: ContextSurcharge | undefined
  for (const tier of tiers) {
    if (contextTokens <= tier.afterTokens) continue
    if (matched === undefined || tier.afterTokens > matched.afterTokens) matched = tier
  }
  return matched ?? null
}

/**
 * @param config Live pricing, including group surcharge lists.
 * @param provider Request provider id, or null when unknown.
 * @param model Request model id, or null when unknown.
 * @param contextTokens Prompt-side token count from `contextTokensOf()`.
 * @returns The matching multiplier, or 1 when no surcharge applies.
 */
export function resolveContextMultiplier(
  config: PricingConfig,
  provider: string | null,
  model: string | null,
  contextTokens: number,
): number {
  return resolveContextSurcharge(config, provider, model, contextTokens)?.multiplier ?? 1
}

/** Compact a token threshold for UI labels, e.g. 200000 → `200K`. */
export function formatTokenThreshold(tokens: number): string {
  if (Number.isSafeInteger(tokens) && tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`
  if (Number.isSafeInteger(tokens) && tokens >= 1_000 && tokens % 1_000 === 0) return `${tokens / 1_000}K`
  return tokens.toLocaleString('zh-CN')
}

/**
 * Whether this route bills `reasoningTokens` on top of `outputTokens`.
 * @param config Live pricing.
 * @param provider Request provider id, or null when unknown.
 * @param model Request model id, or null when unknown.
 * @returns The model plan flag, or undefined when the plan does not declare one.
 */
export function resolveReasoningExtra(
  config: PricingConfig,
  provider: string | null,
  model: string | null,
): boolean | undefined {
  return assignmentOf(normalizePricing(config), provider, model)?.reasoningExtra
}

/**
 * Output tokens that should be billed at the output rate.
 * @param outputTokens Visible / `completion_tokens` count from the usage report.
 * @param reasoningTokens `reasoningTokens` or `completion_tokens_details.reasoning_tokens`.
 * @param reasoningExtra Model-plan flag from `resolveReasoningExtra()`.
 * @returns `output + reasoning` when they are disjoint; otherwise `output`.
 */
export function billedOutputTokens(
  outputTokens: number,
  reasoningTokens: number,
  reasoningExtra: boolean | undefined,
): number {
  if (reasoningTokens <= 0) return outputTokens
  if (reasoningExtra === true) return outputTokens + reasoningTokens
  if (reasoningExtra === false) return outputTokens
  return reasoningTokens > outputTokens ? outputTokens + reasoningTokens : outputTokens
}

export function formatContextSurcharge(afterTokens: number | null | undefined, multiplier: number | null | undefined): string | null {
  if (multiplier === undefined || multiplier === null || multiplier === 1) return null
  if (afterTokens === undefined || afterTokens === null) return `×${multiplier}`
  return `超过 ${formatTokenThreshold(afterTokens)} ×${multiplier}`
}

function assertNonNegative(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be a non-negative finite number`)
}

function minuteSegments(period: PricingPeriod): Array<[number, number]> {
  const start = minuteOfDay(period.start)
  const end = minuteOfDay(period.end)
  return start < end ? [[start, end]] : [[start, 1440], [0, end]]
}

function overlaps(left: PricingPeriod, right: PricingPeriod): boolean {
  return minuteSegments(left).some(([leftStart, leftEnd]) => minuteSegments(right)
    .some(([rightStart, rightEnd]) => Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd)))
}

function assertPeriods(periods: readonly PricingPeriod[] | undefined, path: string): void {
  if (periods === undefined) return
  const ids = new Set<string>()
  for (const [index, period] of periods.entries()) {
    const itemPath = `${path}[${index}]`
    if (period.id.trim() === '' || ids.has(period.id)) throw new TypeError(`${itemPath}.id must be unique and non-empty`)
    ids.add(period.id)
    if (period.name.trim() === '') throw new TypeError(`${itemPath}.name is required`)
    if (!TIME_PATTERN.test(period.start) || !TIME_PATTERN.test(period.end) || period.start === period.end) {
      throw new TypeError(`${itemPath} must use distinct HH:mm start and end times`)
    }
    assertNonNegative(period.multiplier, `${itemPath}.multiplier`)
  }
  for (let left = 0; left < periods.length; left += 1) {
    for (let right = left + 1; right < periods.length; right += 1) {
      if (overlaps(periods[left]!, periods[right]!)) throw new TypeError(`${path} contains overlapping periods`)
    }
  }
}

function assertContextSurcharges(tiers: readonly ContextSurcharge[] | undefined, path: string): void {
  if (tiers === undefined) return
  const thresholds = new Set<number>()
  for (const [index, tier] of tiers.entries()) {
    const itemPath = `${path}[${index}]`
    if (!Number.isSafeInteger(tier.afterTokens) || tier.afterTokens < 0) {
      throw new TypeError(`${itemPath}.afterTokens must be a non-negative safe integer`)
    }
    if (thresholds.has(tier.afterTokens)) throw new TypeError(`${path} contains duplicate afterTokens`)
    thresholds.add(tier.afterTokens)
    assertNonNegative(tier.multiplier, `${itemPath}.multiplier`)
  }
}

interface LegacyPeriod {
  id: string
  name: string
  start: string
  end: string
  rates?: PartialTokenRates
  multiplier?: number
}

interface LegacyPlan {
  groupId?: string
  discountMultiplier?: number
  modelMultiplier?: number
  rates?: PartialTokenRates
  periods?: LegacyPeriod[]
  contextSurcharges?: ContextSurcharge[]
  reasoningExtra?: boolean
}

interface LegacyConfig {
  currency?: string
  unitTokens?: number
  timezone?: string
  groups?: PricingGroup[]
  default?: {
    rates?: PartialTokenRates
    periods?: LegacyPeriod[]
    contextSurcharges?: ContextSurcharge[]
  }
  models?: Record<string, LegacyPlan>
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug === '' ? 'group' : slug.slice(0, 40)
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}-${index}`)) index += 1
  const id = `${base}-${index}`
  used.add(id)
  return id
}

function periodMultiplierOf(period: LegacyPeriod, base: TokenRates): number {
  if (period.multiplier !== undefined && Number.isFinite(period.multiplier)) return period.multiplier
  const rates = period.rates
  if (rates === undefined) return 1
  if (rates.input !== undefined && Number.isFinite(rates.input) && base.input > 0) return rates.input / base.input
  if (rates.output !== undefined && Number.isFinite(rates.output) && base.output > 0) return rates.output / base.output
  const ratios: number[] = []
  for (const key of ['cacheRead', 'cacheWrite'] as const) {
    const value = rates[key]
    const denom = base[key]
    if (value === undefined || !Number.isFinite(value) || denom <= 0) continue
    ratios.push(value / denom)
  }
  if (ratios.length === 0) return 1
  return ratios.reduce((sum, value) => sum + value, 0) / ratios.length
}

function normalizePeriods(periods: readonly LegacyPeriod[] | undefined, base: TokenRates): PricingPeriod[] {
  if (periods === undefined) return []
  return periods.map(period => ({
    id: period.id,
    name: period.name,
    start: period.start,
    end: period.end,
    multiplier: periodMultiplierOf(period, base),
  }))
}

function tokenRatesOf(partial: PartialTokenRates | undefined, fallback: TokenRates): TokenRates {
  return {
    input: finiteOr(partial?.input, fallback.input),
    cacheRead: finiteOr(partial?.cacheRead, fallback.cacheRead),
    cacheWrite: finiteOr(partial?.cacheWrite, fallback.cacheWrite),
    output: finiteOr(partial?.output, fallback.output),
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Number((numerator / denominator).toPrecision(12))
}

function groupFromRates(id: string, name: string, rates: TokenRates, periods: PricingPeriod[], contextSurcharges: ContextSurcharge[] | undefined): PricingGroup {
  const input = rates.input
  return {
    id,
    name,
    input,
    output: rates.output,
    cacheReadMultiplier: ratio(rates.cacheRead, input),
    cacheWriteMultiplier: ratio(rates.cacheWrite, input),
    periods,
    contextSurcharges: contextSurcharges ?? [],
  }
}

function sameGroup(left: PricingGroup, right: PricingGroup): boolean {
  return left.input === right.input
    && left.output === right.output
    && left.cacheReadMultiplier === right.cacheReadMultiplier
    && left.cacheWriteMultiplier === right.cacheWriteMultiplier
    && JSON.stringify(left.periods ?? []) === JSON.stringify(right.periods ?? [])
    && JSON.stringify(left.contextSurcharges ?? []) === JSON.stringify(right.contextSurcharges ?? [])
}

function assignmentFromPlan(plan: LegacyPlan, groupId: string): ModelAssignment {
  const assignment: ModelAssignment = { groupId }
  if (plan.discountMultiplier !== undefined) assignment.discountMultiplier = plan.discountMultiplier
  if (plan.modelMultiplier !== undefined) assignment.modelMultiplier = plan.modelMultiplier
  if (plan.reasoningExtra !== undefined) assignment.reasoningExtra = plan.reasoningExtra
  return assignment
}

/**
 * Accept the current group/assignment document and the previous
 * default/models absolute-rate document. Always returns a group-based config.
 */
export function normalizePricing(raw: unknown): PricingConfig {
  const input = (raw !== null && typeof raw === 'object' ? raw : {}) as LegacyConfig
  const currency = typeof input.currency === 'string' && input.currency.trim() !== '' ? input.currency : DEFAULT_PRICING.currency
  const unitTokens = Number.isSafeInteger(input.unitTokens) && (input.unitTokens ?? 0) >= 1 ? input.unitTokens! : DEFAULT_PRICING.unitTokens
  const timezone = typeof input.timezone === 'string' && input.timezone.trim() !== '' ? input.timezone : DEFAULT_PRICING.timezone
  const hasGroups = Array.isArray(input.groups) && input.groups.length > 0
  if (hasGroups) {
    const groups = input.groups!.map(group => ({
      ...group,
      periods: (group.periods ?? []).map(period => ({
        id: period.id,
        name: period.name,
        start: period.start,
        end: period.end,
        multiplier: multiplierOrOne((period as LegacyPeriod).multiplier),
      })),
      contextSurcharges: group.contextSurcharges ?? [],
    }))
    const models: Record<string, ModelAssignment> = {}
    for (const [key, plan] of Object.entries(input.models ?? {})) {
      if (plan === undefined) continue
      models[key] = assignmentFromPlan(plan, plan.groupId ?? DEFAULT_GROUP_ID)
    }
    return { currency, unitTokens, timezone, groups, models }
  }
  const fallbackRates = DEFAULT_GROUP
  const defaultRates = tokenRatesOf(input.default?.rates, {
    input: fallbackRates.input,
    cacheRead: fallbackRates.input * fallbackRates.cacheReadMultiplier,
    cacheWrite: fallbackRates.input * fallbackRates.cacheWriteMultiplier,
    output: fallbackRates.output,
  })
  const defaultGroup = groupFromRates(
    DEFAULT_GROUP_ID,
    '默认',
    defaultRates,
    normalizePeriods(input.default?.periods, defaultRates),
    input.default?.contextSurcharges,
  )
  const groups: PricingGroup[] = [defaultGroup]
  const used = new Set<string>([DEFAULT_GROUP_ID])
  const models: Record<string, ModelAssignment> = {}
  for (const [key, plan] of Object.entries(input.models ?? {})) {
    if (plan === undefined) continue
    const rates = tokenRatesOf(plan.rates, defaultRates)
    const periods = plan.periods === undefined || plan.periods.length === 0
      ? defaultGroup.periods ?? []
      : normalizePeriods(plan.periods, rates)
    const contextSurcharges = plan.contextSurcharges ?? defaultGroup.contextSurcharges
    const candidate = groupFromRates(uniqueId(slugify(key), used), key, rates, periods, contextSurcharges)
    const existing = groups.find(group => sameGroup(group, candidate))
    if (existing !== undefined) {
      used.delete(candidate.id)
      models[key] = assignmentFromPlan(plan, existing.id)
      continue
    }
    groups.push(candidate)
    models[key] = assignmentFromPlan(plan, candidate.id)
  }
  return { currency, unitTokens, timezone, groups, models }
}

function assertGroup(group: PricingGroup, path: string): void {
  if (group.id.trim() === '') throw new TypeError(`${path}.id must be non-empty`)
  if (group.name.trim() === '') throw new TypeError(`${path}.name is required`)
  assertNonNegative(group.input, `${path}.input`)
  assertNonNegative(group.output, `${path}.output`)
  assertNonNegative(group.cacheReadMultiplier, `${path}.cacheReadMultiplier`)
  assertNonNegative(group.cacheWriteMultiplier, `${path}.cacheWriteMultiplier`)
  assertPeriods(group.periods, `${path}.periods`)
  assertContextSurcharges(group.contextSurcharges, `${path}.contextSurcharges`)
}

export function validatePricing(config: PricingConfig): void {
  config = normalizePricing(config)
  if (config.currency.trim() === '' || config.currency.length > 8) throw new TypeError('currency must contain 1-8 characters')
  if (!Number.isSafeInteger(config.unitTokens) || config.unitTokens < 1) throw new TypeError('unitTokens must be a positive safe integer')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format(0)
  } catch {
    throw new TypeError(`timezone "${config.timezone}" is not an IANA time zone`)
  }
  if (!Array.isArray(config.groups) || config.groups.length === 0) throw new TypeError('groups must contain at least one pricing group')
  const ids = new Set<string>()
  for (const [index, group] of config.groups.entries()) {
    const path = `groups[${index}]`
    if (ids.has(group.id)) throw new TypeError(`${path}.id "${group.id}" is not unique`)
    ids.add(group.id)
    assertGroup(group, path)
  }
  for (const [key, assignment] of Object.entries(config.models)) {
    if (key.trim() === '' || !key.includes('/')) throw new TypeError(`model key "${key}" must be provider/model`)
    if (assignment.groupId === undefined || assignment.groupId.trim() === '' || !ids.has(assignment.groupId)) {
      throw new TypeError(`models.${key}.groupId "${assignment.groupId}" does not match a pricing group`)
    }
    if (assignment.discountMultiplier !== undefined) assertNonNegative(assignment.discountMultiplier, `models.${key}.discountMultiplier`)
    if (assignment.modelMultiplier !== undefined) assertNonNegative(assignment.modelMultiplier, `models.${key}.modelMultiplier`)
  }
}

/** One session-log event the fold understands. */
export interface CostEvent {
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

/** One pricing-context slice within a cumulative fold. */
export interface CostDetail {
  source: 'group-period' | 'group'
  periodName: string | null
  provider: string | null
  model: string | null
  groupId: string
  groupName: string
  rates: TokenRates
  periodMultiplier: number
  discountMultiplier: number
  modelMultiplier: number
  contextMultiplier: number
  contextAfterTokens: number | null
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  inputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  outputCost: number
  cost: number
}

/** One hour slice in a session cost breakdown. */
export interface HourlyDetail {
  hour: string
  hourLabel: string
  turns: number
  steps: number
  toolCalls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  inputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  outputCost: number
  cost: number
  cacheRate: number
  model: string | null
  provider: string | null
  pricingSource: string | null
  periodName: string | null
  groupId: string | null
  groupName: string | null
  contextMultiplier: number
  contextAfterTokens: number | null
}

/** One descendant subagent's own cost and recursive descendants. */
export interface CostSubagent extends CostFold {
  sessionId: string
  children: CostSubagent[]
}

/** Cumulative session cost estimate resolved against one pricing config. */
export interface CostFold {
  cost: number
  inputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  outputCost: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  provider: string | null
  model: string | null
  route: string | null
  currency: string
  unitTokens: number
  pricingSource: 'group-period' | 'group' | null
  pricingPeriod: string | null
  groupId: string | null
  groupName: string | null
  details: CostDetail[]
  hourly: HourlyDetail[]
  subagents: CostSubagent[]
}

interface FoldSample {
  turn: number | undefined
  step: number | undefined
  costs: { input: number; cacheRead: number; cacheWrite: number; output: number }
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number }
  hourBucketKey: string
  contextMultiplier: number
  contextAfterTokens: number | null
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return 0
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** Normalize common provider usage responses into DSH's disjoint token buckets. */
export function normalizeUsage(raw: Record<string, unknown>): {
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
} {
  const promptDetails = object(raw.prompt_tokens_details)
  const inputDetails = object(raw.input_tokens_details)
  const completionDetails = object(raw.completion_tokens_details)
  const cacheRead = firstNumber(
    raw.cacheReadTokens,
    raw.cache_read_input_tokens,
    raw.cache_read_tokens,
    promptDetails.cached_tokens,
    inputDetails.cached_tokens,
    raw.prompt_cache_hit_tokens,
  )
  const cacheWrite = firstNumber(
    raw.cacheWriteTokens,
    raw.cache_write_input_tokens,
    raw.cache_write_tokens,
    raw.cache_creation_input_tokens,
    raw.cache_creation_tokens,
    promptDetails.cache_creation_input_tokens,
    inputDetails.cache_creation_input_tokens,
  )
  const canonicalInput = raw.inputTokens
  const anthropicInput = raw.input_tokens
  const promptTotal = firstNumber(raw.prompt_tokens, raw.promptTokens)
  const input = canonicalInput !== undefined
    ? num(canonicalInput)
    : anthropicInput !== undefined
      ? num(anthropicInput)
      : Math.max(0, promptTotal - cacheRead - cacheWrite)
  return {
    inputTokens: input,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: firstNumber(raw.outputTokens, raw.output_tokens, raw.completion_tokens),
    reasoningTokens: firstNumber(
      raw.reasoningTokens,
      raw.reasoning_tokens,
      completionDetails.reasoning_tokens,
    ),
  }
}

function emptyFold(config: PricingConfig): CostFold {
  return {
    cost: 0,
    inputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    outputCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    provider: null,
    model: null,
    route: null,
    currency: config.currency,
    unitTokens: config.unitTokens,
    pricingSource: null,
    pricingPeriod: null,
    groupId: null,
    groupName: null,
    details: [],
    hourly: [],
    subagents: [],
  }
}

function hourKey(time: number): string {
  const d = new Date(time)
  d.setMinutes(0, 0, 0)
  return d.toISOString()
}

function hourLabel(time: number): string {
  const d = new Date(time)
  const h = String(d.getHours()).padStart(2, '0')
  return `${h}:00–${h}:59`
}

interface HourBucket {
  hour: string
  hourLabel: string
  turns: Set<number>
  steps: Set<string>
  toolCalls: number
  model: string | null
  provider: string | null
  pricingSource: string
  periodName: string | null
  groupId: string
  groupName: string
  contextMultiplier: number
  contextAfterTokens: number | null
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  inputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  outputCost: number
  cost: number
}

/** Fold request routes and provider usage into a cumulative estimate. */
export function foldSession(events: readonly CostEvent[], config: PricingConfig = DEFAULT_PRICING): CostFold {
  config = normalizePricing(config)
  const out = emptyFold(config)
  let provider: string | null = null
  let model: string | null = null
  let last: FoldSample | null = null
  let lastPricing: ResolvedPricing | null = null
  let lastHourKey: string | null = null
  const detailMap = new Map<string, CostDetail>()
  const detailKey = (p: string | null, m: string | null, s: string, pn: string | null, groupId: string, discount: number, modelMul: number, multiplier: number, afterTokens: number | null): string =>
    `${p ?? ''}|${m ?? ''}|${s}|${pn ?? ''}|${groupId}|${discount}|${modelMul}|${multiplier}|${afterTokens ?? ''}`
  const ensureDetail = (pricing: ResolvedPricing, multiplier: number, afterTokens: number | null): CostDetail => {
    const key = detailKey(provider, model, pricing.source, pricing.periodName ?? null, pricing.groupId, pricing.discountMultiplier, pricing.modelMultiplier, multiplier, afterTokens)
    let detail = detailMap.get(key)
    if (detail === undefined) {
      detail = {
        source: pricing.source,
        periodName: pricing.periodName ?? null,
        provider,
        model,
        groupId: pricing.groupId,
        groupName: pricing.groupName,
        rates: { ...pricing.rates },
        periodMultiplier: pricing.periodMultiplier,
        discountMultiplier: pricing.discountMultiplier,
        modelMultiplier: pricing.modelMultiplier,
        contextMultiplier: multiplier,
        contextAfterTokens: afterTokens,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        inputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        outputCost: 0,
        cost: 0,
      }
      detailMap.set(key, detail)
    }
    return detail
  }
  const hourMap = new Map<string, HourBucket>()
  const hourBucketKey = (hKey: string, pricing: ResolvedPricing, multiplier: number, afterTokens: number | null): string =>
    `${hKey}|${provider ?? ''}|${model ?? ''}|${pricing.source}|${pricing.periodName ?? ''}|${pricing.groupId}|${pricing.discountMultiplier}|${pricing.modelMultiplier}|${multiplier}|${afterTokens ?? ''}`
  const ensureHour = (hKey: string, pricing: ResolvedPricing, multiplier: number, afterTokens: number | null): HourBucket => {
    const key = hourBucketKey(hKey, pricing, multiplier, afterTokens)
    let bucket = hourMap.get(key)
    if (bucket === undefined) {
      bucket = {
        hour: hKey,
        hourLabel: hourLabel(new Date(hKey).getTime()),
        turns: new Set<number>(),
        steps: new Set<string>(),
        toolCalls: 0,
        model,
        provider,
        pricingSource: pricing.source,
        periodName: pricing.periodName ?? null,
        groupId: pricing.groupId,
        groupName: pricing.groupName,
        contextMultiplier: multiplier,
        contextAfterTokens: afterTokens,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        inputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        outputCost: 0,
        cost: 0,
      }
      hourMap.set(key, bucket)
    }
    return bucket
  }
  for (const event of events) {
    if (event.type === 'request/header') {
      const call = event.data.header?.config
      if (typeof call?.provider === 'string') provider = call.provider
      if (typeof call?.model === 'string') model = call.model
      continue
    }
    if (event.type === 'tool/call') {
      const pricing = resolvePricing(config, provider, model, event.time)
      ensureHour(hourKey(event.time), pricing, 1, null).toolCalls += 1
      continue
    }
    let usage: Record<string, unknown> | undefined
    if (event.type === 'assistant/message') usage = event.data.usage
    else if (event.type === 'assistant/chunk' && event.data.chunk?.type === 'usage') usage = event.data.chunk.usage
    else continue
    if (usage === undefined || usage === null) continue

    const pricing = resolvePricing(config, provider, model, event.time)
    const normalized = normalizeUsage(usage)
    const tokens = {
      input: normalized.inputTokens,
      cacheRead: normalized.cacheReadTokens,
      cacheWrite: normalized.cacheWriteTokens,
      output: billedOutputTokens(
        normalized.outputTokens,
        normalized.reasoningTokens,
        resolveReasoningExtra(config, provider, model),
      ),
    }
    const surcharge = resolveContextSurcharge(config, provider, model, contextTokensOf(tokens))
    const contextMultiplier = surcharge?.multiplier ?? 1
    const contextAfterTokens = surcharge?.afterTokens ?? null
    const costs = {
      input: tokens.input * pricing.rates.input / config.unitTokens * contextMultiplier,
      cacheRead: tokens.cacheRead * pricing.rates.cacheRead / config.unitTokens * contextMultiplier,
      cacheWrite: tokens.cacheWrite * pricing.rates.cacheWrite / config.unitTokens * contextMultiplier,
      output: tokens.output * pricing.rates.output / config.unitTokens * contextMultiplier,
    }
    const hKey = hourKey(event.time)
    if (last !== null && last.turn === event.data.turn && last.step === event.data.step) {
      out.inputCost -= last.costs.input
      out.cacheReadCost -= last.costs.cacheRead
      out.cacheWriteCost -= last.costs.cacheWrite
      out.outputCost -= last.costs.output
      out.inputTokens -= last.tokens.input
      out.cacheReadTokens -= last.tokens.cacheRead
      out.cacheWriteTokens -= last.tokens.cacheWrite
      out.outputTokens -= last.tokens.output
      if (lastPricing !== null) {
        const prevDetail = ensureDetail(lastPricing, last.contextMultiplier, last.contextAfterTokens)
        prevDetail.inputTokens -= last.tokens.input
        prevDetail.cacheReadTokens -= last.tokens.cacheRead
        prevDetail.cacheWriteTokens -= last.tokens.cacheWrite
        prevDetail.outputTokens -= last.tokens.output
        prevDetail.inputCost -= last.costs.input
        prevDetail.cacheReadCost -= last.costs.cacheRead
        prevDetail.cacheWriteCost -= last.costs.cacheWrite
        prevDetail.outputCost -= last.costs.output
        prevDetail.cost = prevDetail.inputCost + prevDetail.cacheReadCost + prevDetail.cacheWriteCost + prevDetail.outputCost
      }
      if (lastHourKey !== null) {
        const prevBucket = ensureHour(lastHourKey, lastPricing ?? pricing, last.contextMultiplier, last.contextAfterTokens)
        prevBucket.inputTokens -= last.tokens.input
        prevBucket.cacheReadTokens -= last.tokens.cacheRead
        prevBucket.cacheWriteTokens -= last.tokens.cacheWrite
        prevBucket.outputTokens -= last.tokens.output
        prevBucket.inputCost -= last.costs.input
        prevBucket.cacheReadCost -= last.costs.cacheRead
        prevBucket.cacheWriteCost -= last.costs.cacheWrite
        prevBucket.outputCost -= last.costs.output
        prevBucket.cost = prevBucket.inputCost + prevBucket.cacheReadCost + prevBucket.cacheWriteCost + prevBucket.outputCost
      }
    }
    out.inputCost += costs.input
    out.cacheReadCost += costs.cacheRead
    out.cacheWriteCost += costs.cacheWrite
    out.outputCost += costs.output
    out.inputTokens += tokens.input
    out.cacheReadTokens += tokens.cacheRead
    out.cacheWriteTokens += tokens.cacheWrite
    out.outputTokens += tokens.output
    out.provider = provider
    out.model = model
    out.route = routeKey(provider, model)
    out.pricingSource = pricing.source
    out.pricingPeriod = pricing.periodName ?? null
    out.groupId = pricing.groupId
    out.groupName = pricing.groupName
    last = { turn: event.data.turn, step: event.data.step, costs, tokens, hourBucketKey: hourBucketKey(hKey, pricing, contextMultiplier, contextAfterTokens), contextMultiplier, contextAfterTokens }
    lastPricing = pricing
    lastHourKey = hKey

    const bucket = ensureHour(hKey, pricing, contextMultiplier, contextAfterTokens)
    if (event.data.turn !== undefined) bucket.turns.add(event.data.turn)
    if (event.data.turn !== undefined && event.data.step !== undefined) bucket.steps.add(`${event.data.turn}/${event.data.step}`)
    bucket.inputTokens += tokens.input
    bucket.cacheReadTokens += tokens.cacheRead
    bucket.cacheWriteTokens += tokens.cacheWrite
    bucket.outputTokens += tokens.output
    bucket.inputCost += costs.input
    bucket.cacheReadCost += costs.cacheRead
    bucket.cacheWriteCost += costs.cacheWrite
    bucket.outputCost += costs.output
    bucket.cost = bucket.inputCost + bucket.cacheReadCost + bucket.cacheWriteCost + bucket.outputCost
    const detail = ensureDetail(pricing, contextMultiplier, contextAfterTokens)
    detail.inputTokens += tokens.input
    detail.cacheReadTokens += tokens.cacheRead
    detail.cacheWriteTokens += tokens.cacheWrite
    detail.outputTokens += tokens.output
    detail.inputCost += costs.input
    detail.cacheReadCost += costs.cacheRead
    detail.cacheWriteCost += costs.cacheWrite
    detail.outputCost += costs.output
    detail.cost = detail.inputCost + detail.cacheReadCost + detail.cacheWriteCost + detail.outputCost
  }
  out.cost = out.inputCost + out.cacheReadCost + out.cacheWriteCost + out.outputCost
  out.details = [...detailMap.values()].filter(detail => (
    detail.inputTokens !== 0 || detail.cacheReadTokens !== 0 || detail.cacheWriteTokens !== 0 || detail.outputTokens !== 0 || detail.cost !== 0
  ))
  out.hourly = [...hourMap.values()].flatMap(bucket => {
    const totalTokens = bucket.inputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens + bucket.outputTokens
    if (totalTokens === 0 && bucket.cost === 0 && bucket.toolCalls === 0) return []
    return [{
      hour: bucket.hour,
      hourLabel: bucket.hourLabel,
      turns: bucket.turns.size,
      steps: bucket.steps.size,
      toolCalls: bucket.toolCalls,
      inputTokens: bucket.inputTokens,
      cacheReadTokens: bucket.cacheReadTokens,
      cacheWriteTokens: bucket.cacheWriteTokens,
      outputTokens: bucket.outputTokens,
      inputCost: bucket.inputCost,
      cacheReadCost: bucket.cacheReadCost,
      cacheWriteCost: bucket.cacheWriteCost,
      outputCost: bucket.outputCost,
      cost: bucket.cost,
      cacheRate: totalTokens > 0 ? (bucket.cacheReadTokens + bucket.cacheWriteTokens) / totalTokens : 0,
      model: bucket.model,
      provider: bucket.provider,
      pricingSource: bucket.pricingSource,
      periodName: bucket.periodName,
      groupId: bucket.groupId,
      groupName: bucket.groupName,
      contextMultiplier: bucket.contextMultiplier,
      contextAfterTokens: bucket.contextAfterTokens,
    }]
  }).sort((a, b) => a.hour.localeCompare(b.hour) || (a.provider ?? '').localeCompare(b.provider ?? '') || (a.model ?? '').localeCompare(b.model ?? '') || a.contextMultiplier - b.contextMultiplier)
  return out
}
