/** Browser cost display and model-aware pricing settings card. */

import type { Context } from '@deepseek-ai/cordis'
import React from 'react'
import type { ContextSurcharge, ModelAssignment, PricingConfig, PricingGroup, PricingPeriod } from './pricing.js'
import { collapseBalanceChips, walletHref } from './provider-balance.js'
import { DEFAULT_GROUP, DEFAULT_PRICING, formatTokenThreshold, lastUpdatedAt, normalizePricing, validatePricing } from './pricing.js'
import {
  costTableColumnValues,
  costTableTotals,
  defaultChildCostTableSort,
  defaultCostTableSort,
  defaultVisibleCostColumns,
  displayCellText,
  flattenHourlyEntries,
  localDateOfHour,
  localTodayDate,
  mapWithConcurrency,
  mergeListedSessionCost,
  optionalCostTableColumns,
  overviewCost,
  queryCostTable,
  queryCostTableGroups,
  resolveVisibleCostColumns,
  toggleCostTableSort,
  type CostDisplayColumn,
  type CostTableFilter,
  type CostTableRow,
  type CostTableSort,
  type CostView,
  type HourlySessionEntry,
  type HourlySlice,
} from './session-table.js'

export const inject = ['slots', 'remote', 'remote.session']

function browserInterval(callback: () => void, delay: number): () => void {
  const id = window.setInterval(callback, delay)
  return () => window.clearInterval(id)
}

interface CostFold {
  cost: number
  inputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  outputCost: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  provider?: string | null
  model?: string | null
  route?: string | null
  currency: string
  unitTokens: number
  pricingSource?: string | null
  pricingPeriod?: string | null
  groupId?: string | null
  groupName?: string | null
  details?: CostDetail[]
  hourly?: HourlyDetail[]
  subagents?: CostSubagent[]
}

interface CostSubagent extends CostFold {
  sessionId: string
  children: CostSubagent[]
}

interface CostDetail {
  source: string
  periodName: string | null
  provider: string | null
  model: string | null
  groupId?: string
  groupName?: string
  rates: { input: number; cacheRead: number; cacheWrite: number; output: number }
  periodMultiplier?: number
  discountMultiplier?: number
  modelMultiplier?: number
  contextMultiplier?: number
  contextAfterTokens?: number | null
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

interface HourlyDetail {
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
  groupId?: string | null
  groupName?: string | null
  contextMultiplier?: number
  contextAfterTokens?: number | null
  rates?: { input?: number; cacheRead?: number; cacheWrite?: number; output?: number } | null
}

interface SessionCostRecord {
  sessionId: string
  parentSession: string | null
  origin: string | null
  cost: CostFold
}
interface RemoteEnvelope<T> { ok: boolean; value?: T; error?: unknown }
interface RemoteMount { $mount(contribution: unknown): Promise<() => Promise<void>> }
interface ProviderBalance {
  provider: string
  name: string
  origin?: string
  remaining: number | null
  unit: string
  mode: string | null
  error?: string
  observedAt: number
}

interface CostMeterFace {
  sessionCost(sessionId: string): Promise<RemoteEnvelope<CostFold | null>>
  sessionCosts(): Promise<RemoteEnvelope<SessionCostRecord[]>>
  providerBalances(): Promise<RemoteEnvelope<ProviderBalance[]>>
}
interface SlotsFace {
  inject(name: string, fn: () => unknown): void
  register(spec: Record<string, unknown>, component: React.ComponentType<any>): unknown
}
interface SettingsSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value?: PricingConfig
  revision?: number
  writable: boolean
}
interface ModelItem { id: string; name: string }
interface ModelGroup { id: string; name: string; models: ModelItem[] }
interface CatalogSnapshot { status: 'loading' | 'ready' | 'error'; groups: ModelGroup[] }
interface Observable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
interface SessionListItem {
  sessionId: string
  parentSessionId?: string
  origin?: string
}
interface SessionRemoteFace {
  modelCatalog(): Promise<{ ok: boolean; value?: { groups: ModelGroup[] } }>
}
interface ApiFace {
  sessions?: { list(input: {}): Promise<{ result: { ok: boolean; value?: { items: SessionListItem[] }; error?: unknown } }> }
}
function remoteErrorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return error === undefined ? '未知错误' : String(error)
}

const SESSION_COST_CONCURRENCY = 8

async function loadAllSessionCosts(costMeter: CostMeterFace, sessions: ApiFace['sessions']): Promise<SessionCostRecord[]> {
  const remote = await costMeter.sessionCosts()
  if (remote.ok && Array.isArray(remote.value)) return remote.value
  if (sessions === undefined) {
    throw new Error(remoteErrorText(remote.error) || '会话费用加载失败')
  }
  const listed = await sessions.list({})
  if (!listed.result.ok || listed.result.value === undefined) {
    throw new Error(remoteErrorText(remote.error ?? listed.result.error) || '会话费用加载失败')
  }
  const unique: SessionListItem[] = []
  const seen = new Set<string>()
  for (const item of listed.result.value.items) {
    if (item.sessionId === '' || seen.has(item.sessionId)) continue
    seen.add(item.sessionId)
    unique.push(item)
  }
  const loaded = await mapWithConcurrency(unique, SESSION_COST_CONCURRENCY, async item => {
    const response = await costMeter.sessionCost(item.sessionId)
    if (!response.ok || response.value === null || response.value === undefined) return null
    return mergeListedSessionCost(item, response.value)
  })
  return loaded.filter((row): row is SessionCostRecord => row !== null)
}

const PRICING_ROUTE = '/cost-meter/pricing'

/**
 * Pricing config source backed by the plugin's own host route. dsh's settings
 * RPC only serves an explicit allowlist of namespaces, so the card reads and
 * writes through this route instead of settings.describe (same pattern as the
 * modlens settings card).
 */
class PricingRouteSource implements Observable<SettingsSnapshot> {
  private snapshot: SettingsSnapshot = { status: 'loading', writable: true }
  private readonly listeners = new Set<() => void>()
  getSnapshot = (): SettingsSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  async load(): Promise<void> {
    try {
      const response = await fetch(PRICING_ROUTE, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        this.snapshot = { status: 'unavailable', writable: false }
      } else {
        const body = (await response.json()) as { ok: boolean; value?: PricingConfig }
        if (body.ok && body.value) {
          const previous = this.snapshot.value
          const changed = previous === undefined || JSON.stringify(previous) !== JSON.stringify(body.value)
          this.snapshot = {
            status: 'ready',
            value: body.value,
            revision: (this.snapshot.revision ?? 0) + (changed ? 1 : 0),
            writable: true,
          }
        } else {
          this.snapshot = { status: 'unavailable', writable: false }
        }
      }
    } catch {
      this.snapshot = { status: 'unavailable', writable: false }
    }
    for (const listener of this.listeners) listener()
  }
  async save(config: PricingConfig): Promise<string | null> {
    try {
      const response = await fetch(PRICING_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(normalizePricing(config)),
      })
      const body = (await response.json()) as { ok?: boolean; value?: PricingConfig; error?: unknown }
      if (!response.ok || body.ok !== true || body.value === undefined) {
        return typeof body.error === 'string' && body.error !== '' ? body.error : `保存失败（HTTP ${response.status}）`
      }
      this.snapshot = { status: 'ready', value: body.value, revision: (this.snapshot.revision ?? 0) + 1, writable: true }
      for (const listener of this.listeners) listener()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : '保存失败，请检查配置或刷新后重试。'
    }
  }
}

class CatalogSource implements Observable<CatalogSnapshot> {
  private snapshot: CatalogSnapshot = { status: 'loading', groups: [] }
  private readonly listeners = new Set<() => void>()
  constructor(private readonly session: SessionRemoteFace | undefined) {}
  getSnapshot = (): CatalogSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  load = async (): Promise<void> => {
    if (this.session === undefined) {
      this.snapshot = { status: 'error', groups: [] }
    } else {
      try {
        const response = await this.session.modelCatalog()
        this.snapshot = response.ok && response.value
          ? { status: 'ready', groups: response.value.groups }
          : { status: 'error', groups: [] }
      } catch {
        this.snapshot = { status: 'error', groups: [] }
      }
    }
    for (const listener of this.listeners) listener()
  }
}

const cloneConfig = (value?: PricingConfig): PricingConfig => normalizePricing(JSON.parse(JSON.stringify(value ?? DEFAULT_PRICING)))
const money = (value: number): string => value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)
const currencySymbol = (currency: string): string => ({ CNY: '¥', USD: '$', EUR: '€', JPY: '¥' })[currency.toUpperCase()] ?? `${currency} `
const inputStyle: React.CSSProperties = { height: 32, minWidth: 0, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '0 9px', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 12 }
const buttonStyle: React.CSSProperties = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '5px 10px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: 12, cursor: 'pointer' }
const primaryButtonStyle: React.CSSProperties = { ...buttonStyle, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' }
function newGroupId(groups: readonly PricingGroup[]): string {
  const used = new Set(groups.map(group => group.id))
  let index = 1
  while (used.has(`group-${index}`)) index += 1
  return `group-${index}`
}

function NumberInput(props: { value: number | undefined; placeholder?: string; onChange(value: number | undefined): void }) {
  return React.createElement('input', {
    style: inputStyle,
    type: 'number', min: 0, step: 'any', inputMode: 'decimal',
    value: props.value ?? '', placeholder: props.placeholder ?? '',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value === '' ? undefined : Number(event.target.value)),
  })
}

function field(label: string, child: React.ReactNode): React.ReactElement {
  return React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, label, child)
}

const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY']
const TIMEZONES = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris']
const UNIT_TOKEN_OPTIONS = [1_000, 1_000_000]
const INTERVAL_OPTIONS = [5, 15, 30, 60, 120, 360, 1440]
const CONCURRENCY_OPTIONS = [1, 2, 4, 8]
const CACHE_MULT_OPTIONS = [0, 0.02, 0.1, 0.25, 0.5, 1]
const PERIOD_MULT_OPTIONS = [0.25, 0.5, 0.8, 1, 1.5, 2]
const WEEKDAY_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
] as const
const SURCHARGE_AFTER_OPTIONS = [32_000, 64_000, 128_000, 200_000, 256_000, 1_000_000]
const SURCHARGE_MULT_OPTIONS = [1.5, 2, 3]

function withCurrent(options: readonly number[], value: number | undefined): number[] {
  if (value === undefined || !Number.isFinite(value) || options.includes(value)) return [...options]
  return [...options, value].sort((left, right) => left - right)
}

function Select(props: { value: string; options: Array<{ value: string; label: string }>; onChange(value: string): void }) {
  return React.createElement('select', {
    style: inputStyle,
    value: props.value,
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onChange(event.target.value),
  }, ...props.options.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label)))
}

function NumberSelect(props: { value: number; options: readonly number[]; format?(value: number): string; onChange(value: number): void }) {
  const format = props.format ?? ((value: number) => String(value))
  return React.createElement(Select, {
    value: String(props.value),
    options: withCurrent(props.options, props.value).map(value => ({ value: String(value), label: format(value) })),
    onChange: next => props.onChange(Number(next)),
  })
}

function formatProbeTime(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatUnitTokens(value: number): string {
  return value === 1_000_000 ? '每 1M tokens' : value === 1_000 ? '每 1K tokens' : `每 ${value.toLocaleString('zh-CN')} tokens`
}

function PeriodEditor(props: { period: PricingPeriod; onChange(period: PricingPeriod): void; onRemove(): void }) {
  const set = <K extends keyof PricingPeriod>(key: K, value: PricingPeriod[K]) => props.onChange({ ...props.period, [key]: value })
  const selected = new Set(props.period.days ?? WEEKDAY_OPTIONS.map(option => option.value))
  const allDay = props.period.start === props.period.end
  const toggleDay = (day: number) => {
    const next = new Set(selected)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    if (next.size === 0 || next.size === WEEKDAY_OPTIONS.length) {
      const rest = { ...props.period }
      delete rest.days
      props.onChange(rest)
      return
    }
    set('days', [...next].sort((left, right) => left - right))
  }
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 100px 100px 96px auto', gap: 8, alignItems: 'end' } },
      field('时段名称', React.createElement('input', { style: inputStyle, value: props.period.name, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('name', event.target.value) })),
      field('开始', React.createElement('input', { style: inputStyle, type: 'time', value: allDay ? '00:00' : props.period.start, disabled: allDay, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('start', event.target.value) })),
      field('结束', React.createElement('input', { style: inputStyle, type: 'time', value: allDay ? '00:00' : props.period.end, disabled: allDay, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('end', event.target.value) })),
      field('倍率', React.createElement(NumberSelect, { value: props.period.multiplier, options: PERIOD_MULT_OPTIONS, format: value => `×${value}`, onChange: value => set('multiplier', value) })),
      React.createElement('button', { type: 'button', style: buttonStyle, onClick: props.onRemove }, '删除'),
    ),
    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: allDay,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onChange(event.target.checked
            ? { ...props.period, start: '00:00', end: '00:00' }
            : { ...props.period, start: '08:00', end: '22:00' }),
        }),
        '全天',
      ),
      ...WEEKDAY_OPTIONS.map(option => React.createElement('label', { key: option.value, style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 } },
        React.createElement('input', { type: 'checkbox', checked: selected.has(option.value), onChange: () => toggleDay(option.value) }),
        option.label,
      )),
    ),
  )
}

function PeriodsEditor(props: { periods: PricingPeriod[]; onChange(periods: PricingPeriod[]): void }) {
  const add = () => props.onChange([...props.periods, { id: `period-${Date.now()}-${props.periods.length}`, name: '低峰', start: '00:00', end: '08:00', multiplier: 1 }])
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    ...props.periods.map((period, index) => React.createElement(PeriodEditor, {
      key: period.id, period,
      onChange: next => props.onChange(props.periods.map((item, at) => at === index ? next : item)),
      onRemove: () => props.onChange(props.periods.filter((_item, at) => at !== index)),
    })),
    React.createElement('button', { type: 'button', style: { ...buttonStyle, alignSelf: 'flex-start' }, onClick: add }, '+ 添加时段倍率'),
  )
}

function ContextSurchargesEditor(props: { tiers: ContextSurcharge[]; hint?: string; onChange(tiers: ContextSurcharge[]): void }) {
  const add = () => props.onChange([...props.tiers, { afterTokens: 200_000, multiplier: 2 }])
  const set = (index: number, next: ContextSurcharge) => props.onChange(props.tiers.map((item, at) => at === index ? next : item))
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, props.hint ?? '单次请求上下文（未缓存输入 + 缓存读 + 缓存写）超过阈值后，该请求整单费用按倍率计。输出不计入阈值。'),
    ...props.tiers.map((tier, index) => React.createElement('div', {
      key: `${tier.afterTokens}-${index}`,
      style: { display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(100px, 160px) auto', gap: 8, alignItems: 'end' },
    },
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '超过 Token 数', React.createElement(NumberSelect, {
        value: tier.afterTokens,
        options: SURCHARGE_AFTER_OPTIONS,
        format: formatTokenThreshold,
        onChange: value => set(index, { ...tier, afterTokens: value }),
      })),
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '整单倍率', React.createElement(NumberSelect, {
        value: tier.multiplier,
        options: SURCHARGE_MULT_OPTIONS,
        format: value => `×${value}`,
        onChange: value => set(index, { ...tier, multiplier: value }),
      })),
      React.createElement('button', { type: 'button', style: buttonStyle, onClick: () => props.onChange(props.tiers.filter((_item, at) => at !== index)) }, '删除'),
    )),
    React.createElement('button', { type: 'button', style: { ...buttonStyle, alignSelf: 'flex-start' }, onClick: add }, '+ 添加上下文翻倍'),
  )
}

interface CatalogRoute {
  key: string
  providerId: string
  providerName: string
  modelId: string
  modelName: string
}

function catalogRoutes(catalog: CatalogSnapshot): CatalogRoute[] {
  return catalog.groups.flatMap(provider => provider.models.map(model => ({
    key: `${provider.id}/${model.id}`,
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    modelName: model.name,
  })))
}

function routeFromKey(key: string, catalog: CatalogSnapshot): CatalogRoute {
  const found = catalogRoutes(catalog).find(route => route.key === key)
  if (found !== undefined) return found
  const slash = key.indexOf('/')
  const providerId = slash === -1 ? key : key.slice(0, slash)
  const modelId = slash === -1 ? key : key.slice(slash + 1)
  return { key, providerId, providerName: providerId, modelId, modelName: modelId }
}

function GroupModelRow(props: {
  route: CatalogRoute
  assignment: ModelAssignment
  onChange(assignment: ModelAssignment): void
  onRemove(): void
}) {
  const set = (next: ModelAssignment) => props.onChange(next)
  const updatedAt = lastUpdatedAt(props.assignment)
  return React.createElement('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 8 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, props.route.modelName),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 } }, props.route.key),
      ),
      React.createElement('button', { type: 'button', style: buttonStyle, onClick: props.onRemove }, '移出'),
    ),
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(110px, 1fr) minmax(110px, 1fr) auto', gap: 8, alignItems: 'end' } },
      field('优惠倍率', React.createElement(NumberInput, {
        value: props.assignment.discountMultiplier,
        placeholder: '1',
        onChange: value => set({ ...props.assignment, discountMultiplier: value }),
      })),
      field('模型倍率', React.createElement(NumberInput, {
        value: props.assignment.modelMultiplier,
        placeholder: '1',
        onChange: value => set({ ...props.assignment, modelMultiplier: value }),
      })),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--dsw-alias-label-secondary)', paddingBottom: 6 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: props.assignment.reasoningExtra === true,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const next = { ...props.assignment }
            if (event.target.checked) next.reasoningExtra = true
            else delete next.reasoningExtra
            set(next)
          },
        }),
        '推理另计',
      ),
    ),
    updatedAt === null ? null : React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, `更新 ${formatProbeTime(updatedAt)}`),
  )
}

function GroupModelPicker(props: {
  groupId: string
  groups: PricingGroup[]
  models: Record<string, ModelAssignment>
  catalog: CatalogSnapshot
  onAdd(keys: string[]): void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const groupName = (id: string): string => props.groups.find(group => group.id === id)?.name ?? id
  const needle = query.trim().toLowerCase()
  const candidates = catalogRoutes(props.catalog)
    .filter(route => props.models[route.key]?.groupId !== props.groupId)
    .filter(route => needle === '' || `${route.key} ${route.providerName} ${route.modelName}`.toLowerCase().includes(needle))
  const visibleKeys = candidates.map(route => route.key)
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every(key => selected.has(key))
  const toggle = (key: string) => setSelected(current => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleVisible = () => setSelected(current => {
    const next = new Set(current)
    if (allVisibleSelected) {
      for (const key of visibleKeys) next.delete(key)
    } else {
      for (const key of visibleKeys) next.add(key)
    }
    return next
  })
  const add = (keys: string[]) => {
    if (keys.length === 0) return
    props.onAdd(keys)
    setSelected(current => {
      const next = new Set(current)
      for (const key of keys) next.delete(key)
      return next
    })
  }
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    React.createElement('button', { type: 'button', style: { ...buttonStyle, alignSelf: 'flex-start' }, onClick: () => setOpen(!open) }, open ? '收起模型目录' : '+ 向此分组添加模型'),
    open ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: 10 } },
      React.createElement('input', {
        style: inputStyle,
        value: query,
        placeholder: '搜索 provider / 模型…',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
      }),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          React.createElement('input', { type: 'checkbox', checked: allVisibleSelected, disabled: visibleKeys.length === 0, onChange: toggleVisible }),
          visibleKeys.length === 0 ? '无可添加模型' : `全选当前列表（${visibleKeys.length}）`,
        ),
        React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, selected.size > 0 ? `已选 ${selected.size}` : '可多选后一次加入'),
      ),
      React.createElement('div', { style: { maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column' } },
        candidates.length === 0 ? React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, props.catalog.status === 'loading' ? '正在加载模型…' : '没有可添加的模型') : null,
        ...candidates.map(route => {
          const current = props.models[route.key]
          return React.createElement('label', {
            key: route.key,
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--dsw-alias-border-l2)', fontSize: 12 },
          },
            React.createElement('input', { type: 'checkbox', checked: selected.has(route.key), onChange: () => toggle(route.key) }),
            React.createElement('span', { style: { flex: 1, minWidth: 0 } },
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, route.modelName),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', marginLeft: 8 } }, route.key),
            ),
            current !== undefined ? React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, `现属 ${groupName(current.groupId)}`) : null,
          )
        }),
      ),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        React.createElement('button', { type: 'button', style: primaryButtonStyle, disabled: selected.size === 0, onClick: () => add([...selected]) }, selected.size === 0 ? '添加所选' : `添加所选（${selected.size}）`),
      ),
    ) : null,
  )
}

function GroupEditor(props: {
  group: PricingGroup
  config: PricingConfig
  catalog: CatalogSnapshot
  onChange(config: PricingConfig): void
  onRemove(): void
}) {
  const [collapsed, setCollapsed] = React.useState(props.group.id !== 'default')
  const [modelsOpen, setModelsOpen] = React.useState(true)
  const setGroup = (next: PricingGroup) => props.onChange({
    ...props.config,
    groups: props.config.groups.map(group => group.id === props.group.id ? next : group),
  })
  const set = <K extends keyof PricingGroup>(key: K, value: PricingGroup[K]) => setGroup({ ...props.group, [key]: value })
  const assigned = Object.entries(props.config.models)
    .filter(([, assignment]) => assignment.groupId === props.group.id)
    .sort(([left], [right]) => left.localeCompare(right))
  const setAssignment = (key: string, assignment: ModelAssignment) => props.onChange({
    ...props.config,
    models: { ...props.config.models, [key]: assignment },
  })
  const removeModel = (key: string) => {
    const { [key]: _removed, ...models } = props.config.models
    props.onChange({ ...props.config, models })
  }
  const addModels = (keys: string[]) => {
    const models = { ...props.config.models }
    for (const key of keys) {
      const previous = models[key]
      models[key] = previous === undefined
        ? { groupId: props.group.id }
        : { ...previous, groupId: props.group.id }
    }
    props.onChange({ ...props.config, models })
  }
  return React.createElement('div', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }, onClick: () => setCollapsed(!collapsed) },
      React.createElement('span', { 'aria-hidden': true, style: { transform: collapsed ? 'rotate(-90deg)' : undefined, transition: 'transform 0.15s', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '▾'),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, props.group.name),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 } }, `${props.group.id} · ${assigned.length} 个模型`),
      ),
      props.config.groups.length > 1 ? React.createElement('button', { type: 'button', style: buttonStyle, onClick: (event: React.MouseEvent) => { event.stopPropagation(); props.onRemove() } }, '删除分组') : null,
    ),
    collapsed ? null : React.createElement(React.Fragment, null,
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr)', gap: 8 } },
        field('分组名称', React.createElement('input', { style: inputStyle, value: props.group.name, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('name', event.target.value) })),
        field('基准输入', React.createElement(NumberInput, { value: props.group.input, onChange: value => set('input', value ?? 0) })),
        field('基准输出', React.createElement(NumberInput, { value: props.group.output, onChange: value => set('output', value ?? 0) })),
      ),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(140px, 1fr))', gap: 8 } },
        field('缓存读倍率', React.createElement(NumberSelect, { value: props.group.cacheReadMultiplier, options: CACHE_MULT_OPTIONS, format: value => `×${value}`, onChange: value => set('cacheReadMultiplier', value) })),
        field('缓存写倍率', React.createElement(NumberSelect, { value: props.group.cacheWriteMultiplier, options: CACHE_MULT_OPTIONS, format: value => `×${value}`, onChange: value => set('cacheWriteMultiplier', value) })),
      ),
      React.createElement('p', { style: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, `缓存读 = 基准输入 × ${props.group.cacheReadMultiplier}；缓存写 = 基准输入 × ${props.group.cacheWriteMultiplier}。时段与上下文倍率作用于整单。`),
      React.createElement('h4', { style: { margin: '4px 0 0', fontSize: 12, fontWeight: 600 } }, '不同时段倍率'),
      React.createElement(PeriodsEditor, { periods: props.group.periods ?? [], onChange: periods => set('periods', periods) }),
      React.createElement('h4', { style: { margin: '4px 0 0', fontSize: 12, fontWeight: 600 } }, '超过上下文倍率'),
      React.createElement(ContextSurchargesEditor, { tiers: props.group.contextSurcharges ?? [], onChange: contextSurcharges => set('contextSurcharges', contextSurcharges) }),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        React.createElement('button', {
          type: 'button',
          style: { ...buttonStyle, padding: '4px 8px' },
          onClick: () => setModelsOpen(!modelsOpen),
          'aria-expanded': modelsOpen,
        }, modelsOpen ? '收起模型列表' : `展开模型列表（${assigned.length}）`),
        React.createElement('h4', { style: { margin: 0, fontSize: 12, fontWeight: 600 } }, '此分组的模型'),
      ),
      React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '在分组内添加模型，再改每个模型的优惠倍率和模型倍率。一个模型只能属于一个分组；从目录移入会从原分组带走。未加入任何分组的模型使用 default 分组。'),
      assigned.length === 0 ? React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '还没有模型。') : null,
      modelsOpen && assigned.length > 0 ? React.createElement('div', { style: { maxHeight: 320, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '0 10px' } },
        ...assigned.map(([key, assignment]) => React.createElement(GroupModelRow, {
          key,
          route: routeFromKey(key, props.catalog),
          assignment,
          onChange: next => setAssignment(key, next),
          onRemove: () => removeModel(key),
        })),
      ) : null,
      React.createElement(GroupModelPicker, {
        groupId: props.group.id,
        groups: props.config.groups,
        models: props.config.models,
        catalog: props.catalog,
        onAdd: addModels,
      }),
    ),
  )
}

function PricingSettingsCard(props: {
  usePricing<T>(selector: (snapshot: SettingsSnapshot) => T): T
  useCatalog<T>(selector: (snapshot: CatalogSnapshot) => T): T
  refreshCatalog(): Promise<void>
  refreshPricing?(): Promise<void>
  interval?(callback: () => void, delay: number): () => void
  save(config: PricingConfig): Promise<string | null>
}) {
  const settings = props.usePricing(snapshot => snapshot)
  const catalog = props.useCatalog(snapshot => snapshot)
  const [draft, setDraft] = React.useState<PricingConfig>(() => cloneConfig(settings.value))
  const [seedRevision, setSeedRevision] = React.useState(settings.revision)
  const seedJson = React.useRef(JSON.stringify(cloneConfig(settings.value)))
  const acceptRemote = React.useRef(false)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (settings.revision === seedRevision) return
    const next = cloneConfig(settings.value)
    const nextJson = JSON.stringify(next)
    setDraft(current => {
      if (!acceptRemote.current && JSON.stringify(current) !== seedJson.current) return current
      acceptRemote.current = false
      seedJson.current = nextJson
      return next
    })
    setSeedRevision(settings.revision)
    setFailure(null)
  }, [settings.revision, settings.value, seedRevision])
  React.useEffect(() => {
    void props.refreshCatalog()
  }, [props.refreshCatalog])
  React.useEffect(() => {
    if (props.refreshPricing === undefined || props.interval === undefined) return
    const load = () => { void props.refreshPricing?.() }
    load()
    return props.interval(load, 30_000)
  }, [props.refreshPricing, props.interval])
  if (settings.status === 'unavailable') {
    return React.createElement('p', { style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, '费用设置暂不可用。')
  }
  if (settings.status === 'loading' && settings.value === undefined) {
    return React.createElement('p', { style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, '正在加载费用设置…')
  }
  const baseline = cloneConfig(settings.value)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  let invalid: string | null = null
  try { validatePricing(draft) } catch (error) { invalid = error instanceof Error ? error.message : String(error) }
  const setGroups = (groups: PricingGroup[]) => {
    const ids = new Set(groups.map(group => group.id))
    const models = Object.fromEntries(Object.entries(draft.models).flatMap(([key, assignment]) => (
      ids.has(assignment.groupId) ? [[key, assignment]] : []
    )))
    setDraft({ ...draft, groups, models })
  }
  const catalogProviders = [...new Set(catalogRoutes(catalog).map(route => route.providerId))].sort()
  const selectedProviders = new Set(draft.billingProbe?.providers ?? [])
  const save = async () => {
    if (invalid || !dirty) return
    setSaving(true)
    setFailure(null)
    const error = await props.save(draft)
    setSaving(false)
    if (error === null) {
      acceptRemote.current = true
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setFailure(error)
    }
  }
  const timezoneOptions = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES]
  const currencyOptions = CURRENCIES.includes(draft.currency) ? CURRENCIES : [draft.currency, ...CURRENCIES]
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0 16px' } },
      React.createElement('section', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '最终单价 = 分组基准（含缓存 / 时段 / 上下文倍率）× 优惠倍率 × 模型倍率。'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '120px 160px 1fr', gap: 8 } },
          field('币种', React.createElement(Select, { value: draft.currency, options: currencyOptions.map(value => ({ value, label: value })), onChange: value => setDraft({ ...draft, currency: value }) })),
          field('计价单位', React.createElement(NumberSelect, { value: draft.unitTokens, options: UNIT_TOKEN_OPTIONS, format: formatUnitTokens, onChange: value => setDraft({ ...draft, unitTokens: value }) })),
          field('计价时区', React.createElement(Select, { value: draft.timezone, options: timezoneOptions.map(value => ({ value, label: value })), onChange: value => setDraft({ ...draft, timezone: value }) })),
        ),
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 } },
          React.createElement('input', { type: 'checkbox', checked: draft.billingProbe?.enabled === true, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, billingProbe: { ...(draft.billingProbe ?? {}), enabled: event.target.checked } }) }),
          '自动探测上游倍率',
        ),
        draft.billingProbe?.enabled === true ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '160px 120px', gap: 8 } },
          field('探测周期', React.createElement(NumberSelect, { value: draft.billingProbe.intervalMinutes ?? 30, options: INTERVAL_OPTIONS, format: value => value >= 60 ? `${value / 60} 小时` : `${value} 分钟`, onChange: value => setDraft({ ...draft, billingProbe: { ...draft.billingProbe!, intervalMinutes: value } }) })),
          field('并发数', React.createElement(NumberSelect, { value: draft.billingProbe.concurrency ?? 2, options: CONCURRENCY_OPTIONS, onChange: value => setDraft({ ...draft, billingProbe: { ...draft.billingProbe!, concurrency: value } }) })),
        ) : null,
        draft.billingProbe?.enabled === true ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, catalogProviders.length === 0 ? '不限制供应商（目录为空时探测全部已配置模型）' : '探测这些供应商，不选则全部探测'),
          catalogProviders.length === 0 ? null : React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            ...catalogProviders.map(provider => React.createElement('label', { key: provider, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 } },
              React.createElement('input', {
                type: 'checkbox',
                checked: selectedProviders.size === 0 || selectedProviders.has(provider),
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  const next = new Set(selectedProviders)
                  if (selectedProviders.size === 0) {
                    for (const id of catalogProviders) next.add(id)
                  }
                  if (event.target.checked) next.add(provider)
                  else next.delete(provider)
                  const providers = next.size === catalogProviders.length ? undefined : [...next]
                  setDraft({ ...draft, billingProbe: { ...draft.billingProbe!, providers } })
                },
              }),
              provider,
            )),
          ),
        ) : null,
      ),
      React.createElement('section', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '基准费用分组'),
        React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '添加分组，再在分组里选择模型并改每个模型的倍率。未加入任何分组的模型使用 id 为 default 的分组，没有则用第一个分组。'),
        ...draft.groups.map(group => React.createElement(GroupEditor, {
          key: group.id,
          group,
          config: draft,
          catalog,
          onChange: setDraft,
          onRemove: () => setGroups(draft.groups.filter(item => item.id !== group.id)),
        })),
        React.createElement('button', {
          type: 'button',
          style: { ...buttonStyle, alignSelf: 'flex-start' },
          onClick: () => setGroups([...draft.groups, {
            ...DEFAULT_GROUP,
            id: newGroupId(draft.groups),
            name: '新分组',
            periods: [],
            contextSurcharges: [],
          }]),
        }, '+ 添加基准费用分组'),
      ),
      catalog.status === 'error' ? React.createElement('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error)' } }, '模型目录加载失败，仍可编辑已加入分组的模型。') : null,
      invalid ? React.createElement('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error)' } }, invalid) : null,
      failure ? React.createElement('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error)' } }, failure) : null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 12 } },
        React.createElement('button', { type: 'button', style: buttonStyle, disabled: !dirty || saving, onClick: () => setDraft(baseline) }, '放弃修改'),
        React.createElement('button', { type: 'button', style: primaryButtonStyle, disabled: !dirty || saving || invalid !== null, onClick: save }, saving ? '保存中…' : saved ? '✓ 保存成功' : '保存'),
      ),
  )
}

const FILTER_INPUT: React.CSSProperties = { ...inputStyle, height: 22, width: '100%', minWidth: 56, fontSize: 11, padding: '0 6px', boxSizing: 'border-box', fontWeight: 400 }
const TABLE_BORDER = '1px solid var(--dsw-alias-border-l2)'
const TABLE_CELL: React.CSSProperties = { fontSize: 12, padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap', border: TABLE_BORDER, verticalAlign: 'middle' }
const TABLE_CELL_LEFT: React.CSSProperties = { ...TABLE_CELL, textAlign: 'left' }
const TABLE_HEAD: React.CSSProperties = { ...TABLE_CELL, fontWeight: 600, background: 'var(--dsw-alias-bg-layer-3, #f5f5f5)', position: 'sticky', top: 0, zIndex: 2, verticalAlign: 'top' }
const TABLE_HEAD_LEFT: React.CSSProperties = { ...TABLE_HEAD, textAlign: 'left' }

const COST_COLUMNS: Array<{ key: CostDisplayColumn; label: string; left?: boolean; compact?: boolean }> = [
  { key: 'dimension', label: '分组', left: true },
  { key: 'sessionId', label: '会话', left: true },
  { key: 'origin', label: '来源', left: true },
  { key: 'route', label: '模型', left: true },
  { key: 'surcharge', label: '翻倍' },
  { key: 'periodName', label: '计价时段', left: true },
  { key: 'activity', label: '用量' },
  { key: 'input', label: '输入', compact: true },
  { key: 'cache', label: '缓存', compact: true },
  { key: 'output', label: '输出', compact: true },
  { key: 'usage', label: '合计', compact: true },
]

const COLUMN_BY_KEY = new Map(COST_COLUMNS.map(column => [column.key, column]))

function columnLabel(key: CostDisplayColumn, view: CostView, level: 'parent' | 'child'): string {
  if (key === 'dimension') {
    if (level === 'child') return view === 'model' ? '时段' : '时段'
    return view === 'model' ? '模型' : '日期'
  }
  return COLUMN_BY_KEY.get(key)?.label ?? key
}

function formatCostCell(row: CostTableRow, key: CostDisplayColumn, symbol: string, unitTokens: number): string {
  if (key === 'sessionId' && row.sessionId.length > 12) return `${row.sessionId.slice(0, 8)}…`
  const text = displayCellText(row, key, unitTokens, symbol)
  return text === '' ? '-' : text
}

function asHourlyEntry(sessionId: string, origin: string | null, parentSession: string | null, entry: HourlySlice): HourlySessionEntry {
  return { sessionId, origin, parentSession, entry }
}

function flattenFoldEntries(sessionId: string, fold: CostFold | null, origin: string | null = null, parentSession: string | null = null): HourlySessionEntry[] {
  if (fold === null) return []
  const own = (fold.hourly ?? []).flatMap(entry => entry.hour ? [asHourlyEntry(sessionId, origin, parentSession, entry)] : [])
  const children = (fold.subagents ?? []).flatMap(child => flattenFoldEntries(child.sessionId, child, 'subagent', sessionId))
  return [...own, ...children]
}

type CostColumnDef = (typeof COST_COLUMNS)[number]

function CostTable(props: { entries: readonly HourlySessionEntry[]; symbol: string; unitTokens: number; empty: string }) {
  const [view, setView] = React.useState<CostView>('time')
  const [sort, setSort] = React.useState<CostTableSort>(() => defaultCostTableSort('time'))
  const [filter, setFilter] = React.useState<CostTableFilter>({})
  const [childSort, setChildSort] = React.useState<CostTableSort>(() => defaultChildCostTableSort('time'))
  const [childFilter, setChildFilter] = React.useState<CostTableFilter>({})
  const [selected, setSelected] = React.useState<CostDisplayColumn[]>(() => defaultVisibleCostColumns('time'))
  const [childSelected, setChildSelected] = React.useState<CostDisplayColumn[]>(() => defaultVisibleCostColumns('time', 'child'))
  const [columnMenu, setColumnMenu] = React.useState<'parent' | 'child' | null>(null)
  const [filterMenu, setFilterMenu] = React.useState<{ level: 'parent' | 'child'; key: CostDisplayColumn } | null>(null)
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set())
  const setViewMode = (next: CostView) => {
    setView(next)
    setSort(defaultCostTableSort(next))
    setChildSort(defaultChildCostTableSort(next))
    setSelected(defaultVisibleCostColumns(next))
    setChildSelected(defaultVisibleCostColumns(next, 'child'))
    setColumnMenu(null)
    setExpanded(new Set())
  }
  const parentColumns = resolveVisibleCostColumns(view, selected, 'parent').flatMap(key => {
    const column = COLUMN_BY_KEY.get(key)
    return column === undefined ? [] : [column]
  })
  const childColumns = resolveVisibleCostColumns(view, childSelected, 'child').flatMap(key => {
    const column = COLUMN_BY_KEY.get(key)
    return column === undefined ? [] : [column]
  })
  const allRows = queryCostTable(props.entries, view, {}, defaultCostTableSort(view))
  const groups = queryCostTableGroups(props.entries, view, filter, sort, childFilter, childSort, props.unitTokens, props.symbol)
  const childRows = groups.flatMap(group => group.children)
  const detailCount = childRows.length
  const totals = costTableTotals(childRows)
  const patchFilter = (setter: React.Dispatch<React.SetStateAction<CostTableFilter>>) => (key: CostDisplayColumn, value: string) => setter(current => {
    const next = { ...current }
    if (value === '') delete next[key]
    else next[key] = value
    return next
  })
  const setFilterValue = patchFilter(setFilter)
  const setChildFilterValue = patchFilter(setChildFilter)
  const toggleGroup = (id: string) => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const headerButton = (column: CostColumnDef, current: CostTableSort, onSort: React.Dispatch<React.SetStateAction<CostTableSort>>, level: 'parent' | 'child') => {
    const active = current.key === column.key
    const mark = !active ? '' : current.dir === 'asc' ? ' ↑' : ' ↓'
    return React.createElement('button', {
      type: 'button',
      'aria-sort': active ? (current.dir === 'asc' ? 'ascending' : 'descending') : 'none',
      onClick: () => onSort(prev => toggleCostTableSort(prev, column.key)),
      style: { border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: 'inherit', fontWeight: 600, color: 'inherit', whiteSpace: 'nowrap' },
    }, `${columnLabel(column.key, view, level)}${mark}`)
  }
  const filterControl = (column: CostColumnDef, current: CostTableFilter, onChange: (key: CostDisplayColumn, value: string) => void, rows: readonly CostTableRow[], level: 'parent' | 'child') => {
    const options = costTableColumnValues(rows, column.key, props.unitTokens, props.symbol)
    const value = current[column.key] ?? ''
    const open = filterMenu?.level === level && filterMenu.key === column.key
    const control = column.compact !== true && options.length > 0 && options.length <= 16
      ? React.createElement('select', { style: FILTER_INPUT, value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(column.key, event.target.value) }, React.createElement('option', { value: '' }, '全部'), ...options.map(option => React.createElement('option', { key: option, value: option }, option)))
      : React.createElement('input', { style: FILTER_INPUT, value, placeholder: '筛选', onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(column.key, event.target.value) })
    return React.createElement('div', { style: { position: 'relative', display: 'inline-flex' } },
      React.createElement('button', { type: 'button', title: `筛选${columnLabel(column.key, view, level)}`, 'aria-label': `筛选${columnLabel(column.key, view, level)}`, 'aria-expanded': open, onClick: () => setFilterMenu(open ? null : { level, key: column.key }), style: { border: 0, background: 'transparent', padding: 1, cursor: 'pointer', fontSize: 16, lineHeight: 1, color: value === '' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)' } }, '⌕'),
      open ? React.createElement('div', { style: { position: 'absolute', right: 0, top: '100%', zIndex: 6, minWidth: 140, padding: 4, background: 'var(--dsw-alias-bg-layer-1, #fff)', border: TABLE_BORDER, borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.12)' } }, control) : null,
    )
  }
  const headerCell = (column: CostColumnDef, current: CostTableSort, onSort: React.Dispatch<React.SetStateAction<CostTableSort>>, currentFilter: CostTableFilter, onFilter: (key: CostDisplayColumn, value: string) => void, rows: readonly CostTableRow[], level: 'parent' | 'child') => React.createElement('th', {
    key: `${level}-${column.key}`,
    scope: 'col',
    style: column.left ? TABLE_HEAD_LEFT : TABLE_HEAD,
  }, React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: column.left ? 'flex-start' : 'flex-end', gap: 4, minWidth: column.compact ? 180 : 72 } }, headerButton(column, current, onSort, level), filterControl(column, currentFilter, onFilter, rows, level)))
  const dataCells = (row: CostTableRow, columns: CostColumnDef[], first: React.ReactNode, child = false) => columns.map((column, index) => React.createElement('td', {
    key: column.key,
    style: {
      ...(column.left ? TABLE_CELL_LEFT : column.key === 'usage' ? { ...TABLE_CELL, fontWeight: 600 } : TABLE_CELL),
      ...(child ? { background: 'var(--dsw-alias-bg-layer-2, #fafafa)', color: 'var(--dsw-alias-label-secondary)' } : { fontWeight: 600 }),
      whiteSpace: column.compact ? 'pre-line' : 'nowrap',
      lineHeight: column.compact ? 1.35 : undefined,
    },
    title: column.key === 'sessionId' ? row.sessionId : formatCostCell(row, column.key, props.symbol, props.unitTokens),
  }, index === 0 ? first : formatCostCell(row, column.key, props.symbol, props.unitTokens)))
  const viewChip = (id: CostView, label: string) => React.createElement('button', {
    type: 'button',
    onClick: () => setViewMode(id),
    'aria-pressed': view === id,
    style: { ...buttonStyle, padding: '4px 10px', background: view === id ? 'var(--dsw-alias-label-primary)' : 'transparent', color: view === id ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-label-secondary)' },
  }, label)
  const columnPicker = (level: 'parent' | 'child') => {
    const keys = optionalCostTableColumns(level).filter(key => view !== 'model' || key !== 'route')
    const chosen = level === 'parent' ? selected : childSelected
    const setChosen = level === 'parent' ? setSelected : setChildSelected
    return React.createElement('div', { style: { position: 'relative' } },
      React.createElement('button', { type: 'button', style: buttonStyle, 'aria-expanded': columnMenu === level, onClick: () => setColumnMenu(open => open === level ? null : level) }, level === 'parent' ? '汇总列' : '明细列'),
      columnMenu === level ? React.createElement('div', { style: { position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 5, minWidth: 180, padding: 8, background: 'var(--dsw-alias-bg-layer-1, #fff)', border: TABLE_BORDER, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', gap: 6 } },
        ...keys.map(key => React.createElement('label', { key, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 } },
          React.createElement('input', {
            type: 'checkbox',
            checked: chosen.includes(key),
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => setChosen(current => event.target.checked ? [...current, key] : current.filter(item => item !== key)),
          }),
          columnLabel(key, view, level),
        )),
      ) : null,
    )
  }
  const hasFilter = Object.keys(filter).length > 0 || Object.keys(childFilter).length > 0
  if (props.entries.length === 0) return React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, props.empty)
  const childTable = (rows: readonly CostTableRow[]) => React.createElement('table', { style: { width: '100%', minWidth: 720, borderCollapse: 'collapse', whiteSpace: 'nowrap' } },
    React.createElement('thead', null, React.createElement('tr', null, ...childColumns.map(column => headerCell(column, childSort, setChildSort, childFilter, setChildFilterValue, childRows, 'child')))),
    React.createElement('tbody', null,
      rows.length === 0 ? React.createElement('tr', null, React.createElement('td', { style: { ...TABLE_CELL_LEFT, color: 'var(--dsw-alias-label-tertiary)' }, colSpan: childColumns.length }, '没有符合筛选的明细')) : null,
      ...rows.map(child => React.createElement('tr', { key: child.id }, ...dataCells(child, childColumns, formatCostCell(child, 'dimension', props.symbol, props.unitTokens), true))),
    ),
  )
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
      React.createElement('div', { role: 'tablist', style: { display: 'flex', gap: 6 } }, viewChip('time', '按日期'), viewChip('model', '按模型')),
      React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        hasFilter ? React.createElement('button', { type: 'button', style: buttonStyle, onClick: () => { setFilter({}); setChildFilter({}) } }, '清除筛选') : null,
        columnPicker('parent'),
        columnPicker('child'),
      ),
    ),
    React.createElement('div', { style: { overflow: 'auto', fontSize: 12, border: TABLE_BORDER, borderRadius: 8, minHeight: 0, flex: 1 } },
      React.createElement('table', { style: { width: '100%', minWidth: 960, borderCollapse: 'collapse' } },
        React.createElement('thead', null, React.createElement('tr', null, ...parentColumns.map(column => headerCell(column, sort, setSort, filter, setFilterValue, allRows, 'parent')))),
        React.createElement('tbody', null,
          groups.length === 0 ? React.createElement('tr', null, React.createElement('td', { style: { ...TABLE_CELL_LEFT, color: 'var(--dsw-alias-label-tertiary)' }, colSpan: parentColumns.length }, '没有符合筛选的明细')) : null,
          ...groups.flatMap(group => {
            const open = expanded.has(group.id)
            const summaryFirst = React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              React.createElement('button', {
                type: 'button',
                'aria-expanded': open,
                'aria-label': open ? `收起${group.summary.dimension}` : `展开${group.summary.dimension}`,
                onClick: () => toggleGroup(group.id),
                style: { width: 18, height: 18, padding: 0, border: TABLE_BORDER, borderRadius: 3, background: 'var(--dsw-alias-bg-layer-1, #fff)', cursor: 'pointer', font: 'inherit', fontSize: 12, lineHeight: '16px' },
              }, open ? '−' : '+'),
              formatCostCell(group.summary, 'dimension', props.symbol, props.unitTokens),
            )
            const childBlock = open ? React.createElement('tr', { key: `${group.id}-children` },
              React.createElement('td', { colSpan: parentColumns.length, style: { ...TABLE_CELL_LEFT, padding: 0, background: 'var(--dsw-alias-bg-layer-2, #fafafa)' } },
                React.createElement('div', { style: { padding: '8px 12px 12px 36px' } }, childTable(group.children)),
              ),
            ) : null
            return [React.createElement('tr', { key: group.id }, ...dataCells(group.summary, parentColumns, summaryFirst, false)), ...(childBlock === null ? [] : [childBlock])]
          }),
          groups.length > 0 ? React.createElement('tr', { style: { fontWeight: 600 } },
            ...parentColumns.map((column, index) => React.createElement('td', {
              key: column.key,
              style: index === 0 ? { ...TABLE_CELL_LEFT, fontWeight: 600 } : column.key === 'usage' ? { ...TABLE_CELL, fontWeight: 600 } : TABLE_CELL,
            }, index === 0 ? `合计 ${groups.length} 组 / ${detailCount} 条` : formatCostCell({ ...rowZero, ...totals }, column.key, props.symbol, props.unitTokens))),
          ) : null,
        ),
      ),
    ),
  )
}

const rowZero: CostTableRow = {
  id: '', dimension: '', date: '', hour: '', hourLabel: '', sessionId: '', origin: '', route: '', periodName: '', surcharge: '',
  turns: 0, steps: 0, toolCalls: 0, inputTokens: 0, inputCost: 0, cacheTokens: 0, cacheCost: 0, outputTokens: 0, outputCost: 0, cacheRate: 0, cost: 0,
  inputRate: null, cacheReadRate: null, cacheWriteRate: null, outputRate: null,
}

const DOCK_TEXT: React.CSSProperties = {
  margin: 0, padding: '2px 16px 0', textAlign: 'center',
  color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '20px',
}

const DOCK_ACTION: React.CSSProperties = {
  display: 'inline', padding: 0, border: 'none', background: 'none',
  color: 'inherit', font: 'inherit', lineHeight: 'inherit', cursor: 'pointer',
  textDecoration: 'none',
}

const BALANCE_CARD: React.CSSProperties = {
  display: 'inline-flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start',
  gap: 0, minHeight: 32, padding: '2px 10px', flex: 'none',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, background: 'transparent',
  color: 'var(--dsw-alias-label-primary)', font: 'inherit', textDecoration: 'none', cursor: 'pointer',
  lineHeight: 1.2, whiteSpace: 'nowrap',
}

function CostModal(props: { title: string; onClose(): void; children: React.ReactNode }) {
  return React.createElement('div', {
    style: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
    onClick: props.onClose,
  },
    React.createElement('div', {
      style: { background: 'var(--dsw-alias-bg-layer-1, #fff)', borderRadius: 12, padding: 24, width: 'min(1680px, 98vw)', maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 16 },
      onClick: (event: React.MouseEvent) => event.stopPropagation(),
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 } },
        React.createElement('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, props.title),
        React.createElement('button', { type: 'button', style: { background: 'none', border: 'none', color: 'inherit', fontSize: 20, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }, onClick: props.onClose, 'aria-label': '关闭' }, '✕'),
      ),
      React.createElement('div', { style: { minHeight: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }, props.children),
    ),
  )
}

function BalanceHeader(props: { costMeter: CostMeterFace; interval(callback: () => void, delay: number): () => void }) {
  const [balances, setBalances] = React.useState<ProviderBalance[]>([])
  React.useEffect(() => {
    let loading = false
    const load = () => {
      if (loading) return
      loading = true
      props.costMeter.providerBalances().then(response => {
        if (response.ok && Array.isArray(response.value)) setBalances(response.value)
      }).catch(() => {}).finally(() => { loading = false })
    }
    load()
    return props.interval(load, 5000)
  }, [])
  const cards = []
  for (const item of collapseBalanceChips(balances)) {
    const href = walletHref(item.origin)
    if (href === undefined) continue
    cards.push(React.createElement('a', {
      key: href,
      href,
      target: '_blank',
      rel: 'noreferrer',
      style: BALANCE_CARD,
      title: href,
    },
      React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' } }, item.name),
      React.createElement('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 6 } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, `${currencySymbol(item.unit)}${money(item.remaining ?? 0)}`),
        React.createElement('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' } },
          new Date(item.observedAt).toLocaleTimeString('zh-CN', { hour12: false }),
        ),
      ),
    ))
  }
  if (cards.length === 0) return null
  return React.createElement('div', {
    style: { display: 'flex', alignItems: 'stretch', gap: 8, minWidth: 0, overflowX: 'auto', flexWrap: 'nowrap' },
  }, ...cards)
}

function CostDock(props: { sessionId: string; costMeter: CostMeterFace; sessions: ApiFace['sessions']; interval(callback: () => void, delay: number): () => void }) {
  const [state, setState] = React.useState<CostFold | null>(null)
  const [sessionRows, setSessionRows] = React.useState<SessionCostRecord[]>([])
  const [sessionLoadError, setSessionLoadError] = React.useState<string | null>(null)
  const [sessionLoading, setSessionLoading] = React.useState(false)
  const [modal, setModal] = React.useState<'session' | 'today' | 'history' | null>(null)
  React.useEffect(() => {
    let loading = false
    const load = () => {
      if (typeof props.sessionId !== 'string' || loading) return
      loading = true
      props.costMeter.sessionCost(props.sessionId).then(response => {
        if (response.ok && response.value && typeof response.value === 'object') setState(response.value)
      }).catch(() => {}).finally(() => { loading = false })
    }
    load()
    return props.interval(load, 5000)
  }, [props.sessionId])
  React.useEffect(() => {
    let loading = false
    const load = () => {
      if (loading) return
      loading = true
      setSessionLoading(true)
      loadAllSessionCosts(props.costMeter, props.sessions).then(rows => {
        setSessionRows(rows)
        setSessionLoadError(null)
      }).catch((error: unknown) => {
        setSessionLoadError(`会话费用加载失败：${remoteErrorText(error)}`)
      }).finally(() => {
        loading = false
        setSessionLoading(false)
      })
    }
    load()
    return props.interval(load, 30_000)
  }, [])
  const symbol = currencySymbol(state?.currency ?? sessionRows[0]?.cost.currency ?? 'CNY')
  const unitTokens = state?.unitTokens ?? sessionRows[0]?.cost.unitTokens ?? 1_000_000
  const today = localTodayDate()
  const todayCost = overviewCost(sessionRows, today)
  const historyCost = overviewCost(sessionRows)
  const allEntries = flattenHourlyEntries(sessionRows)
  const todayEntries = allEntries.filter(item => localDateOfHour(item.entry.hour) === today)
  const costText = (label: string, value: number, view: 'session' | 'today' | 'history') => React.createElement('button', {
    type: 'button',
    style: DOCK_ACTION,
    onClick: () => setModal(view),
    title: label,
  }, `${label} ${symbol}${money(value)}`)
  const loading = sessionLoading && sessionRows.length === 0 ? React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '正在加载…') : null
  const error = sessionLoadError ? React.createElement('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error)' } }, sessionLoadError) : null
  const parts = [
    costText('本会话', state?.cost ?? 0, 'session'),
    costText('今日', todayCost, 'today'),
    costText('累计', historyCost, 'history'),
  ]
  return React.createElement(React.Fragment, null,
    React.createElement('p', { style: DOCK_TEXT },
      ...parts.flatMap((part, index) => index === 0 ? [part] : [' · ', part]),
    ),
    modal === 'session' ? React.createElement(CostModal, { title: '本会话费用', onClose: () => setModal(null), children: React.createElement(CostTable, { entries: flattenFoldEntries(props.sessionId, state), symbol, unitTokens, empty: '本会话还没有可统计的用量。' }) }) : null,
    modal === 'today' ? React.createElement(CostModal, { title: `今日费用 · ${today}`, onClose: () => setModal(null), children: React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 } }, loading, error, React.createElement(CostTable, { entries: todayEntries, symbol, unitTokens, empty: '今天还没有费用。' })) }) : null,
    modal === 'history' ? React.createElement(CostModal, { title: '累计费用', onClose: () => setModal(null), children: React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 } }, loading, error, React.createElement(CostTable, { entries: allEntries, symbol, unitTokens, empty: '还没有历史费用。' })) }) : null,
  )
}


export async function apply(ctx: Context) {
  const remote = ctx.get('remote') as RemoteMount | undefined
  if (!remote) return
  await remote.$mount({
    package: 'dsh-cost-meter',
    descriptors: [{
      id: 'dsh-cost-meter#costMeter/sessionCost', service: 'costMeter', namespace: 'costMeter', method: 'sessionCost', invocation: { kind: 'direct' },
      parameters: [{ name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#sessionCost#sessionId', schema: { _zod: true, parse: (value: unknown) => value } } }],
      result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#sessionCost#result', schema: { _zod: true, parse: (value: unknown) => value } },
    }, {
      id: 'dsh-cost-meter#costMeter/sessionCosts',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'sessionCosts',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-cost-meter#sessionCosts#result',
        schema: {
          _zod: true,
          parse: (value: unknown) => value,
        },
      },
    }, {
      id: 'dsh-cost-meter#costMeter/providerBalances',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'providerBalances',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-cost-meter#providerBalances#result',
        schema: {
          _zod: true,
          parse: (value: unknown) => value,
        },
      },
    }],
  })
  const slots = ctx.get('slots') as SlotsFace | undefined
  const costMeter = ctx.get('remote.costMeter') as CostMeterFace | undefined
  if (!slots || !costMeter) return
  const pricing = new PricingRouteSource()
  void pricing.load()
  const sessionRemote = ctx.get('remote.session') as SessionRemoteFace | undefined
  const catalog = new CatalogSource(sessionRemote)
  void catalog.load()
  const remoteEvents = ctx.get('remote') as { $on?(event: string, listener: (...args: any[]) => void): () => void }
  ctx.effect(() => remoteEvents.$on?.('llm/adapters-updated', () => { void catalog.load() }) ?? (() => {}), 'cost-meter catalog updates')

  slots.inject('conversation.session.header.utilities', () => slots.register(
    { name: 'conversation.session.header.utilities', id: 'cost-meter-balance', order: 40 },
    () => React.createElement(BalanceHeader, { costMeter, interval: browserInterval }),
  ))
  slots.inject('conversation.composer.dock', () => slots.register(
    { name: 'conversation.composer.dock', id: 'cost-meter', order: 40 },
    (props: { sessionId: string }) => React.createElement(CostDock, { ...props, costMeter, sessions: undefined, interval: browserInterval }),
  ))
  slots.inject('settings.section', () => slots.register({
    name: 'settings.section',
    id: 'cost-meter',
    order: 25,
    label: 'API 费用',
    inject: () => ({
      hooks: { pricing, catalog },
      refreshCatalog: catalog.load,
      refreshPricing: pricing.load,
      interval: browserInterval,
      save: (config: PricingConfig) => pricing.save(config),
    }),
  }, PricingSettingsCard))
}
