/** Pure session-overview query helpers shared by the host tests and the dock UI. */

export interface SessionTableCost {
  cost: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  route?: string | null
  hourly?: ReadonlyArray<{ provider: string | null; model: string | null }>
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
