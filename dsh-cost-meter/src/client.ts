/** Browser cost display and model-aware pricing settings card. */

import type { Context } from '@deepseek-ai/cordis'
import React from 'react'
import type { PricingConfig, PricingPeriod, PricingPlan, TokenRates } from './pricing.js'
import { DEFAULT_PRICING, routeKey, validatePricing } from './pricing.js'

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
  rates: { input: number; cacheRead: number; cacheWrite: number; output: number }
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
}

interface RemoteEnvelope<T> { ok: boolean; value?: T; error?: unknown }
interface RemoteMount { $mount(contribution: unknown): Promise<() => Promise<void>> }
interface CostMeterFace { sessionCost(sessionId: string): Promise<RemoteEnvelope<CostFold | null>> }
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
interface ApiFace {
  llm: { models(input: {}): Promise<{ result: { ok: boolean; value?: { groups: ModelGroup[] } } }> }
}
interface ConnectionFace { api: ApiFace }

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
  async save(config: PricingConfig): Promise<boolean> {
    try {
      const response = await fetch(PRICING_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(config),
      })
      if (!response.ok) return false
      const body = (await response.json()) as { ok: boolean; value?: PricingConfig }
      if (body.ok && body.value) {
        this.snapshot = { status: 'ready', value: body.value, revision: 0, writable: true }
        for (const listener of this.listeners) listener()
      }
      return body.ok === true
    } catch {
      return false
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

const cloneConfig = (value?: PricingConfig): PricingConfig => JSON.parse(JSON.stringify(value ?? DEFAULT_PRICING)) as PricingConfig
const money = (value: number): string => value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)
const currencySymbol = (currency: string): string => ({ CNY: '¥', USD: '$', EUR: '€', JPY: '¥' })[currency.toUpperCase()] ?? `${currency} `
const inputStyle: React.CSSProperties = { height: 32, minWidth: 0, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '0 9px', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 12 }
const buttonStyle: React.CSSProperties = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '5px 10px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: 12, cursor: 'pointer' }
const primaryButtonStyle: React.CSSProperties = { ...buttonStyle, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' }
const RATE_FIELDS: Array<{ key: keyof TokenRates; label: string }> = [
  { key: 'input', label: '未缓存输入' },
  { key: 'cacheRead', label: '缓存读取' },
  { key: 'cacheWrite', label: '缓存写入' },
  { key: 'output', label: '输出' },
]

function NumberInput(props: { value: number | undefined; placeholder?: string; onChange(value: number | undefined): void }) {
  return React.createElement('input', {
    style: inputStyle,
    type: 'number', min: 0, step: 'any', inputMode: 'decimal',
    value: props.value ?? '', placeholder: props.placeholder ?? '',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value === '' ? undefined : Number(event.target.value)),
  })
}

function RatesGrid(props: { rates: Partial<TokenRates>; fallback?: TokenRates; onChange(rates: Partial<TokenRates>): void }) {
  return React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(96px, 1fr))', gap: 8 } },
    ...RATE_FIELDS.map(field => React.createElement('label', { key: field.key, style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
      field.label,
      React.createElement(NumberInput, {
        value: props.rates[field.key],
        placeholder: props.fallback ? String(props.fallback[field.key]) : undefined,
        onChange: value => props.onChange({ ...props.rates, [field.key]: value }),
      }),
    )),
  )
}

function PeriodEditor(props: { period: PricingPeriod; fallback: TokenRates; onChange(period: PricingPeriod): void; onRemove(): void }) {
  const set = <K extends keyof PricingPeriod>(key: K, value: PricingPeriod[K]) => props.onChange({ ...props.period, [key]: value })
  return React.createElement('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 100px 100px auto', gap: 8, alignItems: 'end' } },
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '时段名称', React.createElement('input', { style: inputStyle, value: props.period.name, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('name', event.target.value) })),
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '开始', React.createElement('input', { style: inputStyle, type: 'time', value: props.period.start, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('start', event.target.value) })),
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '结束', React.createElement('input', { style: inputStyle, type: 'time', value: props.period.end, onChange: (event: React.ChangeEvent<HTMLInputElement>) => set('end', event.target.value) })),
      React.createElement('button', { type: 'button', style: buttonStyle, onClick: props.onRemove }, '删除'),
    ),
    React.createElement(RatesGrid, { rates: props.period.rates, fallback: props.fallback, onChange: rates => set('rates', rates) }),
  )
}

function PeriodsEditor(props: { periods: PricingPeriod[]; fallback: TokenRates; onChange(periods: PricingPeriod[]): void }) {
  const add = () => props.onChange([...props.periods, { id: `period-${Date.now()}-${props.periods.length}`, name: '低峰', start: '00:00', end: '08:00', rates: {} }])
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    ...props.periods.map((period, index) => React.createElement(PeriodEditor, {
      key: period.id, period, fallback: props.fallback,
      onChange: next => props.onChange(props.periods.map((item, at) => at === index ? next : item)),
      onRemove: () => props.onChange(props.periods.filter((_item, at) => at !== index)),
    })),
    React.createElement('button', { type: 'button', style: { ...buttonStyle, alignSelf: 'flex-start' }, onClick: add }, '+ 添加计价时段'),
  )
}

function ModelPricingRow(props: { provider: ModelGroup; model: ModelItem; config: PricingConfig; onChange(config: PricingConfig): void }) {
  const key = routeKey(props.provider.id, props.model.id)!
  const plan = props.config.models[key]
  const enabled = plan !== undefined
  const [collapsed, setCollapsed] = React.useState(true)
  const setPlan = (next: PricingPlan) => props.onChange({ ...props.config, models: { ...props.config.models, [key]: next } })
  const toggle = () => {
    if (enabled) {
      const { [key]: _removed, ...models } = props.config.models
      props.onChange({ ...props.config, models })
    } else setPlan({ rates: {}, periods: [] })
  }
  return React.createElement('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 10 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }, onClick: () => setCollapsed(!collapsed) },
      React.createElement('span', { 'aria-hidden': true, style: { transform: collapsed ? 'rotate(-90deg)' : undefined, transition: 'transform 0.15s', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '▾'),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, props.model.name),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 } }, key),
      ),
      React.createElement('span', { style: { fontSize: 11, color: enabled ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-tertiary)' } }, enabled ? '专属计价' : '使用默认价格'),
      React.createElement('input', { type: 'checkbox', checked: enabled, onClick: (event: React.MouseEvent) => event.stopPropagation(), onChange: toggle, 'aria-label': `${key} 专属计价` }),
    ),
    !collapsed && enabled && plan ? React.createElement(React.Fragment, null,
      React.createElement(RatesGrid, { rates: plan.rates ?? {}, fallback: props.config.default.rates, onChange: rates => setPlan({ ...plan, rates }) }),
      React.createElement(PeriodsEditor, { periods: plan.periods ?? [], fallback: { ...props.config.default.rates, ...(plan.rates ?? {}) }, onChange: periods => setPlan({ ...plan, periods }) }),
    ) : null,
  )
}

function PricingSettingsCard(props: {
  usePricing<T>(selector: (snapshot: SettingsSnapshot) => T): T
  useCatalog<T>(selector: (snapshot: CatalogSnapshot) => T): T
  save(config: PricingConfig, revision?: number): Promise<boolean>
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
  if (settings.status === 'unavailable') return null
  const baseline = cloneConfig(settings.value)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  let invalid: string | null = null
  try { validatePricing(draft) } catch (error) { invalid = error instanceof Error ? error.message : String(error) }
  const setDefaultRates = (rates: Partial<TokenRates>) => setDraft({ ...draft, default: { ...draft.default, rates: rates as TokenRates } })
  const catalogRoutes = new Set(catalog.groups.flatMap(group => group.models.map(model => `${group.id}/${model.id}`)))
  const unavailableGroups: ModelGroup[] = Object.keys(draft.models)
    .filter(key => !catalogRoutes.has(key))
    .map((key) => {
      const slash = key.indexOf('/')
      return { id: key.slice(0, slash), name: '当前不可用', models: [{ id: key.slice(slash + 1), name: key.slice(slash + 1) }] }
    })
  const displayGroups = [...catalog.groups, ...unavailableGroups]
  const save = async () => {
    if (invalid || !dirty) return
    setSaving(true)
    setFailure(null)
    const ok = await props.save(draft, settings.revision)
    setSaving(false)
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setFailure('保存失败，请检查配置或刷新后重试。')
    }
  }
  return React.createElement('li', { style: { listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)' } },
    React.createElement('button', { type: 'button', onClick: () => setOpen(!open), 'aria-expanded': open, style: { width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' } },
      React.createElement('span', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 } },
        React.createElement('strong', { style: { fontSize: 15, fontWeight: 600 } }, 'API 费用统计'),
        React.createElement('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, '按实际 provider、模型和时段配置估算输入、缓存与输出费用。'),
      ),
      dirty ? React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '未保存') : null,
      React.createElement('span', { 'aria-hidden': true, style: { transform: open ? 'rotate(180deg)' : undefined } }, '⌄'),
    ),
    open ? React.createElement('div', { style: { margin: '0 16px', padding: '14px 0 10px', borderTop: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', gap: 16 } },
      React.createElement('section', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '默认计价'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '120px 160px 1fr', gap: 8 } },
          React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '币种', React.createElement('input', { style: inputStyle, value: draft.currency, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, currency: event.target.value.toUpperCase() }) })),
          React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '每多少 Token', React.createElement(NumberInput, { value: draft.unitTokens, onChange: value => setDraft({ ...draft, unitTokens: value ?? 0 }) })),
          React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '计价时区', React.createElement('input', { style: inputStyle, value: draft.timezone, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, timezone: event.target.value }) })),
        ),
        React.createElement(RatesGrid, { rates: draft.default.rates, onChange: setDefaultRates }),
        React.createElement(PeriodsEditor, { periods: draft.default.periods ?? [], fallback: draft.default.rates, onChange: periods => setDraft({ ...draft, default: { ...draft.default, periods } }) }),
      ),
      React.createElement('section', null,
        React.createElement('h3', { style: { margin: '0 0 4px', fontSize: 13, fontWeight: 600 } }, '可用模型'),
        React.createElement('p', { style: { margin: '0 0 8px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '未启用专属计价的模型自动使用默认价格。空白专属字段也逐项回退到默认价格。'),
        catalog.status === 'loading' ? React.createElement('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '正在加载模型…') : null,
        catalog.status === 'error' ? React.createElement('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-error)' } }, '模型目录加载失败。') : null,
        ...displayGroups.flatMap(group => [
          React.createElement('h4', { key: `group:${group.id}`, style: { margin: '14px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, `${group.name} · ${group.id}`),
          ...group.models.map(model => React.createElement(ModelPricingRow, { key: `${group.id}/${model.id}`, provider: group, model, config: draft, onChange: setDraft })),
        ]),
      ),
      invalid ? React.createElement('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error)' } }, invalid) : null,
      failure ? React.createElement('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error)' } }, failure) : null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 12 } },
        React.createElement('button', { type: 'button', style: buttonStyle, disabled: !dirty || saving, onClick: () => setDraft(baseline) }, '放弃修改'),
        React.createElement('button', { type: 'button', style: primaryButtonStyle, disabled: !dirty || saving || invalid !== null, onClick: save }, saving ? '保存中…' : saved ? '✓ 保存成功' : '保存'),
      ),
    ) : null,
  )
}

function CostDock(props: { sessionId: string; costMeter: CostMeterFace; interval(callback: () => void, delay: number): () => void }) {
  const [state, setState] = React.useState<CostFold | null>(null)
  const [tooltip, setTooltip] = React.useState(false)
  const [showModal, setShowModal] = React.useState(false)
  const [expandedSubagents, setExpandedSubagents] = React.useState<Set<string>>(() => new Set())
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
  const pricingInfo = state.pricingPeriod ? `${state.pricingPeriod} · ${state.pricingSource === 'model-period' ? '模型时段价' : state.pricingSource === 'model' ? '模型基准价' : state.pricingSource === 'default-period' ? '默认时段价' : '默认价格'}` : '默认价格'
  const totalInput = state.inputTokens
  const totalCacheRead = state.cacheReadTokens
  const totalCacheWrite = state.cacheWriteTokens
  const totalOutput = state.outputTokens
  const totalInputCost = state.inputCost
  const totalCacheReadCost = state.cacheReadCost
  const totalCacheWriteCost = state.cacheWriteCost
  const totalOutputCost = state.outputCost
  const totalCost = state.cost
  const totalTokens = totalInput + totalCacheRead + totalCacheWrite + totalOutput
  const totalCacheRate = totalTokens > 0 ? (totalCacheRead + totalCacheWrite) / totalTokens : 0
  const cellBase = { fontSize: 12, padding: '4px 8px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
  const cellLeft = { ...cellBase, textAlign: 'left' as const }
  const headerStyle = { ...cellBase, fontWeight: 600, background: 'var(--dsw-alias-bg-layer-3, #f5f5f5)', borderBottom: '1px solid var(--dsw-alias-border-l2, #ddd)', position: 'sticky' as const, top: 0, zIndex: 1 }
  const headerLeft = { ...headerStyle, textAlign: 'left' as const }
  const toggleSubagent = (id: string) => setExpandedSubagents(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const routeKey = (row: HourlyDetail): string => `${row.provider ?? ''}/${row.model ?? ''}`
  const childEntries = (rows: readonly CostSubagent[], hour: string, route: string): Array<{ sessionId: string; entry: HourlyDetail }> => rows.flatMap(row => [
    ...(row.hourly ?? []).filter(entry => entry.hour === hour && routeKey(entry) === route).map(entry => ({ sessionId: row.sessionId, entry })),
    ...childEntries(row.children, hour, route),
  ])
  const sumRows = (rows: readonly HourlyDetail[]): HourlyDetail | null => {
    const first = rows[0]
    if (first === undefined) return null
    const sum = (field: keyof HourlyDetail): number => rows.reduce((total, row) => total + (row[field] as number), 0)
    const inputTokens = sum('inputTokens')
    const cacheReadTokens = sum('cacheReadTokens')
    const cacheWriteTokens = sum('cacheWriteTokens')
    const outputTokens = sum('outputTokens')
    return { ...first, turns: sum('turns'), steps: sum('steps'), toolCalls: sum('toolCalls'), inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, inputCost: sum('inputCost'), cacheReadCost: sum('cacheReadCost'), cacheWriteCost: sum('cacheWriteCost'), outputCost: sum('outputCost'), cost: sum('cost'), cacheRate: (cacheReadTokens + cacheWriteTokens) / Math.max(1, inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens), provider: null, model: null, pricingSource: null, periodName: null }
  }
  const dataCells = (row: HourlyDetail): React.ReactNode[] => [
    React.createElement('td', { style: cellBase }, String(row.turns)), React.createElement('td', { style: cellBase }, String(row.steps)), React.createElement('td', { style: cellBase }, String(row.toolCalls)), React.createElement('td', { style: cellBase }, row.inputTokens.toLocaleString('zh-CN')), React.createElement('td', { style: cellBase }, `${symbol}${money(row.inputCost)}`), React.createElement('td', { style: cellBase }, (row.cacheReadTokens + row.cacheWriteTokens).toLocaleString('zh-CN')), React.createElement('td', { style: cellBase }, `${symbol}${money(row.cacheReadCost + row.cacheWriteCost)}`), React.createElement('td', { style: cellBase }, row.outputTokens.toLocaleString('zh-CN')), React.createElement('td', { style: cellBase }, `${symbol}${money(row.outputCost)}`), React.createElement('td', { style: cellBase }, `${(row.cacheRate * 100).toFixed(1)}%`), React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, `${symbol}${money(row.cost)}`),
  ]
  return React.createElement(React.Fragment, null,
    React.createElement('div', {
      style: { position: 'relative', overflow: 'visible', padding: '2px calc(var(--dsh-composer-side-clearance) + 16px) 0', cursor: 'pointer' },
      onMouseEnter: showTooltip,
      onMouseLeave: hideTooltip,
      onClick: () => { setShowModal(true); setTooltip(false) },
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
          const sourceLabel = detail.source === 'model-period' ? '模型时段价' : detail.source === 'model' ? '模型基准价' : detail.source === 'default-period' ? '默认时段价' : '默认价格'
          const ds = detail
          return [
            di > 0 ? React.createElement('div', { key: `sep-${di}`, style: { borderTop: '1px solid var(--dsw-alias-border-l2, #333)', margin: '2px 0' } }) : null,
            React.createElement('div', { key: `hdr-${di}`, style: { fontWeight: 600, fontSize: 12, marginTop: di > 0 ? 2 : 0 } },
              `${ds.provider ?? '?'}/${ds.model ?? '?'} · ${sourceLabel}${ds.periodName ? ` · ${ds.periodName}` : ''}`,
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
    showModal && state.hourly && state.hourly.length > 0 ? React.createElement('div', {
      style: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
      onClick: () => setShowModal(false),
    },
      React.createElement('div', {
        style: { background: 'var(--dsw-alias-bg-layer-1, #fff)', borderRadius: 12, padding: 24, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 16 },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, 'API 费用统计明细'),
          React.createElement('button', { style: { background: 'none', border: 'none', color: 'inherit', fontSize: 20, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }, onClick: () => setShowModal(false) }, '✕'),
        ),
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
                React.createElement('th', { style: headerStyle }, '时段名称'),
                React.createElement('th', { style: headerStyle }, '模型'),
              ),
            ),
            React.createElement('tbody', null,
              ...(() => {
                const flatten = (rows: readonly CostSubagent[]): Array<{ sessionId: string; entry: HourlyDetail }> => rows.flatMap(row => [
                  ...(row.hourly ?? []).map(entry => ({ sessionId: row.sessionId, entry })), ...flatten(row.children),
                ])
                const childRows = flatten(state.subagents ?? [])
                const hours = [...new Set([...state.hourly.map(row => row.hour), ...childRows.map(row => row.entry.hour)])].sort()
                return hours.flatMap(hour => {
                  const rootRows = (state.hourly ?? []).filter(row => row.hour === hour)
                  const allRows = [...rootRows, ...childRows.filter(row => row.entry.hour === hour).map(row => row.entry)]
                  const total = sumRows(allRows)
                  if (total === null) return []
                  const timeKey = `time:${hour}`
                  const timeExpanded = expandedSubagents.has(timeKey)
                  const routes = [...new Set(allRows.map(routeKey))]
                  const timeRow = React.createElement('tr', { key: timeKey, style: { borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)', fontWeight: 600 } },
                    React.createElement('td', { style: cellLeft }, React.createElement('button', { type: 'button', 'aria-expanded': timeExpanded, onClick: () => toggleSubagent(timeKey), style: { border: 0, background: 'transparent', cursor: 'pointer', padding: '0 6px 0 0', fontSize: 13, color: 'inherit' } }, timeExpanded ? '−' : '+'), total.hourLabel),
                    ...dataCells(total), React.createElement('td', { style: cellBase }, '-'), React.createElement('td', { style: cellBase }, `${routes.length} 个模型`),
                  )
                  if (!timeExpanded) return [timeRow]
                  const models = routes.flatMap(route => {
                    const entries = allRows.filter(row => routeKey(row) === route)
                    const modelTotal = sumRows(entries)
                    if (modelTotal === null) return []
                    const modelKey = `model:${hour}:${route}`
                    const modelExpanded = expandedSubagents.has(modelKey)
                    const children = childRows.filter(row => row.entry.hour === hour && routeKey(row.entry) === route)
                    const modelRow = React.createElement('tr', { key: modelKey, style: { borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)', background: 'var(--dsw-alias-bg-layer-2, #fafafa)' } },
                      React.createElement('td', { style: { ...cellLeft, paddingLeft: 28 } }, children.length > 0 ? React.createElement('button', { type: 'button', 'aria-expanded': modelExpanded, onClick: () => toggleSubagent(modelKey), style: { border: 0, background: 'transparent', cursor: 'pointer', padding: '0 6px 0 0', fontSize: 13, color: 'inherit' } }, modelExpanded ? '−' : '+') : React.createElement('span', { style: { display: 'inline-block', width: 19 } }), `↳ ${route}`),
                      ...dataCells(modelTotal), React.createElement('td', { style: cellBase }, '-'), React.createElement('td', { style: cellBase }, route),
                    )
                    if (!modelExpanded) return [modelRow]
                    return [modelRow, ...children.map(({ sessionId, entry }) => React.createElement('tr', { key: `child:${hour}:${route}:${sessionId}`, style: { borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)', color: 'var(--dsw-alias-label-secondary)' } }, React.createElement('td', { style: { ...cellLeft, paddingLeft: 52 } }, `↳ 子代理 ${sessionId.slice(0, 8)}`), ...dataCells(entry), React.createElement('td', { style: cellBase }, entry.periodName ?? '-'), React.createElement('td', { style: cellBase }, `${entry.provider ?? '?'}/${entry.model ?? '?'}`)))]
                  })
                  return [timeRow, ...models]
                })
              })(),
              React.createElement('tr', { style: { fontWeight: 600, borderTop: '2px solid var(--dsw-alias-border-l1, #bbb)' } },
                React.createElement('td', { style: { ...cellLeft, fontWeight: 600 } }, '合计'),
                React.createElement('td', { style: cellBase }),
                React.createElement('td', { style: cellBase }),
                React.createElement('td', { style: cellBase }),
                React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, totalInput.toLocaleString('zh-CN')),
                React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, `${symbol}${money(totalInputCost)}`),
                React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, (totalCacheRead + totalCacheWrite).toLocaleString('zh-CN')),
                React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, `${symbol}${money(totalCacheReadCost + totalCacheWriteCost)}`),
                React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, totalOutput.toLocaleString('zh-CN')),
                React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, `${symbol}${money(totalOutputCost)}`),
                React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, `${(totalCacheRate * 100).toFixed(1)}%`),
                React.createElement('td', { style: { ...cellBase, fontWeight: 600 } }, `${symbol}${money(totalCost)}`),
                React.createElement('td', { style: cellBase }),
                React.createElement('td', { style: cellBase }),
              ),
            ),
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
    (props: { sessionId: string }) => React.createElement(CostDock, { ...props, costMeter, interval: (callback, delay) => (ctx as any).interval(callback, delay) }),
  ))
  slots.inject('settings.plugin.item', () => slots.register({
    name: 'settings.plugin.item', key: 'cost-meter', id: 'cost-meter', order: 30,
    inject: () => ({
      hooks: { pricing, catalog },
      save: (config: PricingConfig) => pricing.save(config),
    }),
  }, PricingSettingsCard))
}
