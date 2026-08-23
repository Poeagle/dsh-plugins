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

export interface PricingPeriod {
  id: string
  name: string
  start: string
  end: string
  rates: PartialTokenRates
}

/** Multiply one request's entire cost when its context exceeds `afterTokens`. */
export interface ContextSurcharge {
  afterTokens: number
  multiplier: number
}

export interface PricingPlan {
  rates?: PartialTokenRates
  periods?: PricingPeriod[]
  contextSurcharges?: ContextSurcharge[]
}

export interface PricingConfig {
  currency: string
  unitTokens: number
  timezone: string
  default: {
    rates: TokenRates
    periods?: PricingPeriod[]
    contextSurcharges?: ContextSurcharge[]
  }
  models: Record<string, PricingPlan>
}

export interface ResolvedPricing {
  rates: TokenRates
  source: 'model-period' | 'model' | 'default-period' | 'default'
  periodName?: string
}

export const DEFAULT_PRICING: PricingConfig = {
  currency: 'CNY',
  unitTokens: 1_000_000,
  timezone: 'Asia/Shanghai',
  default: {
    rates: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 2 },
    periods: [],
  },
  models: {},
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const RATE_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output'] as const

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

function rateValue(...values: Array<number | undefined>): number {
  return values.find(value => value !== undefined) ?? 0
}

export function resolvePricing(config: PricingConfig, provider: string | null, model: string | null, time: number): ResolvedPricing {
  const minute = localMinute(time, config.timezone)
  const key = routeKey(provider, model)
  const plan = key === null ? undefined : config.models[key]
  const modelPeriod = activePeriod(plan?.periods, minute)
  const defaultPeriod = activePeriod(config.default.periods, minute)
  const rates = Object.fromEntries(RATE_KEYS.map(rate => [
    rate,
    rateValue(modelPeriod?.rates[rate], plan?.rates?.[rate], defaultPeriod?.rates[rate], config.default.rates[rate]),
  ])) as unknown as TokenRates
  if (modelPeriod !== undefined) return { rates, source: 'model-period', periodName: modelPeriod.name }
  if (plan?.rates !== undefined && RATE_KEYS.some(rate => plan.rates?.[rate] !== undefined)) return { rates, source: 'model' }
  if (defaultPeriod !== undefined) return { rates, source: 'default-period', periodName: defaultPeriod.name }
  return { rates, source: 'default' }
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
 * A model list, including `[]`, replaces the default list. Among matching
 * tiers (`contextTokens > afterTokens`), the highest threshold wins.
 * @param config Live pricing, including optional default and model surcharge lists.
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
  const key = routeKey(provider, model)
  const plan = key === null ? undefined : config.models[key]
  const tiers = plan?.contextSurcharges ?? config.default.contextSurcharges
  if (tiers === undefined) return null
  let matched: ContextSurcharge | undefined
  for (const tier of tiers) {
    if (contextTokens <= tier.afterTokens) continue
    if (matched === undefined || tier.afterTokens > matched.afterTokens) matched = tier
  }
  return matched ?? null
}

/**
 * @param config Live pricing, including optional default and model surcharge lists.
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

function assertRates(rates: PartialTokenRates, path: string, complete: boolean): void {
  for (const key of RATE_KEYS) {
    const value = rates[key]
    if (value === undefined) {
      if (complete) throw new TypeError(`${path}.${key} is required`)
      continue
    }
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${path}.${key} must be a non-negative finite number`)
  }
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
    assertRates(period.rates, `${itemPath}.rates`, false)
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
    if (!Number.isFinite(tier.multiplier) || tier.multiplier < 0) {
      throw new TypeError(`${itemPath}.multiplier must be a non-negative finite number`)
    }
  }
}

export function validatePricing(config: PricingConfig): void {
  if (config.currency.trim() === '' || config.currency.length > 8) throw new TypeError('currency must contain 1-8 characters')
  if (!Number.isSafeInteger(config.unitTokens) || config.unitTokens < 1) throw new TypeError('unitTokens must be a positive safe integer')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format(0)
  } catch {
    throw new TypeError(`timezone "${config.timezone}" is not an IANA time zone`)
  }
  assertRates(config.default.rates, 'default.rates', true)
  assertPeriods(config.default.periods, 'default.periods')
  assertContextSurcharges(config.default.contextSurcharges, 'default.contextSurcharges')
  for (const [key, plan] of Object.entries(config.models)) {
    if (key.trim() === '' || !key.includes('/')) throw new TypeError(`model key "${key}" must be provider/model`)
    if (plan.rates !== undefined) assertRates(plan.rates, `models.${key}.rates`, false)
    assertPeriods(plan.periods, `models.${key}.periods`)
    assertContextSurcharges(plan.contextSurcharges, `models.${key}.contextSurcharges`)
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
  source: 'model-period' | 'model' | 'default-period' | 'default'
  periodName: string | null
  provider: string | null
  model: string | null
  rates: TokenRates
  contextMultiplier: number
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
  contextMultiplier: number
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
  pricingSource: 'model-period' | 'model' | 'default-period' | 'default' | null
  pricingPeriod: string | null
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
} {
  const promptDetails = object(raw.prompt_tokens_details)
  const inputDetails = object(raw.input_tokens_details)
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
  contextMultiplier: number
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
  const out = emptyFold(config)
  let provider: string | null = null
  let model: string | null = null
  let last: FoldSample | null = null
  let lastPricing: ResolvedPricing | null = null
  let lastHourKey: string | null = null
  const detailMap = new Map<string, CostDetail>()
  const detailKey = (p: string | null, m: string | null, s: string, pn: string | null, multiplier: number): string =>
    `${p ?? ''}|${m ?? ''}|${s}|${pn ?? ''}|${multiplier}`
  const ensureDetail = (pricing: ResolvedPricing, multiplier: number): CostDetail => {
    const key = detailKey(provider, model, pricing.source, pricing.periodName ?? null, multiplier)
    let detail = detailMap.get(key)
    if (detail === undefined) {
      detail = {
        source: pricing.source,
        periodName: pricing.periodName ?? null,
        provider,
        model,
        rates: { ...pricing.rates },
        contextMultiplier: multiplier,
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
  const hourBucketKey = (hKey: string, pricing: ResolvedPricing, multiplier: number): string =>
    `${hKey}|${provider ?? ''}|${model ?? ''}|${pricing.source}|${pricing.periodName ?? ''}|${multiplier}`
  const ensureHour = (hKey: string, pricing: ResolvedPricing, multiplier: number): HourBucket => {
    const key = hourBucketKey(hKey, pricing, multiplier)
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
        contextMultiplier: multiplier,
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
      ensureHour(hourKey(event.time), pricing, 1).toolCalls += 1
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
      output: normalized.outputTokens,
    }
    const contextMultiplier = resolveContextMultiplier(config, provider, model, contextTokensOf(tokens))
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
        const prevDetail = ensureDetail(lastPricing, last.contextMultiplier)
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
        const prevBucket = ensureHour(lastHourKey, lastPricing ?? pricing, last.contextMultiplier)
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
    last = { turn: event.data.turn, step: event.data.step, costs, tokens, hourBucketKey: hourBucketKey(hKey, pricing, contextMultiplier), contextMultiplier }
    lastPricing = pricing
    lastHourKey = hKey

    const bucket = ensureHour(hKey, pricing, contextMultiplier)
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
    const detail = ensureDetail(pricing, contextMultiplier)
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
      contextMultiplier: bucket.contextMultiplier,
    }]
  }).sort((a, b) => a.hour.localeCompare(b.hour) || (a.provider ?? '').localeCompare(b.provider ?? '') || (a.model ?? '').localeCompare(b.model ?? '') || a.contextMultiplier - b.contextMultiplier)
  return out
}
