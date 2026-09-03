import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, {
  ToolCallId,
  LlmAdapter,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq, SessionStore, type SessionEvent } from '@deepseek-ai/dsh-session'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as memory from '../src/index.ts'
import { memoryReviewNotices } from '../src/review-notices.ts'
import { memoryReviewProgress } from '../src/review-progress.ts'

const SIGNAL = new AbortController().signal

/** Let every queued microtask and macrotask settle. */
function settle(ms = 25): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** One text completion ending in a stop finish. */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One tool-call completion ending in a tool-calls finish. */
function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

let home: string | undefined
let ctx: Context | undefined
let memoryFiber: { dispose(): Promise<void> } | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-memory-home-'))
  process.env['DSH_HOME'] = home
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  memoryFiber = undefined
  delete process.env['DSH_HOME']
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

/** Mount the four injected services plus the memory plugin. */
async function mount(config: Partial<memory.Config> = {}): Promise<Context> {
  const c = new Context()
  ctx = c
  await c.plugin(SessionStore)
  await c.plugin(SystemPrompt)
  await c.plugin(ToolRuntime)
  await c.plugin(AgentRegistry)
  await c.plugin(LlmRuntime)
  // schemastery fills every omitted field with its default before apply runs.
  memoryFiber = await c.plugin(memory, config as memory.Config)
  return c
}

/** Seed one memory file with `§`-delimited entries before activation. */
async function seedFile(target: 'memory' | 'user', ...entries: string[]): Promise<void> {
  const memories = join(home as string, 'memories')
  await mkdir(memories, { recursive: true })
  await writeFile(join(memories, target === 'memory' ? 'MEMORY.md' : 'USER.md'), entries.join('\n§\n'), 'utf8')
}

/** Execute one memory tool call through the registry and return the parsed result. */
async function callMemory(c: Context, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await c.tools.execute({ signal: SIGNAL, callId: ToolCallId(`mem-${String(Math.random())}`), name: 'memory', arguments: args })
  expect(result.isError).toBe(false)
  const text = result.content.find(block => block.type === 'text')
  if (text?.type !== 'text') throw new Error('memory tool produced no text block')
  return JSON.parse(text.text) as Record<string, unknown>
}

/** Append one user-source user message inside an open turn. */
function appendUserMessage(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** A LIVE session with one user turn and a request header pinning the route. */
function sessionWithRoute(c: Context, id: string): Session {
  const session = c.sessions.create(SessionId(id))
  appendUserMessage(session, 'I work the night shift.')
  session.append('request/header', {
    header: { config: { provider: 'mock', model: 'mock-model' }, system: 'You are helpful.' },
    reason: 'initial',
  })
  return session
}

/**
 * Minimal scripted adapter: each entry is consumed by one stream call.
 * A function entry may inspect the request or await a gate before yielding.
 */
class ScriptedAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(readonly script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[] | Promise<StreamChunk[]>))[]) {
    super()
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push({
      ...options,
      messages: options.messages.map(message => ({ ...message, content: [...message.content] })),
    })
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    const chunks = typeof entry === 'function' ? await entry(options) : entry
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

/** One registered fake agent driving `session`. */
function makeAgent(c: Context, session: Session, options: { provider?: string; model?: string } = {}): Agent {
  const scope = c.plugin(() => {})
  const value: Agent = {
    id: session.id,
    options,
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  c.agents.register(value)
  return value
}

describe('memory plugin wiring', () => {
  it('injects the frozen snapshot as one user-role message, never into the system prompt', async () => {
    await seedFile('memory', 'Seeded memory fact')
    await seedFile('user', 'Seeded user fact')
    const c = await mount()
    expect(c.tools.schemas().map(schema => schema.name)).toContain('memory')
    expect((await c.systemPrompt.assemble()).sections.map(section => section.name)).not.toContain('memory:snapshot')
    const session = c.sessions.create(SessionId('user-role-snapshot'))
    await settle()
    const agent = makeAgent(c, session)
    const decision = await agentEvents(c, agent).waterfall(
      'agent/pre-step', { messages: [], turn: 1, step: 1, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    expect(decision).toMatchObject({ kind: 'enter' })
    if (decision.kind !== 'enter') return
    expect(decision.messages).toContainEqual(expect.objectContaining({
      content: [{ type: 'text', text: expect.stringContaining('Seeded memory fact') }],
      source: { kind: 'plugin', plugin: 'memory' },
    }))
    expect(decision.messages).toContainEqual(expect.objectContaining({
      content: [{ type: 'text', text: expect.stringContaining('Seeded user fact') }],
      source: { kind: 'plugin', plugin: 'memory' },
    }))
  })

  it('reinjects memory when compaction shadows its earlier surface node', async () => {
    await seedFile('memory', 'Compaction-safe memory fact')
    const c = await mount()
    const session = c.sessions.create(SessionId('compacted-memory'))
    const agent = makeAgent(c, session)
    const signal = new AbortController().signal
    const initial = await agentEvents(c, agent).waterfall(
      'agent/pre-step', { messages: [], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    expect(initial.kind).toBe('enter')
    if (initial.kind !== 'enter') return
    const original = session.append('user/message', initial.messages[0]!, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compressed context' }], source: { kind: 'plugin', plugin: 'compact' },
    }), { surfaceOp: { op: 'replace', start: original.seq, end: original.seq }, sourceEventSeqs: [original.seq] })
    const afterCompaction = await agentEvents(c, agent).waterfall(
      'agent/pre-step', { messages: [], turn: 2, step: 1, signal },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    expect(afterCompaction).toMatchObject({ kind: 'enter' })
    if (afterCompaction.kind === 'enter') {
      expect(afterCompaction.messages).toContainEqual(expect.objectContaining({
        source: { kind: 'plugin', plugin: 'memory' },
      }))
    }
  })

  it('executes the memory tool through the registry and persists to $DSH_HOME', async () => {
    const c = await mount()
    const r = await callMemory(c, { action: 'add', target: 'memory', content: 'Added through the tool' })
    expect(r).toMatchObject({ success: true, message: 'Entry added.' })
    const onDisk = await readFile(join(home as string, 'memories', 'MEMORY.md'), 'utf8')
    expect(onDisk).toContain('Added through the tool')
  })

  it('keeps the injected snapshot frozen while mid-session writes reach disk', async () => {
    await seedFile('memory', 'Before the session')
    const c = await mount()
    const session = c.sessions.create(SessionId('frozen-user-snapshot'))
    await settle()
    await callMemory(c, { action: 'add', target: 'memory', content: 'Written during the session' })
    const agent = makeAgent(c, session)
    const decision = await agentEvents(c, agent).waterfall(
      'agent/pre-step', { messages: [], turn: 1, step: 1, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    expect(decision).toMatchObject({ kind: 'enter' })
    if (decision.kind !== 'enter') return
    const snapshot = decision.messages.find(message => message.source.kind === 'plugin' && message.source.plugin === 'memory')
    expect(snapshot).toBeDefined()
    expect(snapshot?.content).toContainEqual({ type: 'text', text: expect.stringContaining('Before the session') })
    expect(snapshot?.content).not.toContainEqual({ type: 'text', text: expect.stringContaining('Written during the session') })
    const onDisk = await readFile(join(home as string, 'memories', 'MEMORY.md'), 'utf8')
    expect(onDisk).toContain('Written during the session')
  })

  it('renders nothing for empty stores and removes the tool on disposal', async () => {
    const c = await mount()
    expect((await c.systemPrompt.assemble()).sections.map(section => section.name)).not.toContain('memory:snapshot')
    await memoryFiber!.dispose()
    memoryFiber = undefined
    expect(c.tools.get('memory')).toBeUndefined()
  })

  it('defaults and bounds the config through the schemastery schema', () => {
    const parsed = memory.Config['~standard'].validate({})
    expect('then' in parsed).toBe(false)
    if ('then' in parsed) throw new Error('unexpected async config validation')
    if ('issues' in parsed) throw new Error('unexpected config issues for an empty object')
    expect(parsed.value).toEqual({
      memoryCharLimit: 2200,
      userCharLimit: 1375,
      nudgeInterval: 10,
      reviewMaxIterations: 16,
      reviewEnabled: true,
    })
    for (const bad of [
      { memoryCharLimit: 0 },
      { userCharLimit: 0 },
      { nudgeInterval: -1 },
      { reviewMaxIterations: 0 },
    ]) {
      const rejected = memory.Config['~standard'].validate(bad)
      expect('issues' in rejected && rejected.issues !== undefined).toBe(true)
    }
  })
})

describe('nudge gating', () => {
  it('publishes a full-cycle countdown when a live session is created', async () => {
    const c = await mount({ nudgeInterval: 5 })
    const session = c.sessions.create(SessionId('countdown-seed'))
    await vi.waitFor(async () => {
      await expect(memoryReviewProgress.get(String(session.id))).resolves.toEqual({
        reviewEnabled: true,
        remainingTurns: 5,
      })
    })
  })

  it('seeds the countdown for a session already live when the plugin mounts', async () => {
    const c = new Context()
    ctx = c
    await c.plugin(SessionStore)
    await c.plugin(SystemPrompt)
    await c.plugin(ToolRuntime)
    await c.plugin(AgentRegistry)
    await c.plugin(LlmRuntime)
    const session = c.sessions.create(SessionId('already-live'))
    session.append('turn/start', { turn: 1 })
    appendUserMessage(session, 'in-flight first turn')
    memoryFiber = await c.plugin(memory, { nudgeInterval: 5 } as memory.Config)
    await vi.waitFor(async () => {
      await expect(memoryReviewProgress.get(String(session.id))).resolves.toEqual({
        reviewEnabled: true,
        remainingTurns: 5,
      })
    })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(async () => {
      await expect(memoryReviewProgress.get(String(session.id))).resolves.toEqual({
        reviewEnabled: true,
        remainingTurns: 4,
      })
    })
  })

  it('arms a review on the interval-th user turn and skips non-counting events', async () => {
    const c = await mount({ nudgeInterval: 2 })
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    c.llm.registerAdapter(['mock'], adapter)
    // No pre-existing user message: the first counted turn must come from below.
    const session = c.sessions.create(SessionId('nudge-gate'))
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock-model' }, system: 'You are helpful.' },
      reason: 'initial',
    })

    session.append('turn/start', { turn: 1 })
    appendUserMessage(session, 'first counting turn')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    expect(adapter.requests).toHaveLength(0)

    // A plugin-source message never counts: this turn alone would fire the
    // interval-2 gate if it did.
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'system note' }],
      source: { kind: 'plugin', plugin: 'elsewhere' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await settle()
    expect(adapter.requests).toHaveLength(0)

    session.append('turn/start', { turn: 3 })
    appendUserMessage(session, 'second counting turn fires the gate')
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // The replay reuses the parent's rendered system prompt for cache warmth.
    expect(adapter.requests[0]!.system).toBe('You are helpful.')

    // The pending flag was consumed: a completed turn without a new gate does not spawn.
    session.append('turn/start', { turn: 4 })
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
    await settle()
    expect(adapter.requests).toHaveLength(1)
  })

  it('does not count user turns of delegated sessions', async () => {
    const c = await mount({ nudgeInterval: 1 })
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    c.llm.registerAdapter(['mock'], adapter)
    const session = c.sessions.create(SessionId('delegated'), { meta: { delegationDepth: 1 } })
    session.append('turn/start', { turn: 1 })
    appendUserMessage(session, 'delegated turn')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    expect(adapter.requests).toHaveLength(0)
  })

  it('hydrates the counter from prior turns of a resumed session', async () => {
    const c = await mount({ nudgeInterval: 3 })
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    c.llm.registerAdapter(['mock'], adapter)

    // A historical log with two user turns: at the first live user message
    // the counter hydrates to 2 % 3 = 2, so that same turn fires the gate.
    const seed: SessionEvent[] = []
    for (let turn = 1; turn <= 2; turn += 1) {
      const base = (turn - 1) * 3
      seed.push({ type: 'turn/start', seq: SessionSeq(base), time: turn * 10, data: { turn } })
      seed.push({
        type: 'user/message', seq: SessionSeq(base + 1), time: turn * 10 + 1,
        data: createUserMessage({ content: [{ type: 'text', text: `old ${String(turn)}` }], source: { kind: 'user' } }),
        surfaceOp: 'append',
      })
      seed.push({ type: 'turn/end', seq: SessionSeq(base + 2), time: turn * 10 + 2, data: { turn, reason: { kind: 'completed' } } })
    }
    const session = c.sessions.create(SessionId('resumed'), { seed })
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock-model' } },
      reason: 'initial',
    })
    session.append('turn/start', { turn: 4 })
    appendUserMessage(session, 'first live turn after resume')
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
  })

  it('counts only completed real-user turns after restoring injected messages and a settings override', async () => {
    const c = await mount({ nudgeInterval: 10 })
    let settings = { nudgeInterval: 5, reviewEnabled: true }
    c.provide('settings', { get: (namespace: string) => namespace === 'memory' ? settings : undefined })
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    c.llm.registerAdapter(['mock'], adapter)
    const seed: SessionEvent[] = [
      { type: 'user/message', seq: SessionSeq(0), time: 1, data: createUserMessage({ content: [{ type: 'text', text: 'old real user' }], source: { kind: 'user' } }), surfaceOp: 'append' },
      { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'user/message', seq: SessionSeq(2), time: 3, data: createUserMessage({ content: [{ type: 'text', text: 'injected' }], source: { kind: 'plugin', plugin: 'memory' } }), surfaceOp: 'append' },
      { type: 'user/message', seq: SessionSeq(3), time: 4, data: createUserMessage({ content: [{ type: 'text', text: 'tool context' }], source: { kind: 'tool', callId: ToolCallId('context-call') } }), surfaceOp: 'append' },
    ]
    const session = c.sessions.create(SessionId('restored-settings'), { seed })
    session.append('request/header', { header: { config: { provider: 'mock', model: 'mock-model' } }, reason: 'initial' })
    for (let turn = 2; turn <= 4; turn += 1) {
      session.append('turn/start', { turn })
      appendUserMessage(session, `completed ${String(turn)}`)
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    await settle()
    expect(adapter.requests).toHaveLength(0)
    session.append('turn/start', { turn: 5 })
    appendUserMessage(session, 'fifth completed real-user turn')
    session.append('turn/end', { turn: 5, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    settings = { nudgeInterval: 5, reviewEnabled: true }
  })

  it('does not count interrupted user turns toward the review interval', async () => {
    const c = await mount({ nudgeInterval: 5 })
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    c.llm.registerAdapter(['mock'], adapter)
    const session = c.sessions.create(SessionId('interrupted-turn'))
    session.append('request/header', { header: { config: { provider: 'mock', model: 'mock-model' } }, reason: 'initial' })
    session.append('turn/start', { turn: 1 })
    appendUserMessage(session, 'interrupted user message')
    session.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    for (let turn = 2; turn <= 5; turn += 1) {
      session.append('turn/start', { turn })
      appendUserMessage(session, `completed ${String(turn)}`)
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    await settle()
    expect(adapter.requests).toHaveLength(0)
    session.append('turn/start', { turn: 6 })
    appendUserMessage(session, 'fifth completed user message')
    session.append('turn/end', { turn: 6, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
  })

  it('never arms or counts when the interval is zero', async () => {
    const c = await mount({ nudgeInterval: 0 })
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    c.llm.registerAdapter(['mock'], adapter)
    const session = sessionWithRoute(c, 'interval-zero')
    for (let turn = 1; turn <= 3; turn += 1) {
      session.append('turn/start', { turn })
      appendUserMessage(session, `turn ${String(turn)}`)
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    await settle()
    expect(adapter.requests).toHaveLength(0)
  })

  it('never spawns when reviews are disabled', async () => {
    const c = await mount({ nudgeInterval: 1, reviewEnabled: false })
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    c.llm.registerAdapter(['mock'], adapter)
    const session = sessionWithRoute(c, 'reviews-off')
    session.append('turn/start', { turn: 1 })
    appendUserMessage(session, 'one turn')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    expect(adapter.requests).toHaveLength(0)
  })
})

describe('background review spawning', () => {
  it('persists a review receipt for committed background-review changes', async () => {
    const c = await mount({ nudgeInterval: 1 })
    const adapter = new ScriptedAdapter([
      toolCallResponse('c1', 'memory', { action: 'add', target: 'memory', content: 'Background fact' }),
      textResponse('Nothing to save.'),
    ])
    c.llm.registerAdapter(['mock'], adapter)
    const session = sessionWithRoute(c, 'review-notice')
    session.append('turn/start', { turn: 1 })
    appendUserMessage(session, 'Remember this')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const expected = {
      sessionId: String(session.id),
      saved: 1,
      changes: [{ target: 'memory', action: 'added', content: 'Background fact' }],
      reason: 'finished',
    }
    await vi.waitFor(async () => {
      await expect(memoryReviewNotices.list(String(session.id))).resolves.toHaveLength(1)
    })
    expect((await memoryReviewNotices.list(String(session.id)))[0]).toMatchObject(expected)
    expect(session.snapshotEvents()).not.toContainEqual(expect.objectContaining({ type: 'memory/review-updated' }))
  })

  it('saves entries the forked review writes', async () => {
    const c = await mount({ nudgeInterval: 1 })
    const adapter = new ScriptedAdapter([
      toolCallResponse('c1', 'memory', { action: 'add', target: 'user', content: 'Works night shift' }),
      textResponse('Saved.'),
    ])
    c.llm.registerAdapter(['mock'], adapter)
    const session = sessionWithRoute(c, 'review-spawn')
    session.append('turn/start', { turn: 1 })
    appendUserMessage(session, 'A completed user turn starts the review.')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(async () => {
      const onDisk = await readFile(join(home as string, 'memories', 'USER.md'), 'utf8')
      expect(onDisk).toContain('Works night shift')
    })
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[0]!.system).toBe('You are helpful.')
  })

  it('skips the fork when no route is known', async () => {
    const c = await mount({ nudgeInterval: 1 })
    const adapter = new ScriptedAdapter([textResponse('never used')])
    c.llm.registerAdapter(['mock'], adapter)
    const session = c.sessions.create(SessionId('routeless'))
    appendUserMessage(session, 'no request header here')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    expect(adapter.requests).toHaveLength(0)
  })

  it('falls back to the registered agent route for header-less sessions', async () => {
    const c = await mount({ nudgeInterval: 1 })
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    c.llm.registerAdapter(['mock'], adapter)
    const session = c.sessions.create(SessionId('agent-route'))
    makeAgent(c, session, { provider: 'mock', model: 'agent-model' })
    appendUserMessage(session, 'routed through the agent')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    expect(adapter.requests[0]!.model).toBe('agent-model')
  })

  it('does not spawn while a review fork is already in flight', async () => {
    const c = await mount({ nudgeInterval: 1 })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const adapter = new ScriptedAdapter([
      async () => { await gate; return toolCallResponse('c1', 'memory', { action: 'add', target: 'memory', content: 'from review' }) },
      textResponse('Done.'),
      textResponse('Done again.'),
    ])
    c.llm.registerAdapter(['mock'], adapter)
    const session = sessionWithRoute(c, 'in-flight')
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    // A second gate fires while the first fork still runs: the in-flight
    // guard consumes the armed review without spawning a second fork.
    session.append('turn/start', { turn: 2 })
    appendUserMessage(session, 'second turn')
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await settle()
    expect(adapter.requests).toHaveLength(1)

    release()
    // The first fork finishes; a newly armed gate afterwards spawns again.
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    session.append('turn/start', { turn: 3 })
    appendUserMessage(session, 'third turn')
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(3) })
  })

  it('warns through the logger when the review fork rejects', async () => {
    const c = await mount({ nudgeInterval: 1 })
    const warnings: string[] = []
    c.logger.warn = ((message: string) => void warnings.push(message)) as typeof c.logger.warn
    // An unknown block type never closed makes block assembly throw OUTSIDE
    // the review loop's stream try/catch, rejecting runMemoryReview.
    const adapter = new ScriptedAdapter([[
      { type: 'block-start', index: 0, blockType: 'bogus-block' as never },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]])
    c.llm.registerAdapter(['mock'], adapter)
    const session = sessionWithRoute(c, 'review-reject')
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => {
      expect(warnings.some(warning => warning.includes('background review'))).toBe(true)
    })
  })

  it('aborts an in-flight fork and drops the session state on disposal', async () => {
    const c = await mount({ nudgeInterval: 1 })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const adapter = new ScriptedAdapter([
      async () => { await gate; return textResponse('too late') },
    ])
    c.llm.registerAdapter(['mock'], adapter)

    const session = c.sessions.prepare(SessionId('disposed-session'))
    const detach = c.sessions.enter(session)
    c.sessions.announce(session)
    appendUserMessage(session, 'one turn before disposal')
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock-model' } },
      reason: 'initial',
    })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    detach() // session/disposed aborts the fork and drops its state
    release()
    await settle()
    // The aborted fork saved nothing and consumed exactly its one request.
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.script).toHaveLength(0)
    await expect(readFile(join(home as string, 'memories', 'MEMORY.md'), 'utf8')).rejects.toThrow()
  })

  it('resets the per-turn consolidation budget at turn start', async () => {
    const c = await mount({ memoryCharLimit: 30 })
    const session = c.sessions.create(SessionId('budget-reset'))
    // 35 chars exceeds the 30-char limit, so every add fails consolidation.
    const overflow = { action: 'add', target: 'memory', content: 'w'.repeat(35) }

    session.append('turn/start', { turn: 1 })
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const r = await callMemory(c, overflow)
      expect(r.done).toBeUndefined()
      expect(r.error).toContain('Consolidate now')
    }
    const terminal = await callMemory(c, overflow)
    expect(terminal).toMatchObject({ success: false, done: true })
    expect(String(terminal.error)).toContain('failed 4 times')

    // A new turn starts clean: failures 1-3 pass through with guidance again.
    session.append('turn/start', { turn: 2 })
    const afterReset = await callMemory(c, overflow)
    expect(afterReset.done).toBeUndefined()
    expect(afterReset.error).toContain('Consolidate now')
  })
})
