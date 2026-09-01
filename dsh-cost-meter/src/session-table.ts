/** Pure session-overview query helpers shared by the host tests and the dock UI. */

import { formatContextSurcharge } from './pricing.js'

export interface HourlySlice {
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
  periodName: string | null
  groupId?: string | null
  groupName?: string | null
  contextMultiplier?: number
  contextAfterTokens?: number | null
  rates?: { input?: number; cacheRead?: number; cacheWrite?: number; output?: number } | null
}

export interface SessionTableCost {
  cost: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  route?: string | null
  hourly?: ReadonlyArray<Partial<HourlySlice> & { provider: string | null; model: string | null }>
  details?: ReadonlyArray<{ provider: string | null; model: string | null }>
}

export interface SessionTableRow {
  sessionId: string
  parentSession: string | null
  origin: string | null
  cost: SessionTableCost
}

export interface SessionTableFilter {
  sessionId: string
  origin: string
  parentSession: string
  route: string
  minCost?: number
  maxCost?: number
}

export type SessionTableSortKey =
  | 'sessionId'
  | 'origin'
  | 'parentSession'
  | 'cost'
  | 'inputTokens'
  | 'cacheReadTokens'
  | 'outputTokens'
  | 'totalTokens'

export type SessionTableSortDir = 'asc' | 'desc'

export interface SessionTableSort {
  key: SessionTableSortKey
  dir: SessionTableSortDir
}

export interface SessionListItem {
  sessionId: string
  parentSessionId?: string
  origin?: string
}

export interface RemoteEnvelope<T> {
  ok: boolean
  value?: T
  error?: unknown
}

/** Combine one listed session with its independently folded cost. */
export function mergeListedSessionCost<T extends SessionTableCost>(
  item: SessionListItem,
  cost: T,
): SessionTableRow & { cost: T } {
  return {
    sessionId: item.sessionId,
    parentSession: item.parentSessionId ?? null,
    origin: item.origin ?? null,
    cost,
  }
}

function routeLabel(provider: string | null | undefined, model: string | null | undefined): string | null {
  if (provider && model) return `${provider}/${model}`
  return model ?? provider ?? null
}

/** Distinct provider/model routes observed on one session fold. */
export function sessionRoutes(row: SessionTableRow): string[] {
  const routes = new Set<string>()
  if (row.cost.route) routes.add(row.cost.route)
  for (const hourly of row.cost.hourly ?? []) {
    const key = routeLabel(hourly.provider, hourly.model)
    if (key) routes.add(key)
  }
  for (const detail of row.cost.details ?? []) {
    const key = routeLabel(detail.provider, detail.model)
    if (key) routes.add(key)
  }
  return [...routes]
}

export function sessionTotalTokens(row: SessionTableRow): number {
  return row.cost.inputTokens + row.cost.cacheReadTokens + row.cost.cacheWriteTokens + row.cost.outputTokens
}

/** Keep rows that match every populated filter field. */
export function filterSessionRows<T extends SessionTableRow>(rows: readonly T[], filter: SessionTableFilter): T[] {
  const sessionId = filter.sessionId.trim().toLowerCase()
  const parent = filter.parentSession.trim().toLowerCase()
  return rows.filter(row => {
    if (sessionId && !row.sessionId.toLowerCase().includes(sessionId)) return false
    if (filter.origin && (row.origin ?? '') !== filter.origin) return false
    if (parent && !(row.parentSession ?? '').toLowerCase().includes(parent)) return false
    if (filter.route && !sessionRoutes(row).includes(filter.route)) return false
    if (filter.minCost !== undefined && row.cost.cost < filter.minCost) return false
    if (filter.maxCost !== undefined && row.cost.cost > filter.maxCost) return false
    return true
  })
}

function compareSessionRows(left: SessionTableRow, right: SessionTableRow, key: SessionTableSortKey): number {
  switch (key) {
    case 'sessionId': return left.sessionId.localeCompare(right.sessionId)
    case 'origin': return (left.origin ?? '').localeCompare(right.origin ?? '')
    case 'parentSession': return (left.parentSession ?? '').localeCompare(right.parentSession ?? '')
    case 'cost': return left.cost.cost - right.cost.cost
    case 'inputTokens': return left.cost.inputTokens - right.cost.inputTokens
    case 'cacheReadTokens': return left.cost.cacheReadTokens - right.cost.cacheReadTokens
    case 'outputTokens': return left.cost.outputTokens - right.cost.outputTokens
    case 'totalTokens': return sessionTotalTokens(left) - sessionTotalTokens(right)
  }
}

/** Stable sort: equal values keep sessionId order. */
export function sortSessionRows<T extends SessionTableRow>(rows: readonly T[], sort: SessionTableSort): T[] {
  const direction = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    const compared = compareSessionRows(left, right, sort.key)
    return compared === 0 ? left.sessionId.localeCompare(right.sessionId) : compared * direction
  })
}

export function querySessionRows<T extends SessionTableRow>(
  rows: readonly T[],
  filter: SessionTableFilter,
  sort: SessionTableSort,
): T[] {
  return sortSessionRows(filterSessionRows(rows, filter), sort)
}

export function toggleSessionTableSort(current: SessionTableSort, key: SessionTableSortKey): SessionTableSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'sessionId' || key === 'origin' || key === 'parentSession' ? 'asc' : 'desc' }
}

/** Map items with a bounded number of in-flight promises, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(items.length, Math.floor(concurrency) || 1))
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await mapper(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

export interface HourlySessionEntry {
  sessionId: string
  origin: string | null
  parentSession: string | null
  entry: HourlySlice
}

export interface HourlyOverviewFilter {
  date: string
  hour: string
  sessionId: string
  origin: string
  route: string
}

export interface HourlyOverviewGroup {
  hour: string
  hourLabel: string
  sessions: HourlySessionEntry[]
  totals: HourlySlice
}

function emptyHourlySlice(hour = '', hourLabel = ''): HourlySlice {
  return {
    hour,
    hourLabel,
    turns: 0,
    steps: 0,
    toolCalls: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    inputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    outputCost: 0,
    cost: 0,
    cacheRate: 0,
    model: null,
    provider: null,
    periodName: null,
    groupId: null,
    groupName: null,
  }
}

/** Local calendar date of an hourly ISO bucket. */
export function localDateOfHour(hour: string): string {
  const date = new Date(hour)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function hourlyRoute(entry: Pick<HourlySlice, 'provider' | 'model'>): string | null {
  return routeLabel(entry.provider, entry.model)
}

function asHourlySlice(value: Partial<HourlySlice> & { provider: string | null; model: string | null }): HourlySlice | null {
  if (typeof value.hour !== 'string' || value.hour === '') return null
  return {
    hour: value.hour,
    hourLabel: value.hourLabel ?? value.hour,
    turns: value.turns ?? 0,
    steps: value.steps ?? 0,
    toolCalls: value.toolCalls ?? 0,
    inputTokens: value.inputTokens ?? 0,
    cacheReadTokens: value.cacheReadTokens ?? 0,
    cacheWriteTokens: value.cacheWriteTokens ?? 0,
    outputTokens: value.outputTokens ?? 0,
    inputCost: value.inputCost ?? 0,
    cacheReadCost: value.cacheReadCost ?? 0,
    cacheWriteCost: value.cacheWriteCost ?? 0,
    outputCost: value.outputCost ?? 0,
    cost: value.cost ?? 0,
    cacheRate: value.cacheRate ?? 0,
    model: value.model ?? null,
    provider: value.provider ?? null,
    periodName: value.periodName ?? null,
    groupId: value.groupId ?? null,
    groupName: value.groupName ?? null,
    contextMultiplier: value.contextMultiplier,
    contextAfterTokens: value.contextAfterTokens ?? null,
    rates: value.rates ?? null,
  }
}

/** Flatten each session's own hourly buckets; parent rows do not include child sessions. */
export function flattenHourlyEntries(rows: readonly SessionTableRow[]): HourlySessionEntry[] {
  const entries: HourlySessionEntry[] = []
  for (const row of rows) {
    for (const hourly of row.cost.hourly ?? []) {
      const entry = asHourlySlice(hourly)
      if (entry === null) continue
      entries.push({
        sessionId: row.sessionId,
        origin: row.origin,
        parentSession: row.parentSession,
        entry,
      })
    }
  }
  return entries
}

export function filterHourlyEntries(
  entries: readonly HourlySessionEntry[],
  filter: HourlyOverviewFilter,
): HourlySessionEntry[] {
  const sessionId = filter.sessionId.trim().toLowerCase()
  return entries.filter(item => {
    if (filter.date && localDateOfHour(item.entry.hour) !== filter.date) return false
    if (filter.hour && item.entry.hour !== filter.hour && item.entry.hourLabel !== filter.hour) return false
    if (sessionId && !item.sessionId.toLowerCase().includes(sessionId)) return false
    if (filter.origin && (item.origin ?? '') !== filter.origin) return false
    const route = hourlyRoute(item.entry)
    if (filter.route && route !== filter.route) return false
    return true
  })
}

export function sumHourlySlices(rows: readonly HourlySlice[], hour = '', hourLabel = ''): HourlySlice {
  const out = emptyHourlySlice(hour, hourLabel)
  for (const row of rows) {
    out.turns += row.turns
    out.steps += row.steps
    out.toolCalls += row.toolCalls
    out.inputTokens += row.inputTokens
    out.cacheReadTokens += row.cacheReadTokens
    out.cacheWriteTokens += row.cacheWriteTokens
    out.outputTokens += row.outputTokens
    out.inputCost += row.inputCost
    out.cacheReadCost += row.cacheReadCost
    out.cacheWriteCost += row.cacheWriteCost
    out.outputCost += row.outputCost
    out.cost += row.cost
  }
  const totalTokens = out.inputTokens + out.cacheReadTokens + out.cacheWriteTokens + out.outputTokens
  out.cacheRate = totalTokens > 0 ? (out.cacheReadTokens + out.cacheWriteTokens) / totalTokens : 0
  return out
}

/** Group flattened hourly entries by time bucket, newest hour last. */
export function groupHourlyEntries(entries: readonly HourlySessionEntry[]): HourlyOverviewGroup[] {
  const groups = new Map<string, HourlyOverviewGroup>()
  for (const item of entries) {
    const existing = groups.get(item.entry.hour)
    if (existing === undefined) {
      groups.set(item.entry.hour, {
        hour: item.entry.hour,
        hourLabel: item.entry.hourLabel,
        sessions: [item],
        totals: emptyHourlySlice(item.entry.hour, item.entry.hourLabel),
      })
      continue
    }
    existing.sessions.push(item)
  }
  return [...groups.values()]
    .sort((left, right) => left.hour.localeCompare(right.hour))
    .map(group => ({
      ...group,
      totals: sumHourlySlices(group.sessions.map(item => item.entry), group.hour, group.hourLabel),
    }))
}

export function queryHourlyOverview(
  rows: readonly SessionTableRow[],
  filter: HourlyOverviewFilter,
): HourlyOverviewGroup[] {
  return groupHourlyEntries(filterHourlyEntries(flattenHourlyEntries(rows), filter))
}

/** Local calendar date of an epoch millisecond, or the current time when omitted. */
export function localTodayDate(now = Date.now()): string {
  return localDateOfHour(new Date(now).toISOString())
}

/** One local calendar day of independently folded hourly buckets. */
export interface DailyOverviewGroup {
  date: string
  hours: HourlyOverviewGroup[]
  totals: HourlySlice
}

/** Group hourly overview buckets by local date, oldest day first. */
export function groupDailyOverview(groups: readonly HourlyOverviewGroup[]): DailyOverviewGroup[] {
  const days = new Map<string, HourlyOverviewGroup[]>()
  for (const group of groups) {
    const date = localDateOfHour(group.hour)
    const existing = days.get(date)
    if (existing === undefined) days.set(date, [group])
    else existing.push(group)
  }
  return [...days.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, hours]) => ({
      date,
      hours,
      totals: sumHourlySlices(hours.map(hour => hour.totals), date, date),
    }))
}

export function queryDailyOverview(
  rows: readonly SessionTableRow[],
  filter: HourlyOverviewFilter,
): DailyOverviewGroup[] {
  return groupDailyOverview(queryHourlyOverview(rows, filter))
}

/** Sum independently folded hourly cost, optionally restricted to one local date. */
export function overviewCost(rows: readonly SessionTableRow[], date = ''): number {
  return sumHourlySlices(queryHourlyOverview(rows, {
    date,
    hour: '',
    sessionId: '',
    origin: '',
    route: '',
  }).flatMap(group => group.sessions.map(item => item.entry))).cost
}

export interface ContextSurchargeLabel {
  afterTokens: number | null
  multiplier: number
}

/**
 * Collapse one or more hourly slices to a single surcharge label.
 * Mixed multipliers, including a mix of charged and uncharged requests,
 * return null so the UI does not claim the whole group was doubled.
 */
export function sharedContextSurcharge(rows: ReadonlyArray<{ contextAfterTokens?: number | null; contextMultiplier?: number | null }>): ContextSurchargeLabel | null {
  const first = rows[0]
  if (first === undefined) return null
  const multiplier = first.contextMultiplier ?? 1
  const afterTokens = first.contextAfterTokens ?? null
  for (const row of rows) {
    if ((row.contextMultiplier ?? 1) !== multiplier) return null
    if ((row.contextAfterTokens ?? null) !== afterTokens) return null
  }
  return { afterTokens, multiplier }
}

export type CostView = 'time' | 'model'

export interface CostTableRow {
  id: string
  dimension: string
  date: string
  hour: string
  hourLabel: string
  sessionId: string
  origin: string
  route: string
  periodName: string
  surcharge: string
  turns: number
  steps: number
  toolCalls: number
  inputTokens: number
  inputCost: number
  cacheTokens: number
  cacheCost: number
  outputTokens: number
  outputCost: number
  cacheRate: number
  cost: number
  inputRate: number | null
  cacheReadRate: number | null
  cacheWriteRate: number | null
  outputRate: number | null
}

export type CostTableColumn = keyof CostTableRow

export type CostDisplayColumn =
  | 'dimension'
  | 'sessionId'
  | 'origin'
  | 'route'
  | 'surcharge'
  | 'periodName'
  | 'activity'
  | 'input'
  | 'cache'
  | 'output'
  | 'usage'

export type CostTableFilter = Partial<Record<CostDisplayColumn, string>>

export interface CostTableSort {
  key: CostDisplayColumn
  dir: SessionTableSortDir
}

const NUMERIC_DISPLAY_COLUMNS = new Set<CostDisplayColumn>(['activity', 'input', 'cache', 'output', 'usage'])

function surchargeText(entry: HourlySlice): string {
  return formatContextSurcharge(entry.contextAfterTokens, entry.contextMultiplier) ?? ''
}

function cellText(row: CostTableRow, key: CostTableColumn): string {
  const value = row[key]
  if (value === null || value === undefined) return ''
  return String(value)
}

export function rowTotalTokens(row: Pick<CostTableRow, 'inputTokens' | 'cacheTokens' | 'outputTokens'>): number {
  return row.inputTokens + row.cacheTokens + row.outputTokens
}

export function metricTokens(row: CostTableRow, key: 'input' | 'cache' | 'output' | 'usage'): number {
  if (key === 'input') return row.inputTokens
  if (key === 'cache') return row.cacheTokens
  if (key === 'output') return row.outputTokens
  return rowTotalTokens(row)
}

export function metricCost(row: CostTableRow, key: 'input' | 'cache' | 'output' | 'usage'): number {
  if (key === 'input') return row.inputCost
  if (key === 'cache') return row.cacheCost
  if (key === 'output') return row.outputCost
  return row.cost
}

export function averageUnitPrice(cost: number, tokens: number, unitTokens: number): number | null {
  if (!(tokens > 0) || !Number.isFinite(cost) || !Number.isFinite(unitTokens) || unitTokens <= 0) return null
  return cost / tokens * unitTokens
}

export function formatUsageCell(tokens: number, cost: number, unitTokens: number, _symbol: string): string {
  const tokenText = String(tokens)
  const costText = formatMoneyAmount(cost)
  const avg = averageUnitPrice(cost, tokens, unitTokens)
  return avg === null ? `${tokenText}(${costText})` : `${tokenText}(${costText}/${formatMoneyAmount(avg)})`
}

export function activityText(row: Pick<CostTableRow, 'turns' | 'steps' | 'toolCalls'>): string {
  return `${row.turns} 轮 / ${row.steps} 步 / ${row.toolCalls} 工具`
}

export function displayCellText(row: CostTableRow, key: CostDisplayColumn, unitTokens = 1_000_000, symbol = ''): string {
  if (key === 'activity') return activityText(row)
  if (key === 'input' || key === 'cache' || key === 'output' || key === 'usage') {
    return formatUsageCell(metricTokens(row, key), metricCost(row, key), unitTokens, symbol)
  }
  return cellText(row, key)
}

function displaySortValue(row: CostTableRow, key: CostDisplayColumn): number | string {
  if (key === 'activity') return row.turns
  if (key === 'input') return row.inputCost
  if (key === 'cache') return row.cacheCost
  if (key === 'output') return row.outputCost
  if (key === 'usage') return row.cost
  return cellText(row, key)
}

/** One table row per independent hourly bucket. Time view labels by date+hour; model view labels by route. */
export function flattenCostTableRows(entries: readonly HourlySessionEntry[], view: CostView): CostTableRow[] {
  return entries.map((item, index) => {
    const route = hourlyRoute(item.entry) ?? '-'
    const date = localDateOfHour(item.entry.hour)
    return {
      id: `${item.sessionId}:${item.entry.hour}:${route}:${item.entry.contextMultiplier ?? 1}:${index}`,
      dimension: view === 'model' ? route : `${date} ${item.entry.hourLabel}`,
      date,
      hour: item.entry.hour,
      hourLabel: item.entry.hourLabel,
      sessionId: item.sessionId,
      origin: item.origin ?? '',
      route,
      periodName: item.entry.periodName ?? '',
      surcharge: surchargeText(item.entry),
      turns: item.entry.turns,
      steps: item.entry.steps,
      toolCalls: item.entry.toolCalls,
      inputTokens: item.entry.inputTokens,
      inputCost: item.entry.inputCost,
      cacheTokens: item.entry.cacheReadTokens + item.entry.cacheWriteTokens,
      cacheCost: item.entry.cacheReadCost + item.entry.cacheWriteCost,
      outputTokens: item.entry.outputTokens,
      outputCost: item.entry.outputCost,
      cacheRate: item.entry.cacheRate,
      cost: item.entry.cost,
      inputRate: item.entry.rates?.input ?? null,
      cacheReadRate: item.entry.rates?.cacheRead ?? null,
      cacheWriteRate: item.entry.rates?.cacheWrite ?? null,
      outputRate: item.entry.rates?.output ?? null,
    }
  })
}

export type CostRateKind = 'input' | 'cacheRead' | 'cacheWrite' | 'output'

export function formatUnitTokensLabel(unitTokens: number): string {
  if (unitTokens === 1_000_000) return '每 100 万 Token'
  if (unitTokens === 1_000) return '每 1 千 Token'
  return `每 ${unitTokens.toLocaleString('zh-CN')} Token`
}

export function formatMoneyAmount(value: number): string {
  if (!Number.isFinite(value)) return '0.00'
  const abs = Math.abs(value)
  if (abs > 0 && abs < 0.01) return value.toFixed(4)
  const two = value.toFixed(2)
  if (Math.abs(value - Number(two)) < 1e-9) return two
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

const RATE_LABEL: Record<CostRateKind, string> = {
  input: '输入基础价',
  cacheRead: '缓存读基础价',
  cacheWrite: '缓存写基础价',
  output: '输出基础价',
}

export function formatRatedCost(amount: number, rate: number | null | undefined, kind: CostRateKind, unitTokens: number, symbol: string): string {
  const money = `${symbol}${formatMoneyAmount(amount)}`
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return money
  return `${money}（${RATE_LABEL[kind]} ${symbol}${formatMoneyAmount(rate)} / ${formatUnitTokensLabel(unitTokens)}）`
}

export function formatCacheRatedCost(amount: number, cacheReadRate: number | null | undefined, cacheWriteRate: number | null | undefined, unitTokens: number, symbol: string): string {
  const money = `${symbol}${formatMoneyAmount(amount)}`
  const unit = formatUnitTokensLabel(unitTokens)
  const read = cacheReadRate !== null && cacheReadRate !== undefined && Number.isFinite(cacheReadRate) ? `缓存读基础价 ${symbol}${formatMoneyAmount(cacheReadRate)} / ${unit}` : ''
  const write = cacheWriteRate !== null && cacheWriteRate !== undefined && Number.isFinite(cacheWriteRate) ? `缓存写基础价 ${symbol}${formatMoneyAmount(cacheWriteRate)} / ${unit}` : ''
  if (read !== '' && write !== '' && cacheReadRate === cacheWriteRate) return `${money}（缓存基础价 ${symbol}${formatMoneyAmount(cacheReadRate!)} / ${unit}）`
  if (read !== '' && write !== '') return `${money}（${read}；${write}）`
  if (read !== '') return `${money}（${read}）`
  if (write !== '') return `${money}（${write}）`
  return money
}

const PARENT_OPTIONAL_COLUMNS: readonly CostDisplayColumn[] = ['route', 'activity', 'input', 'cache', 'output']
const CHILD_OPTIONAL_COLUMNS: readonly CostDisplayColumn[] = ['sessionId', 'origin', 'route', 'surcharge', 'periodName', 'activity', 'input', 'cache', 'output']

export function optionalCostTableColumns(level: 'parent' | 'child' = 'parent'): readonly CostDisplayColumn[] {
  return level === 'child' ? CHILD_OPTIONAL_COLUMNS : PARENT_OPTIONAL_COLUMNS
}

export function defaultVisibleCostColumns(view: CostView, level: 'parent' | 'child' = 'parent'): CostDisplayColumn[] {
  const source = level === 'child' ? CHILD_OPTIONAL_COLUMNS : PARENT_OPTIONAL_COLUMNS
  return source.filter(key => (level === 'parent' && view === 'model' ? key !== 'route' : true) && (level === 'child' && view === 'model' ? key !== 'route' : true))
}

export function resolveVisibleCostColumns(view: CostView, selected: readonly CostDisplayColumn[], level: 'parent' | 'child' = 'parent'): CostDisplayColumn[] {
  const allowed = new Set(optionalCostTableColumns(level))
  const picked = selected.filter(key => allowed.has(key) && (view !== 'model' || key !== 'route'))
  return ['dimension', ...picked, 'usage']
}

export function filterCostTableRows(rows: readonly CostTableRow[], filter: CostTableFilter, unitTokens = 1_000_000, symbol = ''): CostTableRow[] {
  return rows.filter(row => {
    for (const [key, raw] of Object.entries(filter) as Array<[CostDisplayColumn, string | undefined]>) {
      if (raw === undefined) continue
      const needle = raw.trim().toLowerCase()
      if (needle === '') continue
      if (!displayCellText(row, key, unitTokens, symbol).toLowerCase().includes(needle)) return false
    }
    return true
  })
}

export function sortCostTableRows(rows: readonly CostTableRow[], sort: CostTableSort): CostTableRow[] {
  const direction = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    const leftValue = displaySortValue(left, sort.key)
    const rightValue = displaySortValue(right, sort.key)
    const compared = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), 'zh-CN')
    return compared === 0 ? left.id.localeCompare(right.id) : compared * direction
  })
}

export function queryCostTable(
  entries: readonly HourlySessionEntry[],
  view: CostView,
  filter: CostTableFilter,
  sort: CostTableSort,
): CostTableRow[] {
  return sortCostTableRows(filterCostTableRows(flattenCostTableRows(entries, view), filter), sort)
}

export interface CostTableGroup {
  id: string
  summary: CostTableRow
  children: CostTableRow[]
}

function uniqueText(values: readonly string[]): string {
  const unique = [...new Set(values.filter(value => value !== ''))]
  return unique.length === 1 ? unique[0]! : ''
}

function uniqueRate(values: readonly (number | null)[]): number | null {
  const unique = [...new Set(values.filter((value): value is number => value !== null))]
  return unique.length === 1 ? unique[0]! : null
}

function summarizeCostGroup(id: string, dimension: string, children: readonly CostTableRow[]): CostTableRow {
  const totals = costTableTotals(children)
  return {
    id,
    dimension,
    date: uniqueText(children.map(row => row.date)),
    hour: uniqueText(children.map(row => row.hour)),
    hourLabel: uniqueText(children.map(row => row.hourLabel)),
    sessionId: uniqueText(children.map(row => row.sessionId)),
    origin: uniqueText(children.map(row => row.origin)),
    route: uniqueText(children.map(row => row.route)),
    periodName: uniqueText(children.map(row => row.periodName)),
    surcharge: uniqueText(children.map(row => row.surcharge)),
    ...totals,
    inputRate: uniqueRate(children.map(row => row.inputRate)),
    cacheReadRate: uniqueRate(children.map(row => row.cacheReadRate)),
    cacheWriteRate: uniqueRate(children.map(row => row.cacheWriteRate)),
    outputRate: uniqueRate(children.map(row => row.outputRate)),
  }
}

/** Collapse filtered hourly rows into one date or model summary with expandable children. */
export function groupCostTableRows(rows: readonly CostTableRow[], view: CostView): CostTableGroup[] {
  const buckets = new Map<string, CostTableRow[]>()
  for (const row of rows) {
    const key = view === 'model' ? row.route : row.date
    const list = buckets.get(key)
    if (list === undefined) buckets.set(key, [row])
    else list.push(row)
  }
  return [...buckets.entries()].map(([key, children]) => {
    const dimension = key === '' ? '-' : key
    const id = `${view}:${dimension}`
    return {
      id,
      summary: summarizeCostGroup(id, dimension, children),
      children: children.map(child => ({
        ...child,
        dimension: view === 'model' ? `${child.date} ${child.hourLabel}` : child.hourLabel,
      })),
    }
  })
}

export function defaultChildCostTableSort(_view: CostView): CostTableSort {
  return { key: 'dimension', dir: 'asc' }
}

/** Filter hourly details, then group and sort summaries for the expandable table. */
export function queryCostTableGroups(
  entries: readonly HourlySessionEntry[],
  view: CostView,
  filter: CostTableFilter,
  sort: CostTableSort,
  childFilter: CostTableFilter = {},
  childSort: CostTableSort = defaultChildCostTableSort(view),
  unitTokens = 1_000_000,
  symbol = '',
): CostTableGroup[] {
  const groups = groupCostTableRows(filterCostTableRows(flattenCostTableRows(entries, view), filter, unitTokens, symbol), view)
  const order = new Map(groups.map(group => [group.summary.id, group]))
  return sortCostTableRows(groups.map(group => group.summary), sort).flatMap(summary => {
    const group = order.get(summary.id)
    if (group === undefined) return []
    const children = sortCostTableRows(filterCostTableRows(group.children, childFilter, unitTokens, symbol), childSort)
    return [{ ...group, children }]
  })
}

export function costTableColumnValues(rows: readonly CostTableRow[], key: CostDisplayColumn, unitTokens = 1_000_000, symbol = ''): string[] {
  return [...new Set(rows.map(row => displayCellText(row, key, unitTokens, symbol)).filter(value => value !== ''))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

export function toggleCostTableSort(current: CostTableSort, key: CostDisplayColumn): CostTableSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: NUMERIC_DISPLAY_COLUMNS.has(key) ? 'desc' : 'asc' }
}

export function defaultCostTableSort(view: CostView): CostTableSort {
  return { key: 'dimension', dir: view === 'model' ? 'asc' : 'desc' }
}

export function isNumericCostTableColumn(key: CostDisplayColumn): boolean {
  return NUMERIC_DISPLAY_COLUMNS.has(key)
}

export function costTableTotals(rows: readonly CostTableRow[]): Pick<CostTableRow, 'turns' | 'steps' | 'toolCalls' | 'inputTokens' | 'inputCost' | 'cacheTokens' | 'cacheCost' | 'outputTokens' | 'outputCost' | 'cacheRate' | 'cost'> {
  const out = {
    turns: 0, steps: 0, toolCalls: 0, inputTokens: 0, inputCost: 0,
    cacheTokens: 0, cacheCost: 0, outputTokens: 0, outputCost: 0, cacheRate: 0, cost: 0,
  }
  for (const row of rows) {
    out.turns += row.turns
    out.steps += row.steps
    out.toolCalls += row.toolCalls
    out.inputTokens += row.inputTokens
    out.inputCost += row.inputCost
    out.cacheTokens += row.cacheTokens
    out.cacheCost += row.cacheCost
    out.outputTokens += row.outputTokens
    out.outputCost += row.outputCost
    out.cost += row.cost
  }
  const totalTokens = out.inputTokens + out.cacheTokens + out.outputTokens
  out.cacheRate = totalTokens > 0 ? out.cacheTokens / totalTokens : 0
  return out
}
