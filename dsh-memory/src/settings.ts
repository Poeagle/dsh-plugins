/** Host settings registration and memory HTTP route for dsh-memory. */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
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
  // dispatch our card key.
  const settings = ctx.get('settings') as SettingsFace | undefined
  if (settings !== undefined) {
    settings.register(SETTINGS_NS, z.object({}), {
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
              .then(b => b.length).catch(() => 0)
            const userStat = await readFile(join(memDir, 'USER.md'))
              .then(b => b.length).catch(() => 0)
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

        // GET /memory/api/entries?target=memory|user — return entries
        if (method === 'GET' && url.pathname === '/memory/api/entries') {
          const target = url.searchParams.get('target') === 'user' ? 'user' : 'memory'
          await store.loadFromDisk()
          send(res, 200, {
            ok: true,
            value: {
              target,
              entries: store.entriesFor(target),
              usage: store.usageString(target),
            },
          })
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