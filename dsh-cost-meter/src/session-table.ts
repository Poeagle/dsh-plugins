/** Pure session-overview query helpers shared by the host tests and the dock UI. */

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
