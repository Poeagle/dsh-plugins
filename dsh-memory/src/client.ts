/** Browser memory UI: custom toolview row, settings card, and dock indicator. */

import type { Context } from '@deepseek-ai/cordis'
import React from 'react'

export const inject = ['slots', 'connection']

interface SlotsFace {
  inject(name: string, fn: () => unknown): void
  register(spec: Record<string, unknown>, component: React.ComponentType<any>): unknown
}

interface MemoryStatus {
  memory: { size: number; entries: number; usage: string }
  user: { size: number; entries: number; usage: string }
}

interface MemoryEntriesResponse {
  ok: boolean
  value?: { target: string; entries: string[]; usage: string }
}

interface MemoryResetResponse {
  ok: boolean
  deleted?: string[]
}

const MEMORY_ROUTE = '/memory/api'

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const fetchStatus = async (): Promise<MemoryStatus | null> => {
  try {
    const resp = await fetch(`${MEMORY_ROUTE}/status`)
    const body = await resp.json() as { ok: boolean; value?: MemoryStatus }
    return body.ok && body.value ? body.value : null
  } catch { return null }
}

const fetchEntries = async (target: string): Promise<MemoryEntriesResponse | null> => {
  try {
    const resp = await fetch(`${MEMORY_ROUTE}/entries?target=${target}`)
    return await resp.json() as MemoryEntriesResponse
  } catch { return null }
}

const resetMemory = async (target: string): Promise<MemoryResetResponse | null> => {
  try {
    const resp = await fetch(`${MEMORY_ROUTE}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target }),
    })
    return await resp.json() as MemoryResetResponse
  } catch { return null }
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6, padding: '5px 10px',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  font: 'inherit', fontSize: 12, cursor: 'pointer',
}

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  color: 'var(--dsw-alias-label-error)',
  borderColor: 'var(--dsw-alias-label-error)',
}

// ── Toolview row (custom memory tool call row) ──────────────────────────

function parseMemoryArgs(argsRaw: string): { action?: string; target?: string; content?: string; old_text?: string; operations?: Array<{ action: string; content?: string; old_text?: string }> } | null {
  try {
    const parsed = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as any
  } catch { return null }
}

function summarizeMemoryCall(argsRaw: string, result: any): string {
  const args = parseMemoryArgs(argsRaw)
  if (!args) return 'Memory'

  const isBatch = Array.isArray(args.operations) && args.operations.length > 0
  const target = args.target === 'user' ? 'USER' : 'MEMORY'
  const ops = args.operations ?? []

  if (result?.success === true) {
    const count = result.entry_count ?? 0
    const usage = result.usage ?? ''
    if (isBatch) return `${target} · ${ops.length} 操作 · ${usage} · ${count} 条`
    if (args.action === 'add') return `${target} · 添加 · ${usage} · ${count} 条`
    if (args.action === 'replace') return `${target} · 替换 · ${usage} · ${count} 条`
    if (args.action === 'remove') return `${target} · 删除 · ${usage} · ${count} 条`
    return `${target} · ${usage} · ${count} 条`
  }

  if (result?.error) return `${target} · 失败: ${result.error.slice(0, 40)}`
  if (isBatch) return `${target} · ${ops.length} 操作`
  if (args.action === 'add') return `${target} · 添加`
  if (args.action === 'replace') return `${target} · 替换`
  if (args.action === 'remove') return `${target} · 删除`
  return `${target}`
}

function MemoryRow(props: { toolName: string; block: any; cwd?: string; home?: string; inspect?: () => void }) {
  const argsRaw = ('kind' in props.block ? props.block.call?.argsRaw : props.block.argsRaw) ?? ''
  const result = 'kind' in props.block && props.block.kind === 'settled' ? props.block.result : null
  const summary = summarizeMemoryCall(argsRaw, result)

  const [expanded, setExpanded] = React.useState(false)
  const state = result?.success === true ? 'ok' : result?.success === false ? 'error' : 'running'
  const expandable = argsRaw !== '' || result !== null

  // Format args for display
  const formatArgs = (): string => {
    const args = parseMemoryArgs(argsRaw)
    if (!args) return argsRaw
    return JSON.stringify(args, null, 2)
  }

  // Format result for display
  const formatResult = (): string => {
    if (!result) return ''
    return JSON.stringify(result, null, 2)
  }

  const toggleExpand = () => {
    if (expandable) setExpanded(v => !v)
  }

  const rowCardStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 0', fontSize: 13, lineHeight: '20px',
    color: 'var(--dsw-alias-label-primary)',
    cursor: expandable ? 'pointer' : undefined,
    userSelect: 'none',
  }

  return React.createElement('div', { style: { borderBottom: '1px solid var(--dsw-alias-border-l2)', marginBottom: 4 } },
    // Collapsed row
    React.createElement('div', {
      style: rowCardStyle,
      role: expandable ? 'button' : undefined,
      tabIndex: expandable ? 0 : undefined,
      'aria-expanded': expandable ? expanded : undefined,
      onClick: toggleExpand,
      onKeyDown: (e: any) => {
        if (expandable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleExpand() }
      },
    },
      // Leading dot
      React.createElement('span', {
        style: {
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: state === 'ok' ? 'var(--dsw-alias-color-success, #22c55e)'
            : state === 'error' ? 'var(--dsw-alias-color-error, #ef4444)'
            : 'var(--dsw-alias-label-tertiary)',
        },
      }),
      // Expand chevron
      React.createElement('span', {
        style: {
          fontSize: 10, color: 'var(--dsw-alias-label-tertiary)',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s', flexShrink: 0,
        },
      }, expandable ? (expanded ? '▾' : '▸') : ''),
      // Icon
      React.createElement('span', { style: { fontSize: 12, flexShrink: 0, marginRight: 2 } }, '📝'),
      // Title
      React.createElement('span', { style: { fontWeight: 500, flexShrink: 0 } }, '记忆'),
      // Summary
      React.createElement('span', {
        style: {
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)',
          fontSize: 12,
        },
      }, summary),
      props.inspect && result?.error
        ? React.createElement('button', {
          style: { ...buttonStyle, padding: '2px 6px', fontSize: 11 },
          onClick: (e: any) => { e.stopPropagation(); props.inspect?.() },
        }, '查看详情')
        : null,
    ),
    // Expanded body
    expanded ? React.createElement('div', {
      style: {
        margin: '0 0 8px 16px', padding: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2)',
        fontSize: 12, lineHeight: '1.5',
      },
    },
      // IN section
      argsRaw ? React.createElement('div', { style: { marginBottom: 8 } },
        React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4, fontWeight: 600 } }, 'IN'),
        React.createElement('pre', {
          style: {
            margin: 0, padding: '6px 8px',
            background: 'var(--dsw-alias-bg-layer-3)',
            borderRadius: 4, overflow: 'auto',
            fontSize: 11, color: 'var(--dsw-alias-label-primary)',
            maxHeight: 200,
          },
        }, formatArgs()),
      ) : null,
      // OUT section
      result ? React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4, fontWeight: 600 } }, 'OUT'),
        React.createElement('pre', {
          style: {
            margin: 0, padding: '6px 8px',
            background: 'var(--dsw-alias-bg-layer-3)',
            borderRadius: 4, overflow: 'auto',
            fontSize: 11, color: result?.success === false ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-label-primary)',
            maxHeight: 200,
          },
        }, formatResult()),
      ) : null,
    ) : null,
  )
}

// ── Settings card (memory management) ───────────────────────────────────

function MemorySettingsCard(_props: Record<string, unknown>) {
  const [status, setStatus] = React.useState<MemoryStatus | null>(null)
  const [entries, setEntries] = React.useState<{ memory: string[]; user: string[] }>({ memory: [], user: [] })
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<'memory' | 'user'>('memory')
  const [resetting, setResetting] = React.useState<string | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  const loadAll = React.useCallback(async () => {
    setLoading(true)
    const [s, memEntries, userEntries] = await Promise.all([
      fetchStatus(),
      fetchEntries('memory'),
      fetchEntries('user'),
    ])
    if (s) setStatus(s)
    const memVal: string[] = memEntries?.ok === true && memEntries.value?.entries ? memEntries.value.entries : []
    const userVal: string[] = userEntries?.ok === true && userEntries.value?.entries ? userEntries.value.entries : []
    setEntries({ memory: memVal, user: userVal })
    setLoading(false)
  }, [])

  React.useEffect(() => { loadAll() }, [loadAll])

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const handleReset = async (target: string) => {
    setResetting(target)
    const result = await resetMemory(target)
    setResetting(null)
    if (result?.ok) {
      setToast(`已重置 ${target === 'all' ? '全部' : target === 'user' ? 'USER.md' : 'MEMORY.md'}`)
      await loadAll()
    } else {
      setToast('重置失败')
    }
  }

  const currentTarget = tab
  const currentEntries = entries[currentTarget]

  const cellStyle: React.CSSProperties = {
    padding: '8px 12px', fontSize: 12,
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    color: 'var(--dsw-alias-label-primary)',
    lineHeight: '1.5', wordBreak: 'break-word',
  }

  return React.createElement('li', {
    style: {
      listStyle: 'none',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)',
    },
  },
    React.createElement('button', {
      type: 'button', onClick: () => setOpen(!open),
      'aria-expanded': open,
      style: {
        width: '100%', border: 0, background: 'transparent',
        color: 'inherit', textAlign: 'left',
        padding: '14px 16px', display: 'flex',
        alignItems: 'center', gap: 12, cursor: 'pointer',
      },
    },
      React.createElement('span', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 } },
        React.createElement('strong', { style: { fontSize: 15, fontWeight: 600 } }, '持久记忆'),
        React.createElement('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } },
          status
            ? `MEMORY.md ${status.memory.usage} · USER.md ${status.user.usage}`
            : '加载中…',
        ),
      ),
      React.createElement('span', { 'aria-hidden': true, style: { transform: open ? 'rotate(180deg)' : undefined } }, '⌄'),
    ),
    open ? React.createElement('div', {
      style: {
        margin: '0 16px', padding: '14px 0 10px',
        borderTop: '1px solid var(--dsw-alias-border-l2)',
        display: 'flex', flexDirection: 'column', gap: 16,
      },
    },
      toast ? React.createElement('div', {
        style: {
          padding: '6px 12px', borderRadius: 6,
          background: 'var(--dsw-alias-color-success, #22c55e)',
          color: '#fff', fontSize: 12, textAlign: 'center',
        },
      }, toast) : null,

      // Stats
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
        React.createElement('div', {
          style: {
            padding: 10, borderRadius: 6,
            border: '1px solid var(--dsw-alias-border-l2)',
            display: 'flex', flexDirection: 'column', gap: 4,
          },
        },
          React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, 'MEMORY.md'),
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600 } },
            status ? formatBytes(status.memory.size) : '-',
          ),
          React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
            status ? `${status.memory.entries} 条 · ${status.memory.usage}` : '',
          ),
        ),
        React.createElement('div', {
          style: {
            padding: 10, borderRadius: 6,
            border: '1px solid var(--dsw-alias-border-l2)',
            display: 'flex', flexDirection: 'column', gap: 4,
          },
        },
          React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, 'USER.md'),
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600 } },
            status ? formatBytes(status.user.size) : '-',
          ),
          React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
            status ? `${status.user.entries} 条 · ${status.user.usage}` : '',
          ),
        ),
      ),

      // Tab bar
      React.createElement('div', { style: { display: 'flex', gap: 0, borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
        React.createElement('button', {
          type: 'button',
          onClick: () => setTab('memory'),
          style: {
            flex: 1, border: 0, background: 'transparent',
            color: 'inherit', cursor: 'pointer',
            padding: '8px 0', fontSize: 13,
            borderBottom: tab === 'memory' ? '2px solid var(--dsw-alias-label-primary)' : '2px solid transparent',
            fontWeight: tab === 'memory' ? 600 : 400,
          },
        }, 'MEMORY.md'),
        React.createElement('button', {
          type: 'button',
          onClick: () => setTab('user'),
          style: {
            flex: 1, border: 0, background: 'transparent',
            color: 'inherit', cursor: 'pointer',
            padding: '8px 0', fontSize: 13,
            borderBottom: tab === 'user' ? '2px solid var(--dsw-alias-label-primary)' : '2px solid transparent',
            fontWeight: tab === 'user' ? 600 : 400,
          },
        }, 'USER.md'),
      ),

      // Entry list
      loading
        ? React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: 8 } }, '加载中…')
        : currentEntries.length === 0
        ? React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: 8 } }, '（空）')
        : React.createElement('div', { style: { maxHeight: 300, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6 } },
            (currentEntries as string[]).map((entry: string, i: number) =>
              React.createElement('div', { key: i, style: cellStyle },
                React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 2 } }, `#${i + 1}`),
                entry,
              ),
            ),
          ),

      // Reset buttons
      React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 12 } },
        React.createElement('button', {
          type: 'button', style: dangerButtonStyle,
          disabled: resetting !== null,
          onClick: () => handleReset('memory'),
        }, resetting === 'memory' ? '重置中…' : '重置 MEMORY.md'),
        React.createElement('button', {
          type: 'button', style: dangerButtonStyle,
          disabled: resetting !== null,
          onClick: () => handleReset('user'),
        }, resetting === 'user' ? '重置中…' : '重置 USER.md'),
        React.createElement('button', {
          type: 'button', style: { ...dangerButtonStyle, fontWeight: 600 },
          disabled: resetting !== null,
          onClick: () => handleReset('all'),
        }, resetting === 'all' ? '重置中…' : '重置全部'),
      ),
    ) : null,
  )
}

// ── Dock indicator (memory usage under composer) ────────────────────────

function MemoryDock(_props: { sessionId: string }) {
  const [status, setStatus] = React.useState<MemoryStatus | null>(null)
  React.useEffect(() => {
    fetchStatus().then(setStatus)
    const interval = setInterval(() => { fetchStatus().then(setStatus) }, 10000)
    return () => clearInterval(interval)
  }, [])
  if (!status) return null
  return React.createElement('div', {
    style: {
      textAlign: 'center',
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: 12, lineHeight: '20px',
      padding: '2px 16px 0',
    },
  },
    React.createElement('span', null, `📝 ${status.memory.entries + status.user.entries} 条记忆 · ${status.memory.usage}`),
  )
}

// ── Plugin apply ────────────────────────────────────────────────────────

export async function apply(ctx: Context) {
  const slots = ctx.get('slots') as SlotsFace | undefined
  if (!slots) return

  // 1. Register the memory toolview (custom row for memory tool calls)
  slots.inject('tool.call.toolview', () => slots.register(
    { name: 'tool.call.toolview', key: 'memory' },
    MemoryRow,
  ))

  // 2. Register the settings card
  slots.inject('settings.plugin.item', () => slots.register({
    name: 'settings.plugin.item', key: 'memory', id: 'memory', order: 40,
  }, MemorySettingsCard))

  // 3. Register the dock indicator
  slots.inject('conversation.composer.dock', () => slots.register(
    { name: 'conversation.composer.dock', id: 'memory-indicator', order: 200 },
    (props: { sessionId: string }) => React.createElement(MemoryDock, { ...props }),
  ))
}