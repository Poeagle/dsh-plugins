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

export interface PricingPlan {
  rates?: PartialTokenRates
  periods?: PricingPeriod[]
}

export interface PricingConfig {
  currency: string
  unitTokens: number
  timezone: string
  default: {
    rates: TokenRates
    periods?: PricingPeriod[]
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
  for (const [key, plan] of Object.entries(config.models)) {
    if (key.trim() === '' || !key.includes('/')) throw new TypeError(`model key "${key}" must be provider/model`)
    if (plan.rates !== undefined) assertRates(plan.rates, `models.${key}.rates`, false)
    assertPeriods(plan.periods, `models.${key}.periods`)
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
}

interface FoldSample {
  turn: number | undefined
  step: number | undefined
  costs: { input: number; cacheRead: number; cacheWrite: number; output: number }
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
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
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  inputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  outputCost: number
  cost: number
  models: Set<string>
  providers: Set<string>
  sources: Set<string>
  periodNames: Set<string>
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
  const detailKey = (p: string | null, m: string | null, s: string, pn: string | null): string =>
    `${p ?? ''}|${m ?? ''}|${s}|${pn ?? ''}`
  const ensureDetail = (pricing: ResolvedPricing): CostDetail => {
    const key = detailKey(provider, model, pricing.source, pricing.periodName ?? null)
    let detail = detailMap.get(key)
    if (detail === undefined) {
      detail = {
        source: pricing.source,
        periodName: pricing.periodName ?? null,
        provider,
        model,
        rates: { ...pricing.rates },
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
  const ensureHour = (hKey: string): HourBucket => {
    let bucket = hourMap.get(hKey)
    if (bucket === undefined) {
      bucket = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, inputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, outputCost: 0, cost: 0, models: new Set(), providers: new Set(), sources: new Set(), periodNames: new Set() }
      hourMap.set(hKey, bucket)
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
    let usage: Record<string, unknown> | undefined
    if (event.type === 'assistant/message') usage = event.data.usage
    else if (event.type === 'assistant/chunk' && event.data.chunk?.type === 'usage') usage = event.data.chunk.usage
    else continue
    if (usage === undefined || usage === null) continue

    const pricing = resolvePricing(config, provider, model, event.time)
    const tokens = {
      input: num(usage.inputTokens),
      cacheRead: num(usage.cacheReadTokens),
      cacheWrite: num(usage.cacheWriteTokens),
      output: num(usage.outputTokens),
    }
    const costs = {
      input: tokens.input * pricing.rates.input / config.unitTokens,
      cacheRead: tokens.cacheRead * pricing.rates.cacheRead / config.unitTokens,
      cacheWrite: tokens.cacheWrite * pricing.rates.cacheWrite / config.unitTokens,
      output: tokens.output * pricing.rates.output / config.unitTokens,
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
        const prevDetail = ensureDetail(lastPricing)
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
        const prevBucket = ensureHour(lastHourKey)
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
    last = { turn: event.data.turn, step: event.data.step, costs, tokens }
    lastPricing = pricing
    lastHourKey = hKey

    const bucket = ensureHour(hKey)
    bucket.inputTokens += tokens.input
    bucket.cacheReadTokens += tokens.cacheRead
    bucket.cacheWriteTokens += tokens.cacheWrite
    bucket.outputTokens += tokens.output
    bucket.inputCost += costs.input
    bucket.cacheReadCost += costs.cacheRead
    bucket.cacheWriteCost += costs.cacheWrite
    bucket.outputCost += costs.output
    bucket.cost = bucket.inputCost + bucket.cacheReadCost + bucket.cacheWriteCost + bucket.outputCost
    if (provider !== null) bucket.providers.add(provider)
    if (model !== null) bucket.models.add(model)
    bucket.sources.add(pricing.source)
    if (pricing.periodName) bucket.periodNames.add(pricing.periodName)

    const detail = ensureDetail(pricing)
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
  out.details = [...detailMap.values()]
  out.hourly = [...hourMap.entries()].map(([hKey, bucket]) => {
    const totalTokens = bucket.inputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens + bucket.outputTokens
    return {
      hour: hKey,
      hourLabel: hourLabel(new Date(hKey).getTime()),
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
      model: bucket.models.size === 1 ? [...bucket.models][0] : null,
      provider: bucket.providers.size === 1 ? [...bucket.providers][0] : null,
      pricingSource: bucket.sources.size === 1 ? [...bucket.sources][0] : null,
      periodName: bucket.periodNames.size === 1 ? [...bucket.periodNames][0] : null,
    }
  }).sort((a, b) => a.hour.localeCompare(b.hour))
  return out
}
