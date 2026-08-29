/** Browser cost display and model-aware pricing settings card. */

import type { Context } from '@deepseek-ai/cordis'
import React from 'react'
import type { ContextSurcharge, ModelAssignment, PricingConfig, PricingGroup, PricingPeriod } from './pricing.js'
import { DEFAULT_GROUP, DEFAULT_PRICING, formatContextSurcharge, normalizePricing, validatePricing } from './pricing.js'
import {
  localDateOfHour,
  mapWithConcurrency,
  mergeListedSessionCost,
  queryHourlyOverview,
  sessionRoutes,
  sharedContextSurcharge,
  sumHourlySlices,
  type HourlyOverviewFilter,
  type HourlySlice,
} from './session-table.js'

export const inject = ['slots', 'remote', 'timer', 'connection']

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
}

interface SessionCostRecord {
  sessionId: string
  parentSession: string | null
  origin: string | null
  cost: CostFold
}
interface RemoteEnvelope<T> { ok: boolean; value?: T; error?: unknown }
interface RemoteMount { $mount(contribution: unknown): Promise<() => Promise<void>> }
interface CostMeterFace {
  sessionCost(sessionId: string): Promise<RemoteEnvelope<CostFold | null>>
  sessionCosts(): Promise<RemoteEnvelope<SessionCostRecord[]>>
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
interface ApiFace {
  llm: { models(input: {}): Promise<{ result: { ok: boolean; value?: { groups: ModelGroup[] } } }> }
  sessions: { list(input: {}): Promise<{ result: { ok: boolean; value?: { items: SessionListItem[] }; error?: unknown } }> }
}
interface ConnectionFace { api: ApiFace }

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
        this.snapshot = body.ok && body.value
          ? { status: 'ready', value: body.value, revision: 0, writable: true }
          : { status: 'unavailable', writable: false }
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
  constructor(private readonly api: ApiFace) {}
  getSnapshot = (): CatalogSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  async load(): Promise<void> {
    try {
      const response = await this.api.llm.models({})
      this.snapshot = response.result.ok && response.result.value
        ? { status: 'ready', groups: response.result.value.groups }
        : { status: 'error', groups: [] }
    } catch {
      this.snapshot = { status: 'error', groups: [] }
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
const surchargeLabel = (afterTokens: number | null | undefined, multiplier: number | null | undefined): string => formatContextSurcharge(afterTokens, multiplier) ?? '-'
const surchargeOf = (rows: ReadonlyArray<{ contextAfterTokens?: number | null; contextMultiplier?: number | null }>): string => {
  const shared = sharedContextSurcharge(rows)
  return shared === null ? '-' : surchargeLabel(shared.afterTokens, shared.multiplier)
}
function sourceLabelOf(source: string | null | undefined): string {
  return source === 'group-period' ? '分组时段价' : '分组基准价'
}

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

function PeriodEditor(props: { period: PricingPeriod; onChange(period: PricingPeriod): void; onRemove(): void }) {
  const set = <K extends keyof PricingPeriod>(key: K, value: PricingPeriod[K]) => props.onChange({ ...props.period, [key]: value })
  return React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 100px 100px 96px auto', gap: 8, alignItems: 'end' } },
    field('时段名称', React.createElement('input', { style: inputStyle, value: props.period.name, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('name', event.target.value) })),
    field('开始', React.createElement('input', { style: inputStyle, type: 'time', value: props.period.start, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('start', event.target.value) })),
    field('结束', React.createElement('input', { style: inputStyle, type: 'time', value: props.period.end, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('end', event.target.value) })),
    field('倍率', React.createElement(NumberInput, { value: props.period.multiplier, placeholder: '1', onChange: value => set('multiplier', value ?? 1) })),
    React.createElement('button', { type: 'button', style: buttonStyle, onClick: props.onRemove }, '删除'),
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
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '超过 Token 数', React.createElement(NumberInput, {
        value: tier.afterTokens,
        onChange: value => set(index, { ...tier, afterTokens: value ?? 0 }),
      })),
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '整单倍率', React.createElement(NumberInput, {
        value: tier.multiplier,
        onChange: value => set(index, { ...tier, multiplier: value ?? 0 }),
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
        field('缓存输入倍率', React.createElement(NumberInput, { value: props.group.cacheReadMultiplier, onChange: value => set('cacheReadMultiplier', value ?? 0) })),
        field('缓存写入倍率', React.createElement(NumberInput, { value: props.group.cacheWriteMultiplier, onChange: value => set('cacheWriteMultiplier', value ?? 0) })),
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
  save(config: PricingConfig): Promise<string | null>
}) {
  const settings = props.usePricing(snapshot => snapshot)
  const catalog = props.useCatalog(snapshot => snapshot)
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<PricingConfig>(() => cloneConfig(settings.value))
  const [seedRevision, setSeedRevision] = React.useState(settings.revision)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (settings.revision !== seedRevision) {
      setDraft(cloneConfig(settings.value))
      setSeedRevision(settings.revision)
      setFailure(null)
    }
  }, [settings.revision, settings.value, seedRevision])
  React.useEffect(() => {
    if (open) void props.refreshCatalog()
  }, [open, props.refreshCatalog])
  if (settings.status === 'unavailable') return null
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
  const save = async () => {
    if (invalid || !dirty) return
    setSaving(true)
    setFailure(null)
    const error = await props.save(draft)
    setSaving(false)
    if (error === null) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setFailure(error)
    }
  }
  return React.createElement('li', { style: { listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)' } },
    React.createElement('button', { type: 'button', onClick: () => setOpen(!open), 'aria-expanded': open, style: { width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' } },
      React.createElement('span', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 } },
        React.createElement('strong', { style: { fontSize: 15, fontWeight: 600 } }, 'API 费用统计'),
        React.createElement('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, '按基准费用分组统一管理多个模型：最终单价 = 分组基准（含缓存/时段/上下文倍率）× 优惠倍率 × 模型倍率。'),
      ),
      dirty ? React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '未保存') : null,
      React.createElement('span', { 'aria-hidden': true, style: { transform: open ? 'rotate(180deg)' : undefined } }, '⌄'),
    ),
    open ? React.createElement('div', { style: { margin: '0 16px', padding: '14px 0 10px', borderTop: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', gap: 16 } },
      React.createElement('section', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '全局'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '120px 160px 1fr', gap: 8 } },
          field('币种', React.createElement('input', { style: inputStyle, value: draft.currency, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, currency: event.target.value.toUpperCase() }) })),
          field('每多少 Token', React.createElement(NumberInput, { value: draft.unitTokens, onChange: value => setDraft({ ...draft, unitTokens: value ?? 0 }) })),
          field('计价时区', React.createElement('input', { style: inputStyle, value: draft.timezone, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, timezone: event.target.value }) })),
        ),
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
    ) : null,
  )
}

const EMPTY_HOURLY_FILTER: HourlyOverviewFilter = { date: '', hour: '', sessionId: '', origin: '', route: '' }

function HourlyTable(props: {
  sessionId: string
  hourly: readonly HourlyDetail[]
  subagents?: readonly CostSubagent[]
  expandedHours: ReadonlySet<string>
  toggleHour(id: string): void
  symbol: string
  cellBase: React.CSSProperties
  cellLeft: React.CSSProperties
  headerStyle: React.CSSProperties
  headerLeft: React.CSSProperties
}) {
  const routeOf = (row: HourlyDetail): string => `${row.provider ?? ''}/${row.model ?? ''}`
  const surchargeKeyOf = (row: HourlyDetail): string => `${row.contextMultiplier ?? 1}|${row.contextAfterTokens ?? ''}`
  const flatten = (rows: readonly CostSubagent[]): Array<{ sessionId: string; entry: HourlyDetail }> => rows.flatMap(row => [
    ...(row.hourly ?? []).map(entry => ({ sessionId: row.sessionId, entry })),
    ...flatten(row.children),
  ])
  const childRows = flatten(props.subagents ?? [])
  const sumRows = (rows: readonly HourlyDetail[]): HourlyDetail | null => {
    const first = rows[0]
    if (first === undefined) return null
    const sum = (field: keyof HourlyDetail): number => rows.reduce((total, row) => total + (row[field] as number), 0)
    const inputTokens = sum('inputTokens')
    const cacheReadTokens = sum('cacheReadTokens')
    const cacheWriteTokens = sum('cacheWriteTokens')
    const outputTokens = sum('outputTokens')
    return {
      ...first,
      turns: sum('turns'),
      steps: sum('steps'),
      toolCalls: sum('toolCalls'),
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens,
      inputCost: sum('inputCost'),
      cacheReadCost: sum('cacheReadCost'),
      cacheWriteCost: sum('cacheWriteCost'),
      outputCost: sum('outputCost'),
      cost: sum('cost'),
      cacheRate: (cacheReadTokens + cacheWriteTokens) / Math.max(1, inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens),
      provider: null,
      model: null,
      pricingSource: null,
      periodName: null,
    }
  }
  const dataCells = (row: HourlyDetail): React.ReactNode[] => [
    React.createElement('td', { style: props.cellBase }, String(row.turns)),
    React.createElement('td', { style: props.cellBase }, String(row.steps)),
    React.createElement('td', { style: props.cellBase }, String(row.toolCalls)),
    React.createElement('td', { style: props.cellBase }, row.inputTokens.toLocaleString('zh-CN')),
    React.createElement('td', { style: props.cellBase }, `${props.symbol}${money(row.inputCost)}`),
    React.createElement('td', { style: props.cellBase }, (row.cacheReadTokens + row.cacheWriteTokens).toLocaleString('zh-CN')),
    React.createElement('td', { style: props.cellBase }, `${props.symbol}${money(row.cacheReadCost + row.cacheWriteCost)}`),
    React.createElement('td', { style: props.cellBase }, row.outputTokens.toLocaleString('zh-CN')),
    React.createElement('td', { style: props.cellBase }, `${props.symbol}${money(row.outputCost)}`),
    React.createElement('td', { style: props.cellBase }, `${(row.cacheRate * 100).toFixed(1)}%`),
    React.createElement('td', { style: { ...props.cellBase, fontWeight: 600 } }, `${props.symbol}${money(row.cost)}`),
  ]
  const hours = [...new Set([...props.hourly.map(row => row.hour), ...childRows.map(row => row.entry.hour)])].sort()
  const totals = sumRows([...props.hourly, ...childRows.map(row => row.entry)])
  return React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap', marginTop: 8 } },
    React.createElement('thead', null,
      React.createElement('tr', null,
        React.createElement('th', { style: props.headerLeft }, '时间段'),
        React.createElement('th', { style: props.headerStyle }, '轮次'),
        React.createElement('th', { style: props.headerStyle }, '步骤'),
        React.createElement('th', { style: props.headerStyle }, '工具调用'),
        React.createElement('th', { style: props.headerStyle }, '输入 tokens'),
        React.createElement('th', { style: props.headerStyle }, '输入价格'),
        React.createElement('th', { style: props.headerStyle }, '缓存 tokens'),
        React.createElement('th', { style: props.headerStyle }, '缓存价格'),
        React.createElement('th', { style: props.headerStyle }, '输出 tokens'),
        React.createElement('th', { style: props.headerStyle }, '输出价格'),
        React.createElement('th', { style: props.headerStyle }, '缓存率'),
        React.createElement('th', { style: props.headerStyle }, '总价'),
        React.createElement('th', { style: props.headerStyle }, '上下文翻倍'),
        React.createElement('th', { style: props.headerStyle }, '时段名称'),
        React.createElement('th', { style: props.headerStyle }, '模型'),
      ),
    ),
    React.createElement('tbody', null,
      ...hours.flatMap(hour => {
        const rootRows = props.hourly.filter(row => row.hour === hour)
        const hourChildren = childRows.filter(row => row.entry.hour === hour)
        const hourRows = [...rootRows, ...hourChildren.map(row => row.entry)]
        const total = sumRows(hourRows)
        if (total === null) return []
        const timeKey = `${props.sessionId}:time:${hour}`
        const timeExpanded = props.expandedHours.has(timeKey)
        const routes = [...new Set(hourRows.map(routeOf))]
        const timeRow = React.createElement('tr', { key: timeKey, style: { borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)', fontWeight: 600 } },
          React.createElement('td', { style: props.cellLeft }, React.createElement('button', { type: 'button', 'aria-expanded': timeExpanded, onClick: () => props.toggleHour(timeKey), style: { border: 0, background: 'transparent', cursor: 'pointer', padding: '0 6px 0 0', fontSize: 13, color: 'inherit' } }, timeExpanded ? '−' : '+'), total.hourLabel),
          ...dataCells(total),
          React.createElement('td', { style: props.cellBase }, surchargeOf(hourRows)),
          React.createElement('td', { style: props.cellBase }, '-'),
          React.createElement('td', { style: props.cellBase }, `${routes.length} 个模型`),
        )
        if (!timeExpanded) return [timeRow]
        return [timeRow, ...routes.flatMap(route => {
          const entries = hourRows.filter(row => routeOf(row) === route)
          const children = hourChildren.filter(row => routeOf(row.entry) === route)
          const surchargeKeys = [...new Set(entries.map(surchargeKeyOf))].sort()
          return surchargeKeys.flatMap(surchargeKey => {
            const charged = entries.filter(row => surchargeKeyOf(row) === surchargeKey)
            const modelTotal = sumRows(charged)
            if (modelTotal === null) return []
            const sample = charged[0]
            const modelKey = `${props.sessionId}:model:${hour}:${route}:${surchargeKey}`
            const modelExpanded = props.expandedHours.has(modelKey)
            const chargedChildren = children.filter(row => surchargeKeyOf(row.entry) === surchargeKey)
            const modelRow = React.createElement('tr', { key: modelKey, style: { borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)', background: 'var(--dsw-alias-bg-layer-2, #fafafa)' } },
              React.createElement('td', { style: { ...props.cellLeft, paddingLeft: 28 } }, chargedChildren.length > 0 ? React.createElement('button', { type: 'button', 'aria-expanded': modelExpanded, onClick: () => props.toggleHour(modelKey), style: { border: 0, background: 'transparent', cursor: 'pointer', padding: '0 6px 0 0', fontSize: 13, color: 'inherit' } }, modelExpanded ? '−' : '+') : React.createElement('span', { style: { display: 'inline-block', width: 19 } }), `↳ ${route}`),
              ...dataCells(modelTotal),
              React.createElement('td', { style: props.cellBase }, surchargeOf(charged)),
              React.createElement('td', { style: props.cellBase }, sample?.periodName ?? '-'),
              React.createElement('td', { style: props.cellBase }, route),
            )
            if (!modelExpanded) return [modelRow]
            return [modelRow, ...chargedChildren.map(({ sessionId, entry }) => React.createElement('tr', { key: `${props.sessionId}:child:${hour}:${route}:${surchargeKey}:${sessionId}`, style: { borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)', color: 'var(--dsw-alias-label-secondary)' } },
              React.createElement('td', { style: { ...props.cellLeft, paddingLeft: 52 } }, `↳ 子代理 ${sessionId.slice(0, 8)}`),
              ...dataCells(entry),
              React.createElement('td', { style: props.cellBase }, surchargeLabel(entry.contextAfterTokens, entry.contextMultiplier)),
              React.createElement('td', { style: props.cellBase }, entry.periodName ?? '-'),
              React.createElement('td', { style: props.cellBase }, `${entry.provider ?? '?'}/${entry.model ?? '?'}`),
            ))]
          })
        })]
      }),
      totals ? React.createElement('tr', { style: { fontWeight: 600, borderTop: '2px solid var(--dsw-alias-border-l1, #bbb)' } },
        React.createElement('td', { style: { ...props.cellLeft, fontWeight: 600 } }, '合计'),
        ...dataCells(totals),
        React.createElement('td', { style: props.cellBase }),
        React.createElement('td', { style: props.cellBase }),
        React.createElement('td', { style: props.cellBase }),
      ) : React.createElement('tr', null,
        React.createElement('td', { style: { ...props.cellLeft, color: 'var(--dsw-alias-label-tertiary)' }, colSpan: 15 }, '该会话暂无按时段明细'),
      ),
    ),
  )
}

function CostDock(props: { sessionId: string; costMeter: CostMeterFace; sessions: ApiFace['sessions']; interval(callback: () => void, delay: number): () => void }) {
  const [state, setState] = React.useState<CostFold | null>(null)
  const [tooltip, setTooltip] = React.useState(false)
  const [showModal, setShowModal] = React.useState(false)
  const [sessionRows, setSessionRows] = React.useState<SessionCostRecord[]>([])
  const [sessionLoadError, setSessionLoadError] = React.useState<string | null>(null)
  const [sessionLoading, setSessionLoading] = React.useState(false)
  const [expandedHours, setExpandedHours] = React.useState<Set<string>>(() => new Set())
  const [showAllSessions, setShowAllSessions] = React.useState(false)
  const [hourlyFilter, setHourlyFilter] = React.useState<HourlyOverviewFilter>(EMPTY_HOURLY_FILTER)
  const tooltipTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    const load = () => {
      if (typeof props.sessionId !== 'string') return
      props.costMeter.sessionCost(props.sessionId).then(response => {
        if (response.ok && response.value && typeof response.value === 'object') setState(response.value)
      }).catch(() => {})
    }
    load()
    return props.interval(load, 2000)
  }, [props.sessionId])
  React.useEffect(() => () => { if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current) }, [])
  const loadSessionCosts = (reuse: boolean) => {
    if (!reuse) {
      setSessionLoading(true)
      setSessionLoadError(null)
    }
    loadAllSessionCosts(props.costMeter, props.sessions).then(rows => {
      setSessionRows(rows)
      setSessionLoadError(null)
    }).catch((error: unknown) => {
      if (!reuse || sessionRows.length === 0) setSessionLoadError(`会话费用加载失败：${remoteErrorText(error)}`)
    }).finally(() => {
      setSessionLoading(false)
    })
  }
  const openModal = () => {
    setShowModal(true)
    setShowAllSessions(false)
    setSessionLoadError(null)
    setTooltip(false)
  }
  const openAllSessions = () => {
    setShowAllSessions(true)
    loadSessionCosts(sessionRows.length > 0)
  }
  if (!state || !(state.cost > 0)) return null
  const symbol = currencySymbol(state.currency)
  const parts = [`API费用 ≈${symbol}${money(state.cost)}`, `输入 ${symbol}${money(state.inputCost)}`, `缓存读 ${symbol}${money(state.cacheReadCost)}`, `缓存写 ${symbol}${money(state.cacheWriteCost)}`, `输出 ${symbol}${money(state.outputCost)}`]
  const showTooltip = () => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    tooltipTimerRef.current = setTimeout(() => setTooltip(true), 300)
  }
  const hideTooltip = () => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    tooltipTimerRef.current = setTimeout(() => setTooltip(false), 200)
  }
  const route = state.route ?? '未知模型'
  const pricingInfo = `${state.groupName ?? '默认分组'}${state.pricingPeriod ? ` · ${state.pricingPeriod}` : ''} · ${sourceLabelOf(state.pricingSource)}`
  const cellBase = { fontSize: 12, padding: '4px 8px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
  const cellLeft = { ...cellBase, textAlign: 'left' as const }
  const headerStyle = { ...cellBase, fontWeight: 600, background: 'var(--dsw-alias-bg-layer-3, #f5f5f5)', borderBottom: '1px solid var(--dsw-alias-border-l2, #ddd)', position: 'sticky' as const, top: 0, zIndex: 1 }
  const headerLeft = { ...headerStyle, textAlign: 'left' as const }
  const toggleExpanded = (store: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => store(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleHour = (id: string) => toggleExpanded(setExpandedHours, id)
  const compactId = (value: string | null): string => value ? (value.length > 12 ? `${value.slice(0, 8)}…` : value) : '-'
  const hourGroups = queryHourlyOverview(sessionRows, hourlyFilter)
  const dateOptions = [...new Set(sessionRows.flatMap(row => (row.cost.hourly ?? []).map(entry => entry.hour ? localDateOfHour(entry.hour) : '')).filter(Boolean))].sort()
  const hourOptions = [...new Set((hourlyFilter.date === ''
    ? sessionRows.flatMap(row => row.cost.hourly ?? [])
    : sessionRows.flatMap(row => row.cost.hourly ?? []).filter(entry => entry.hour !== undefined && localDateOfHour(entry.hour) === hourlyFilter.date)
  ).map(entry => entry.hourLabel ?? entry.hour).filter((value): value is string => Boolean(value)))].sort()
  const originOptions = [...new Set(sessionRows.map(row => row.origin).filter((value): value is string => Boolean(value)))].sort()
  const routeOptions = [...new Set(sessionRows.flatMap(row => sessionRoutes(row)))].sort()
  const overviewTotals = sumHourlySlices(hourGroups.flatMap(group => group.sessions.map(item => item.entry)))
  const hourlyDataCells = (row: HourlySlice): React.ReactNode[] => [
    React.createElement('td', { style: cellBase }, String(row.turns)),
    React.createElement('td', { style: cellBase }, String(row.steps)),
    React.createElement('td', { style: cellBase }, String(row.toolCalls)),
    React.createElement('td', { style: cellBase }, row.inputTokens.toLocaleString('zh-CN')),
    React.createElement('td', { style: cellBase }, `${symbol}${money(row.inputCost)}`),
    React.createElement('td', { style: cellBase }, (row.cacheReadTokens + row.cacheWriteTokens).toLocaleString('zh-CN')),
    React.createElement('td', { style: cellBase }, `${symbol}${money(row.cacheReadCost + row.cacheWriteCost)}`),
    React.createElement('td', { style: cellBase }, row.outputTokens.toLocaleString('zh-CN')),
    React.createElement('td', { style: cellBase }, `${symbol}${money(row.outputCost)}`),
    React.createElement('td', { style: cellBase }, `${(row.cacheRate * 100).toFixed(1)}%`),
    React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, `${symbol}${money(row.cost)}`),
  ]
  const filterInput = (value: string, placeholder: string, onChange: (next: string) => void) => React.createElement('input', {
    style: { ...inputStyle, height: 28, fontSize: 11 },
    value,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
  })
  const filterSelect = (value: string, options: readonly string[], onChange: (next: string) => void) => React.createElement('select', {
    style: { ...inputStyle, height: 28, fontSize: 11 },
    value,
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
  }, React.createElement('option', { value: '' }, '全部'), ...options.map(option => React.createElement('option', { key: option, value: option }, option)))
  return React.createElement(React.Fragment, null,
    React.createElement('div', {
      style: { position: 'relative', overflow: 'visible', padding: '2px calc(var(--dsh-composer-side-clearance) + 16px) 0', cursor: 'pointer' },
      onMouseEnter: showTooltip,
      onMouseLeave: hideTooltip,
      onClick: openModal,
    },
      React.createElement('div', {
        style: { textAlign: 'center', boxSizing: 'border-box', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', fontSize: 12, lineHeight: '20px' },
      },
        ...parts.map((part, index) => React.createElement(React.Fragment, { key: part }, index ? React.createElement('span', { style: { margin: '0 10px', color: 'var(--dsw-alias-separator-primary)' } }, '|') : null, part)),
      ),
      tooltip ? React.createElement('div', { style: { position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--dsw-alias-bg-layer-2, #1a1a2e)', border: '1px solid var(--dsw-alias-border-l2, #333)', borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: '1.6', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none' } },
        React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, 'API 费用明细'),
        ...(state.details && state.details.length > 0 ? state.details.flatMap((detail, di) => {
          const rateSymbol = (rate: number) => `${symbol}${rate}`
          const ds = detail
          const extras = [
            ds.groupName,
            sourceLabelOf(ds.source),
            ds.periodName,
            ds.discountMultiplier !== undefined && ds.discountMultiplier !== 1 ? `优惠 ×${ds.discountMultiplier}` : null,
            ds.modelMultiplier !== undefined && ds.modelMultiplier !== 1 ? `模型 ×${ds.modelMultiplier}` : null,
            formatContextSurcharge(ds.contextAfterTokens, ds.contextMultiplier),
          ].filter((value): value is string => Boolean(value))
          return [
            di > 0 ? React.createElement('div', { key: `sep-${di}`, style: { borderTop: '1px solid var(--dsw-alias-border-l2, #333)', margin: '2px 0' } }) : null,
            React.createElement('div', { key: `hdr-${di}`, style: { fontWeight: 600, fontSize: 12, marginTop: di > 0 ? 2 : 0 } },
              `${ds.provider ?? '?'}/${ds.model ?? '?'}${extras.length > 0 ? ` · ${extras.join(' · ')}` : ''}`,
            ),
            React.createElement('div', { key: `rates-${di}`, style: { display: 'grid', gridTemplateColumns: 'auto auto auto auto', gap: '0 14px', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
              React.createElement('span', {}, `输入 ${rateSymbol(ds.rates.input)}/M`),
              React.createElement('span', {}, `缓存读 ${rateSymbol(ds.rates.cacheRead)}/M`),
              React.createElement('span', {}, `缓存写 ${rateSymbol(ds.rates.cacheWrite)}/M`),
              React.createElement('span', {}, `输出 ${rateSymbol(ds.rates.output)}/M`),
            ),
            React.createElement('div', { key: `grid-${di}`, style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '1px 16px' } },
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, '输入'),
              React.createElement('span', { style: { textAlign: 'right', fontWeight: 500 } }, `${symbol}${money(ds.inputCost)}`),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `${ds.inputTokens.toLocaleString('zh-CN')} tokens`),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, '缓存读'),
              React.createElement('span', { style: { textAlign: 'right', fontWeight: 500 } }, `${symbol}${money(ds.cacheReadCost)}`),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `${ds.cacheReadTokens.toLocaleString('zh-CN')} tokens`),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, '缓存写'),
              React.createElement('span', { style: { textAlign: 'right', fontWeight: 500 } }, `${symbol}${money(ds.cacheWriteCost)}`),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `${ds.cacheWriteTokens.toLocaleString('zh-CN')} tokens`),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, '输出'),
              React.createElement('span', { style: { textAlign: 'right', fontWeight: 500 } }, `${symbol}${money(ds.outputCost)}`),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `${ds.outputTokens.toLocaleString('zh-CN')} tokens`),
              React.createElement('span', { style: { fontWeight: 600 } }, '小计'),
              React.createElement('span', { style: { textAlign: 'right', fontWeight: 600 } }, `${symbol}${money(ds.cost)}`),
              React.createElement('span', {}),
            ),
          ]
        }) : [
          React.createElement('div', { key: 'ctx', style: { fontWeight: 500, fontSize: 12, marginBottom: 2 } },
            `${route} · ${pricingInfo}`,
          ),
          React.createElement('div', { key: 'flat', style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '1px 16px' } },
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, '输入'),
            React.createElement('span', { style: { textAlign: 'right', fontWeight: 500 } }, `${symbol}${money(state.inputCost)}`),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `${state.inputTokens.toLocaleString('zh-CN')} tokens`),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, '缓存读'),
            React.createElement('span', { style: { textAlign: 'right', fontWeight: 500 } }, `${symbol}${money(state.cacheReadCost)}`),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `${state.cacheReadTokens.toLocaleString('zh-CN')} tokens`),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, '缓存写'),
            React.createElement('span', { style: { textAlign: 'right', fontWeight: 500 } }, `${symbol}${money(state.cacheWriteCost)}`),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `${state.cacheWriteTokens.toLocaleString('zh-CN')} tokens`),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, '输出'),
            React.createElement('span', { style: { textAlign: 'right', fontWeight: 500 } }, `${symbol}${money(state.outputCost)}`),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `${state.outputTokens.toLocaleString('zh-CN')} tokens`),
          ),
        ]),
        React.createElement('div', { key: 'total', style: { borderTop: '1px solid var(--dsw-alias-border-l2, #333)', paddingTop: 4, marginTop: 4, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1px 16px' } },
          React.createElement('span', { style: { fontWeight: 600 } }, '合计'),
          React.createElement('span', { style: { textAlign: 'right', fontWeight: 600 } }, `${symbol}${money(state.cost)}`),
        ),
      ) : null,
    ),
    showModal && state ? React.createElement('div', {
      style: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
      onClick: () => setShowModal(false),
    },
      React.createElement('div', {
        style: { background: 'var(--dsw-alias-bg-layer-1, #fff)', borderRadius: 12, padding: 24, maxWidth: '94vw', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 16 },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 } },
          React.createElement('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, 'API 费用统计明细'),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            showAllSessions
              ? React.createElement('button', { type: 'button', style: buttonStyle, onClick: () => setShowAllSessions(false) }, '返回本会话')
              : React.createElement('button', { type: 'button', style: buttonStyle, onClick: openAllSessions }, '查看全部会话'),
            React.createElement('button', { style: { background: 'none', border: 'none', color: 'inherit', fontSize: 20, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }, onClick: () => setShowModal(false) }, '✕'),
          ),
        ),
        showAllSessions ? React.createElement('section', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '全部会话按时段'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(110px, 1fr))', gap: 8 } },
            React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '日期', filterSelect(hourlyFilter.date, dateOptions, value => setHourlyFilter(current => ({ ...current, date: value, hour: '' })))),
            React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '时段', filterSelect(hourlyFilter.hour, hourOptions, value => setHourlyFilter(current => ({ ...current, hour: value })))),
            React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '会话 ID', filterInput(hourlyFilter.sessionId, '包含…', value => setHourlyFilter(current => ({ ...current, sessionId: value })))),
            React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '来源', filterSelect(hourlyFilter.origin, originOptions, value => setHourlyFilter(current => ({ ...current, origin: value })))),
            React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '模型/路由', filterSelect(hourlyFilter.route, routeOptions, value => setHourlyFilter(current => ({ ...current, route: value })))),
          ),
          sessionLoading ? React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '正在加载会话费用…') : null,
          sessionLoadError ? React.createElement('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error)' } }, sessionLoadError) : null,
          !sessionLoading && !sessionLoadError && hourGroups.length === 0 ? React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '暂无匹配的时段费用') : null,
          React.createElement('div', { style: { overflowX: 'auto', fontSize: 12 } },
            React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' } },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', { style: headerLeft }, '时间段'),
                  React.createElement('th', { style: headerStyle }, '轮次'),
                  React.createElement('th', { style: headerStyle }, '步骤'),
                  React.createElement('th', { style: headerStyle }, '工具调用'),
                  React.createElement('th', { style: headerStyle }, '输入 tokens'),
                  React.createElement('th', { style: headerStyle }, '输入价格'),
                  React.createElement('th', { style: headerStyle }, '缓存 tokens'),
                  React.createElement('th', { style: headerStyle }, '缓存价格'),
                  React.createElement('th', { style: headerStyle }, '输出 tokens'),
                  React.createElement('th', { style: headerStyle }, '输出价格'),
                  React.createElement('th', { style: headerStyle }, '缓存率'),
                  React.createElement('th', { style: headerStyle }, '总价'),
                  React.createElement('th', { style: headerStyle }, '上下文翻倍'),
                  React.createElement('th', { style: headerStyle }, '时段名称'),
                  React.createElement('th', { style: headerStyle }, '模型'),
                ),
              ),
              React.createElement('tbody', null,
                ...hourGroups.flatMap(group => {
                  const timeKey = `all:time:${group.hour}`
                  const expanded = expandedHours.has(timeKey)
                  const routes = [...new Set(group.sessions.map(item => `${item.entry.provider ?? ''}/${item.entry.model ?? ''}`).filter(value => value !== '/'))]
                  const timeRow = React.createElement('tr', { key: timeKey, style: { borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)', fontWeight: 600 } },
                    React.createElement('td', { style: cellLeft }, React.createElement('button', { type: 'button', 'aria-expanded': expanded, onClick: () => toggleHour(timeKey), style: { border: 0, background: 'transparent', cursor: 'pointer', padding: '0 6px 0 0', fontSize: 13, color: 'inherit' } }, expanded ? '−' : '+'), `${localDateOfHour(group.hour)} ${group.hourLabel}`),
                    ...hourlyDataCells(group.totals),
                    React.createElement('td', { style: cellBase }, surchargeOf(group.sessions.map(item => item.entry))),
                    React.createElement('td', { style: cellBase }, `${group.sessions.length} 个会话`),
                    React.createElement('td', { style: cellBase }, routes.length === 0 ? '-' : `${routes.length} 个模型`),
                  )
                  if (!expanded) return [timeRow]
                  return [timeRow, ...group.sessions.map(item => React.createElement('tr', { key: `${timeKey}:${item.sessionId}:${item.entry.provider ?? ''}/${item.entry.model ?? ''}`, style: { borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)', background: 'var(--dsw-alias-bg-layer-2, #fafafa)' } },
                    React.createElement('td', { style: { ...cellLeft, paddingLeft: 28 }, title: item.sessionId }, `↳ ${compactId(item.sessionId)}${item.origin ? ` · ${item.origin}` : ''}`),
                    ...hourlyDataCells(item.entry),
                    React.createElement('td', { style: cellBase }, surchargeLabel(item.entry.contextAfterTokens, item.entry.contextMultiplier)),
                    React.createElement('td', { style: cellBase }, item.entry.periodName ?? '-'),
                    React.createElement('td', { style: cellBase }, item.entry.provider && item.entry.model ? `${item.entry.provider}/${item.entry.model}` : '-'),
                  ))]
                }),
                hourGroups.length > 0 ? React.createElement('tr', { style: { fontWeight: 600, borderTop: '2px solid var(--dsw-alias-border-l1, #bbb)' } },
                  React.createElement('td', { style: { ...cellLeft, fontWeight: 600 } }, '合计'),
                  ...hourlyDataCells(overviewTotals),
                  React.createElement('td', { style: cellBase }),
                  React.createElement('td', { style: cellBase }, `${hourGroups.reduce((total, group) => total + group.sessions.length, 0)} 条明细`),
                  React.createElement('td', { style: cellBase }, `${(overviewTotals.inputTokens + overviewTotals.cacheReadTokens + overviewTotals.cacheWriteTokens + overviewTotals.outputTokens).toLocaleString('zh-CN')} tokens`),
                ) : null,
              ),
            ),
          ),
        ) : React.createElement('section', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '当前会话'),
          React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, (() => {
            const labels = [...new Set([...(state.details ?? []), ...(state.hourly ?? [])].map(row => formatContextSurcharge(row.contextAfterTokens, row.contextMultiplier)).filter((value): value is string => Boolean(value)))]
            return labels.length === 0 ? '本会话没有触发上下文翻倍。' : `本会话命中：${labels.join('、')}`
          })()),
          React.createElement('div', { style: { overflowX: 'auto', fontSize: 12 } },
            React.createElement(HourlyTable, {
              sessionId: props.sessionId,
              hourly: state.hourly ?? [],
              subagents: state.subagents ?? [],
              expandedHours,
              toggleHour,
              symbol,
              cellBase,
              cellLeft,
              headerStyle,
              headerLeft,
            }),
          ),
        ),
      ),
    ) : null,
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
    }],
  })
  const slots = ctx.get('slots') as SlotsFace | undefined
  const costMeter = ctx.get('remote.costMeter') as CostMeterFace | undefined
  const connection = ctx.get('connection') as ConnectionFace | undefined
  if (!slots || !costMeter || !connection) return
  const pricing = new PricingRouteSource()
  void pricing.load()
  const catalog = new CatalogSource(connection.api)
  void catalog.load()
  const remoteEvents = ctx.get('remote') as { $on?(event: string, listener: (...args: any[]) => void): () => void }
  ctx.effect(() => remoteEvents.$on?.('llm/adapters-updated', () => { void catalog.load() }) ?? (() => {}), 'cost-meter catalog updates')

  slots.inject('conversation.composer.dock', () => slots.register(
    { name: 'conversation.composer.dock', id: 'cost-meter', order: 100 },
    (props: { sessionId: string }) => React.createElement(CostDock, { ...props, costMeter, sessions: connection.api.sessions, interval: (callback, delay) => (ctx as any).interval(callback, delay) }),
  ))
  slots.inject('settings.plugin.item', () => slots.register({
    name: 'settings.plugin.item', key: 'cost-meter', id: 'cost-meter', order: 30,
    inject: () => ({
      hooks: { pricing, catalog },
      refreshCatalog: catalog.load,
      save: (config: PricingConfig) => pricing.save(config),
    }),
  }, PricingSettingsCard))
}
