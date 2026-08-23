/** Host settings registration and memory HTTP route for dsh-memory. */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './index.ts'
import { memoryReviewNotices } from './review-notices.ts'
import { MemoryStore } from './store.ts'

const MEMORY_ROUTE = '/memory/api'
const SETTINGS_NS = 'memory'

interface WebServerFace {
  register(route: {
    name: string
    kind: string
    path: string
    handler(req: any, res: any): Promise<void> | void
  }): unknown
}

interface SettingsFace {
  register<T>(namespace: string, schema: any, options: { base: T; validate(value: T): void }): unknown
}

/** Same-origin loopback fence for the memory route. */
function isTrustedRequest(req: any): boolean {
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHost(hostUrl.hostname)) return false
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

const send = (res: any, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export const name = 'memory-settings'
export const inject = ['settings']

/** Register the settings namespace and memory HTTP route for browser settings management. */
export function apply(ctx: Context): void {
  // Register the settings namespace so the Configurable Plugins tab knows to
  // dispatch our card key. The schema exposes the configurable fields.
  const settings = ctx.get('settings') as SettingsFace | undefined
  if (settings !== undefined) {
    settings.register(SETTINGS_NS, Config, {
      base: {},
      validate: () => {},
    })
  }
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = (webCtx as Context & { webServer: WebServerFace }).webServer
    const store = new MemoryStore({
      dir: MemoryStore.defaultDir(),
      memoryCharLimit: 2200,
      userCharLimit: 1375,
    })

    webServer.register({
      name: 'memory-api',
      kind: 'prefix',
      path: MEMORY_ROUTE,
      handler: async (req: any, res: any) => {
        if (!isTrustedRequest(req)) {
          send(res, 403, { ok: false, error: 'request refused: same-origin loopback only' })
          return
        }
        const url = new URL(req.url, `http://${req.headers.host}`)
        const method = req.method

        // GET /memory/api/status — return memory file sizes and usage
        if (method === 'GET' && url.pathname === '/memory/api/status') {
          await store.loadFromDisk()
          const memEntries = store.entriesFor('memory')
          const userEntries = store.entriesFor('user')
          const memDir = MemoryStore.defaultDir()
          let memSize = 0
          let userSize = 0
          try {
            const memStat = await readFile(join(memDir, 'MEMORY.md'))
              .then((b: string) => b.length).catch(() => 0)
            const userStat = await readFile(join(memDir, 'USER.md'))
              .then((b: string) => b.length).catch(() => 0)
            memSize = memStat
            userSize = userStat
          } catch { /* ignore */ }
          send(res, 200, {
            ok: true,
            value: {
              memory: { size: memSize, entries: memEntries.length, usage: store.usageString('memory') },
              user: { size: userSize, entries: userEntries.length, usage: store.usageString('user') },
            },
          })
          return
        }

        // GET /memory/api/entries?target=memory|user — return entries with metadata
        if (method === 'GET' && url.pathname === '/memory/api/entries') {
          const target = url.searchParams.get('target') === 'user' ? 'user' : 'memory'
          await store.loadFromDisk()
          const entries = store.entriesWithMeta(target)
          send(res, 200, {
            ok: true,
            value: {
              target,
              entries: entries.map(e => ({ content: e.content, timestamp: e.timestamp })),
              usage: store.usageString(target),
            },
          })
          return
        }

        // GET /memory/api/review-notice?sessionId=<id> — consume one source-session review receipt
        if (method === 'GET' && url.pathname === '/memory/api/review-notice') {
          const sessionId = url.searchParams.get('sessionId')
          if (sessionId === null || sessionId === '') {
            send(res, 400, { ok: false, error: 'sessionId is required.' })
            return
          }
          send(res, 200, { ok: true, value: memoryReviewNotices.consume(sessionId) ?? null })
          return
        }

        // GET /memory/api/config — return current memory settings
        if (method === 'GET' && url.pathname === '/memory/api/config') {
          const settings = ctx.get('settings') as any
          let nudgeInterval = 10
          let reviewEnabled = true
          if (settings?.get) {
            const cfg = settings.get('memory') as any
            if (cfg) {
              nudgeInterval = cfg.nudgeInterval ?? 10
              reviewEnabled = cfg.reviewEnabled ?? true
            }
          }
          send(res, 200, { ok: true, value: { nudgeInterval, reviewEnabled } })
          return
        }

        // POST /memory/api/config — update memory settings
        if (method === 'POST' && url.pathname === '/memory/api/config') {
          let body = ''
          for await (const chunk of req) body += chunk
          let parsed: { nudgeInterval?: number; reviewEnabled?: boolean }
          try { parsed = JSON.parse(body) } catch { parsed = {} }
          const settings = ctx.get('settings') as any
          if (settings?.update) {
            const patch: Record<string, unknown> = {}
            if (parsed.nudgeInterval !== undefined) patch.nudgeInterval = parsed.nudgeInterval
            if (parsed.reviewEnabled !== undefined) patch.reviewEnabled = parsed.reviewEnabled
            await settings.update('memory', patch)
            send(res, 200, { ok: true })
          } else {
            send(res, 200, { ok: true, note: 'Settings service not available; values will be used for this session only.' })
          }
          return
        }

        // POST /memory/api/delete-entries — delete entries by indices
        if (method === 'POST' && url.pathname === '/memory/api/delete-entries') {
          let body = ''
          for await (const chunk of req) body += chunk
          let parsed: { target?: string; indices?: number[] }
          try { parsed = JSON.parse(body) } catch { parsed = {} }
          const target = parsed.target === 'user' ? 'user' : 'memory'
          const indices = Array.isArray(parsed.indices) ? parsed.indices : []
          if (indices.length === 0) {
            send(res, 400, { ok: false, error: 'No indices provided.' })
            return
          }
          const result = await store.removeByIndices(target, indices)
          send(res, result.success ? 200 : 400, { ok: result.success, value: result })
          return
        }

        // POST /memory/api/reset — reset a target store
        if (method === 'POST' && url.pathname === '/memory/api/reset') {
          let body = ''
          for await (const chunk of req) body += chunk
          let parsed: { target?: string }
          try { parsed = JSON.parse(body) } catch { parsed = {} }
          const target = parsed.target === 'user' ? 'user' : parsed.target === 'all' ? 'all' : 'memory'
          const memDir = MemoryStore.defaultDir()
          const deleted: string[] = []
          if (target === 'memory' || target === 'all') {
            try { await writeFile(join(memDir, 'MEMORY.md'), '', { mode: 0o600 }); deleted.push('MEMORY.md') } catch { /* ignore */ }
          }
          if (target === 'user' || target === 'all') {
            try { await writeFile(join(memDir, 'USER.md'), '', { mode: 0o600 }); deleted.push('USER.md') } catch { /* ignore */ }
          }
          send(res, 200, { ok: true, deleted })
          return
        }

        send(res, 404, { ok: false, error: 'not found' })
      },
    })
  })
}
