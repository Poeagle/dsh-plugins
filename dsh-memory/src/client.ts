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

interface MemoryEntry {
  content: string
  timestamp: string
}

interface MemoryEntriesResponse {
  ok: boolean
  value?: { target: string; entries: MemoryEntry[]; usage: string }
}

interface MemoryConfigResponse {
  ok: boolean
  value?: { nudgeInterval: number; reviewEnabled: boolean }
}

interface MemoryReviewNotice {
  sessionId: string
  saved: number
  changes: readonly { target: 'memory' | 'user'; action: 'added' | 'removed'; content: string }[]
  reason: 'finished' | 'max-iterations' | 'aborted' | 'failed'
}

interface MemoryResetResponse {
  ok: boolean
  deleted?: string[]
}

interface MemoryReviewNoticeResponse {
  ok: boolean
  value?: MemoryReviewNotice | null
}

const MEMORY_ROUTE = '/memory/api'

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatTime = (iso: string): string => {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch { return iso }
}

const consumeReviewNotice = async (sessionId: string): Promise<MemoryReviewNotice | null> => {
  try {
    const response = await fetch(`${MEMORY_ROUTE}/review-notice?sessionId=${encodeURIComponent(sessionId)}`)
    const body = await response.json() as MemoryReviewNoticeResponse
    return body.ok ? body.value ?? null : null
  } catch { return null }
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

const fetchConfig = async (): Promise<MemoryConfigResponse | null> => {
  try {
    const resp = await fetch(`${MEMORY_ROUTE}/config`)
    return await resp.json() as MemoryConfigResponse
  } catch { return null }
}

const saveConfig = async (patch: { nudgeInterval?: number; reviewEnabled?: boolean }): Promise<boolean> => {
  try {
    const resp = await fetch(`${MEMORY_ROUTE}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await resp.json() as { ok: boolean }
    return body.ok
  } catch { return false }
}

const deleteEntries = async (target: string, indices: number[]): Promise<boolean> => {
  try {
    const resp = await fetch(`${MEMORY_ROUTE}/delete-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, indices }),
    })
    const body = await resp.json() as { ok: boolean }
    return body.ok
  } catch { return false }
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

const smallButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  padding: '2px 6px',
  fontSize: 11,
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

function parseMemoryResultFromContent(content: any): any {
  if (!Array.isArray(content)) return null
  const textBlock = content.find((b: any) => b?.type === 'text')
  if (!textBlock?.text) return null
  try { return JSON.parse(textBlock.text) } catch { return null }
}

function MemoryRow(props: { toolName: string; block: any; cwd?: string; home?: string; inspect?: () => void }) {
  // RunningToolCall: no kind field, argsRaw directly on block
  // ToolResultNode: kind === 'tool-result', argsRaw on block.call, result in block.content
  const isSettled = props.block.kind === 'tool-result'
  const argsRaw = isSettled
    ? (props.block.call?.argsRaw ?? '')
    : (props.block.argsRaw ?? '')
  const result = isSettled
    ? parseMemoryResultFromContent(props.block.content)
    : null
  const summary = summarizeMemoryCall(argsRaw, result)

  const [expanded, setExpanded] = React.useState(false)
  const state = result?.success === true ? 'ok' : result?.success === false ? 'error' : 'running'
  const expandable = argsRaw !== '' || result !== null

  const formatArgs = (): string => {
    const args = parseMemoryArgs(argsRaw)
    if (!args) return argsRaw
    return JSON.stringify(args, null, 2)
  }

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
      React.createElement('span', {
        style: {
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: state === 'ok' ? 'var(--dsw-alias-color-success, #22c55e)'
            : state === 'error' ? 'var(--dsw-alias-color-error, #ef4444)'
            : 'var(--dsw-alias-label-tertiary)',
        },
      }),
      React.createElement('span', {
        style: {
          fontSize: 10, color: 'var(--dsw-alias-label-tertiary)',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s', flexShrink: 0,
        },
      }, expandable ? (expanded ? '▾' : '▸') : ''),
      React.createElement('span', { style: { fontSize: 12, flexShrink: 0, marginRight: 2 } }, '📝'),
      React.createElement('span', { style: { fontWeight: 500, flexShrink: 0 } }, '记忆'),
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
    expanded ? React.createElement('div', {
      style: {
        margin: '0 0 8px 16px', padding: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2)',
        fontSize: 12, lineHeight: '1.5',
      },
    },
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
  const [open, setOpen] = React.useState(false)
  const [resetting, setResetting] = React.useState<string | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)
  const [nudgeInterval, setNudgeInterval] = React.useState(10)
  const [reviewEnabled, setReviewEnabled] = React.useState(true)
  const [configLoading, setConfigLoading] = React.useState(false)

  const loadAll = React.useCallback(async () => {
    const [s, cfg] = await Promise.all([
      fetchStatus(),
      fetchConfig(),
    ])
    if (s) setStatus(s)
    if (cfg?.ok && cfg.value) {
      setNudgeInterval(cfg.value.nudgeInterval)
      setReviewEnabled(cfg.value.reviewEnabled)
    }
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

  const handleSaveConfig = async () => {
    setConfigLoading(true)
    const ok = await saveConfig({ nudgeInterval, reviewEnabled })
    setConfigLoading(false)
    setToast(ok ? '配置已保存' : '保存配置失败')
  }

  const sectionCardStyle: React.CSSProperties = {
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-2)',
    padding: 16,
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
        React.createElement('div', { style: sectionCardStyle },
          React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4 } }, 'MEMORY.md'),
          React.createElement('div', { style: { fontSize: 18, fontWeight: 600 } },
            status ? formatBytes(status.memory.size) : '-',
          ),
          React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } },
            status ? `${status.memory.entries} 条 · ${status.memory.usage}` : '',
          ),
        ),
        React.createElement('div', { style: sectionCardStyle },
          React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4 } }, 'USER.md'),
          React.createElement('div', { style: { fontSize: 18, fontWeight: 600 } },
            status ? formatBytes(status.user.size) : '-',
          ),
          React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } },
            status ? `${status.user.entries} 条 · ${status.user.usage}` : '',
          ),
        ),
      ),

      // Config section
      React.createElement('div', { style: sectionCardStyle },
        React.createElement('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 12 } }, '⚙️ 自动复盘设置'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          React.createElement('label', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, cursor: 'pointer',
            },
          },
            React.createElement('input', {
              type: 'checkbox',
              checked: reviewEnabled,
              onChange: (e: any) => setReviewEnabled(e.target.checked),
              style: { width: 16, height: 16, cursor: 'pointer' },
            }),
            '启用自动复盘',
            React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginLeft: 4 } },
              '（对话结束后由 AI 自动判断是否写入记忆）',
            ),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('label', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, '每'),
            React.createElement('input', {
              type: 'number', min: 1, max: 100,
              value: nudgeInterval,
              disabled: !reviewEnabled,
              onChange: (e: any) => setNudgeInterval(Math.max(1, parseInt(e.target.value) || 1)),
              style: {
                width: 60, padding: '4px 8px',
                border: '1px solid var(--dsw-alias-border-l2)',
                borderRadius: 6, background: 'transparent',
                color: 'inherit', fontSize: 13, font: 'inherit',
                textAlign: 'center',
              },
            }),
            React.createElement('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '轮用户消息后自动复盘'),
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 4 } },
            React.createElement('button', {
              type: 'button',
              onClick: handleSaveConfig,
              disabled: configLoading,
              style: {
                border: 'none', borderRadius: 6, padding: '7px 16px',
                background: 'var(--dsw-alias-color-primary, #0066ff)',
                color: '#fff', fontSize: 13, cursor: 'pointer',
                font: 'inherit', fontWeight: 500,
                opacity: configLoading ? 0.6 : 1,
              },
            }, configLoading ? '保存中…' : '保存配置'),
          ),
        ),
      ),

      // Reset section
      React.createElement('div', { style: { ...sectionCardStyle, border: '1px solid var(--dsw-alias-color-error, #ef4444)' } },
        React.createElement('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--dsw-alias-label-error)' } }, '⚠️ 危险操作'),
        React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          React.createElement('button', {
            type: 'button', style: {
              ...dangerButtonStyle, padding: '7px 14px', fontSize: 13,
            },
            disabled: resetting !== null,
            onClick: () => handleReset('memory'),
          }, resetting === 'memory' ? '重置中…' : '重置 MEMORY.md'),
          React.createElement('button', {
            type: 'button', style: {
              ...dangerButtonStyle, padding: '7px 14px', fontSize: 13,
            },
            disabled: resetting !== null,
            onClick: () => handleReset('user'),
          }, resetting === 'user' ? '重置中…' : '重置 USER.md'),
          React.createElement('button', {
            type: 'button', style: {
              ...dangerButtonStyle, padding: '7px 14px', fontSize: 13,
              fontWeight: 600,
            },
            disabled: resetting !== null,
            onClick: () => handleReset('all'),
          }, resetting === 'all' ? '重置中…' : '重置全部'),
        ),
      ),
    ) : null,
  )
}

// ── Background-review notice ────────────────────────────────────────────

function MemoryReviewNotice({ sessionId }: { sessionId: string }) {
  const [notice, setNotice] = React.useState<MemoryReviewNotice | undefined>(undefined)
  const [expanded, setExpanded] = React.useState(false)
  React.useEffect(() => {
    let disposed = false
    setNotice(undefined)
    const read = (): void => {
      void consumeReviewNotice(sessionId).then((next) => {
        if (!disposed && next !== null) setNotice(next)
      })
    }
    read()
    const interval = setInterval(read, 2000)
    return () => { disposed = true; clearInterval(interval) }
  }, [sessionId])
  React.useEffect(() => { setExpanded(false) }, [notice])
  if (notice === undefined) return null
  const summary = `后台复核 · 已保存 ${notice.changes.length} 项变更`
  const toggle = (): void => { setExpanded(value => !value) }
  return React.createElement('div', {
    style: { borderBottom: '1px solid var(--dsw-alias-border-l2)', marginBottom: 4 },
  },
  React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
      fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer', userSelect: 'none',
    },
    role: 'button', tabIndex: 0, 'aria-expanded': expanded,
    onClick: toggle,
    onKeyDown: (event: any) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() }
    },
  },
  React.createElement('span', {
    style: {
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: 'var(--dsw-alias-color-success, #22c55e)',
    },
  }),
  React.createElement('span', {
    style: {
      fontSize: 10, color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0,
      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s',
    },
  }, expanded ? '▾' : '▸'),
  React.createElement('span', { style: { fontSize: 12, flexShrink: 0, marginRight: 2 } }, '📝'),
  React.createElement('span', { style: { fontWeight: 500, flexShrink: 0 } }, '记忆'),
  React.createElement('span', {
    style: {
      flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
      whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)', fontSize: 12,
    },
  }, summary),
  ),
  expanded ? React.createElement('div', {
    style: {
      margin: '0 0 8px 16px', padding: 8, border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2)', fontSize: 12, lineHeight: '1.5',
      display: 'grid', gap: 6,
    },
  },
  React.createElement('div', {
    style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', fontWeight: 600 },
  }, 'OUT · 已持久化变更'),
  notice.changes.map((change, index) => React.createElement('div', {
    key: `${index}-${change.target}-${change.action}-${change.content}`,
    style: {
      display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: 6, alignItems: 'start',
      padding: '6px 8px', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 4,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dsw-alias-label-primary)',
    },
  },
  React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, change.target === 'user' ? 'USER' : 'MEMORY'),
  React.createElement('span', {
    style: { color: change.action === 'added' ? 'var(--dsw-alias-color-success, #22c55e)' : 'var(--dsw-alias-label-error)', fontWeight: 600 },
  }, change.action === 'added' ? '＋' : '−'),
  React.createElement('span', null, change.content),
  )),
  ) : null)
}

// ── Dock indicator (memory usage under composer) ────────────────────────

function MemoryDock(_props: { sessionId: string }) {
  const [status, setStatus] = React.useState<MemoryStatus | null>(null)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [entries, setEntries] = React.useState<{ memory: MemoryEntry[]; user: MemoryEntry[] }>({ memory: [], user: [] })
  const [tab, setTab] = React.useState<'memory' | 'user'>('memory')
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [loading, setLoading] = React.useState(false)
  const [toast, setToast] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetchStatus().then(setStatus)
    const interval = setInterval(() => { fetchStatus().then(setStatus) }, 10000)
    return () => clearInterval(interval)
  }, [])

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  React.useEffect(() => { setSelected(new Set()) }, [tab])

  const openModal = async () => {
    setModalOpen(true)
    setLoading(true)
    const [memEntries, userEntries] = await Promise.all([
      fetchEntries('memory'),
      fetchEntries('user'),
    ])
    const memVal: MemoryEntry[] = memEntries?.ok === true && memEntries.value?.entries ? memEntries.value.entries : []
    const userVal: MemoryEntry[] = userEntries?.ok === true && userEntries.value?.entries ? userEntries.value.entries : []
    setEntries({ memory: memVal, user: userVal })
    setLoading(false)
  }

  const closeModal = () => { setModalOpen(false); setSelected(new Set()) }

  const reloadEntries = async () => {
    const [memEntries, userEntries] = await Promise.all([
      fetchEntries('memory'),
      fetchEntries('user'),
    ])
    const memVal: MemoryEntry[] = memEntries?.ok === true && memEntries.value?.entries ? memEntries.value.entries : []
    const userVal: MemoryEntry[] = userEntries?.ok === true && userEntries.value?.entries ? userEntries.value.entries : []
    setEntries({ memory: memVal, user: userVal })
    const s = await fetchStatus()
    if (s) setStatus(s)
  }

  const handleDeleteSelected = async () => {
    const indices = [...selected].sort((a, b) => b - a)
    if (indices.length === 0) return
    const ok = await deleteEntries(tab, indices)
    if (ok) {
      setToast(`已删除 ${indices.length} 条`)
      setSelected(new Set())
      await reloadEntries()
    } else {
      setToast('删除失败')
    }
  }

  const handleDeleteSingle = async (index: number) => {
    const ok = await deleteEntries(tab, [index])
    if (ok) {
      setToast('已删除')
      await reloadEntries()
    } else {
      setToast('删除失败')
    }
  }

  const toggleSelected = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const currentEntries: MemoryEntry[] = entries[tab]

  const cellStyle: React.CSSProperties = {
    padding: '6px 8px', fontSize: 12,
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    color: 'var(--dsw-alias-label-primary)',
    lineHeight: '1.5', wordBreak: 'break-word',
    verticalAlign: 'top',
  }

  if (!status) return null
  return React.createElement('div', { style: { display: 'contents' } },
    // Dock text (clickable)
    React.createElement('div', {
      style: {
        textAlign: 'center',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12, lineHeight: '20px',
        padding: '2px 16px 0',
        cursor: 'pointer',
      },
      onClick: openModal,
      title: '点击查看记忆详情',
    },
      `📝 MEMORY: ${status.memory.entries} 条 · USER: ${status.user.entries} 条`,
    ),

    // Modal overlay
    modalOpen ? React.createElement('div', {
      key: 'memory-modal-overlay',
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      },
      onClick: (e: any) => { if (e.target === e.currentTarget) closeModal() },
    },
      React.createElement('div', {
        style: {
          background: 'var(--dsw-alias-bg-layer-1, #fff)',
          borderRadius: 12, width: '80vw', maxWidth: 800, maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        },
        onClick: (e: any) => e.stopPropagation(),
      },
        // Header
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', borderBottom: '1px solid var(--dsw-alias-border-l2)',
          },
        },
          React.createElement('strong', { style: { fontSize: 15, fontWeight: 600 } }, '持久记忆'),
          React.createElement('button', {
            type: 'button', onClick: closeModal,
            style: { border: 0, background: 'transparent', color: 'inherit', fontSize: 18, cursor: 'pointer', padding: '0 4px' },
          }, '✕'),
        ),

        // Toast
        toast ? React.createElement('div', {
          style: {
            margin: '8px 16px 0', padding: '6px 12px', borderRadius: 6,
            background: 'var(--dsw-alias-color-success, #22c55e)',
            color: '#fff', fontSize: 12, textAlign: 'center',
          },
        }, toast) : null,

        // Tab bar
        React.createElement('div', {
          style: {
            display: 'flex', gap: 0, borderBottom: '1px solid var(--dsw-alias-border-l2)',
            padding: '0 16px',
          },
        },
          React.createElement('button', {
            type: 'button', onClick: () => setTab('memory'),
            style: {
              flex: 1, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer',
              padding: '8px 0', fontSize: 13,
              borderBottom: tab === 'memory' ? '2px solid var(--dsw-alias-label-primary)' : '2px solid transparent',
              fontWeight: tab === 'memory' ? 600 : 400,
            },
          }, `MEMORY.md (${entries.memory.length} 条)`),
          React.createElement('button', {
            type: 'button', onClick: () => setTab('user'),
            style: {
              flex: 1, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer',
              padding: '8px 0', fontSize: 13,
              borderBottom: tab === 'user' ? '2px solid var(--dsw-alias-label-primary)' : '2px solid transparent',
              fontWeight: tab === 'user' ? 600 : 400,
            },
          }, `USER.md (${entries.user.length} 条)`),
        ),

        // Batch action bar
        selected.size > 0
          ? React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                padding: '8px 16px', background: 'var(--dsw-alias-bg-layer-2)',
              },
            },
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, `已选 ${selected.size} 条`),
              React.createElement('button', { type: 'button', onClick: handleDeleteSelected, style: dangerButtonStyle }, '删除选中'),
              React.createElement('button', { type: 'button', onClick: () => setSelected(new Set()), style: buttonStyle }, '取消选择'),
            )
          : null,

        // Entry table
        React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '0 16px 16px' } },
          loading
            ? React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: 8 } }, '加载中…')
            : currentEntries.length === 0
            ? React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: 8 } }, '（空）')
            : React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: 8 } },
                React.createElement('thead', { style: { position: 'sticky', top: 0, background: 'var(--dsw-alias-bg-layer-1, #fff)', zIndex: 1 } },
                  React.createElement('tr', null,
                    React.createElement('th', { style: { ...cellStyle, width: 32, textAlign: 'center', fontWeight: 600 } }, ''),
                    React.createElement('th', { style: { ...cellStyle, fontWeight: 600, width: 160 } }, '时间'),
                    React.createElement('th', { style: { ...cellStyle, fontWeight: 600 } }, '内容'),
                    React.createElement('th', { style: { ...cellStyle, width: 60, textAlign: 'center', fontWeight: 600 } }, '操作'),
                  ),
                ),
                React.createElement('tbody', null,
                  currentEntries.map((entry: MemoryEntry, i: number) =>
                    React.createElement('tr', {
                      key: i,
                      style: { background: selected.has(i) ? 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.05))' : undefined },
                    },
                      React.createElement('td', { style: { ...cellStyle, textAlign: 'center' } },
                        React.createElement('input', { type: 'checkbox', checked: selected.has(i), onChange: () => toggleSelected(i) }),
                      ),
                      React.createElement('td', { style: { ...cellStyle, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
                        formatTime(entry.timestamp),
                      ),
                      React.createElement('td', { style: cellStyle }, entry.content),
                      React.createElement('td', { style: { ...cellStyle, textAlign: 'center' } },
                        React.createElement('button', {
                          type: 'button', onClick: () => handleDeleteSingle(i),
                          style: { ...smallButtonStyle, color: 'var(--dsw-alias-label-error)', borderColor: 'var(--dsw-alias-label-error)' },
                          title: '删除此条',
                        }, '删除'),
                      ),
                    ),
                  ),
                ),
              ),
        ),
      ),
    ) : null,
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

  // 3. Show one transient, source-session-only review receipt above the composer.
  slots.inject('conversation.input.dock', () => slots.register(
    { name: 'conversation.input.dock', id: 'memory-review', order: 30 },
    (props: { sessionId: string }) => React.createElement(MemoryReviewNotice, props),
  ))

  // 4. Register the dock indicator
  slots.inject('conversation.composer.dock', () => slots.register(
    { name: 'conversation.composer.dock', id: 'memory-indicator', order: 200 },
    (props: { sessionId: string }) => React.createElement(MemoryDock, { ...props }),
  ))
}