import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  CallId,
  LlmAdapter,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { MemoryStore } from '../src/store.ts'
import { MEMORY_REVIEW_PROMPT, runMemoryReview } from '../src/review.ts'

/** A finish chunk that terminates the stream with the given terminal reason. */
function finishResponse(kind: 'aborted' | 'error'): StreamChunk[] {
  return [{ type: 'finish', reason: { kind, failure: { message: 'provider said no', code: 'PROVIDER_ERROR' } } }]
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
  const callId = CallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

let dir: string | undefined
let ctx: Context | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-memory-review-'))
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

async function freshStore(): Promise<MemoryStore> {
  const s = new MemoryStore({ dir: dir as string, memoryCharLimit: 2200, userCharLimit: 1375 })
  await s.loadFromDisk()
  return s
}

/** Minimal scripted adapter: each entry is consumed by one stream call. */
class ScriptedAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]))[]) {
    super()
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Snapshot the message list: the review loop appends to its long-lived
    // request array between iterations, so a recorded reference would show
    // later iterations' appends instead of what this request actually sent.
    this.requests.push({
      ...options,
      messages: options.messages.map(message => ({ ...message, content: [...message.content] })),
    })
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

/** A session with one user turn and a request header pinning the route. */
function session(): Session {
  const s = Session.create(SessionId('review-session'))
  s.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'I work the night shift.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  s.append('request/header', {
    header: { config: { provider: 'mock', model: 'mock-model' }, system: 'You are helpful.' },
    reason: 'initial',
  })
  return s
}

async function setup(adapter: LlmAdapter): Promise<Context> {
  const c = new Context()
  ctx = c
  await c.plugin(LlmRuntime)
  c.llm.registerAdapter(['mock'], adapter)
  return c
}

describe('runMemoryReview', () => {
  it('saves entries the model adds and reports the outcome', async () => {
    const store = await freshStore()
    const c = await setup(new ScriptedAdapter([
      toolCallResponse('c1', 'memory', { action: 'add', target: 'user', content: 'Works night shift' }),
      textResponse('Nothing to save.'),
    ]))
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(outcome).toMatchObject({
      iterations: 2,
      saved: 1,
      changes: [{ target: 'user', action: 'added', content: 'Works night shift' }],
      reason: 'finished',
    })
    expect(store.entriesWithMeta('user').map(entry => entry.content)).toEqual(['Works night shift'])
  })

  it('reports committed final deltas instead of duplicate model proposals', async () => {
    const store = await freshStore()
    const c = await setup(new ScriptedAdapter([
      toolCallResponse('c1', 'memory', { action: 'add', target: 'memory', content: 'Old convention' }),
      toolCallResponse('c2', 'memory', { action: 'operations', target: 'memory', operations: [
        { action: 'replace', old_text: 'Old convention', content: 'Compact convention' },
        { action: 'add', content: 'Compact convention' },
      ] }),
      textResponse('Nothing to save.'),
    ]))
    const outcome = await runMemoryReview(c, {
      session: session(), store, route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16, signal: new AbortController().signal,
    })
    expect(outcome.changes).toEqual([
      { target: 'memory', action: 'added', content: 'Old convention' },
      { target: 'memory', action: 'removed', content: 'Old convention' },
      { target: 'memory', action: 'added', content: 'Compact convention' },
    ])
    expect(store.entriesWithMeta('memory').map(entry => entry.content)).toEqual(['Compact convention'])
  })

  it('replays the parent system prompt and history before the directive', async () => {
    const store = await freshStore()
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    const c = await setup(adapter)
    await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    const request = adapter.requests[0]!
    expect(request.system).toBe('You are helpful.')
    expect(request.sessionId).toBe(SessionId('review-session'))
    expect(request.tools).toEqual([expect.objectContaining({ name: 'memory' })])
    // History first, the review directive last.
    const lastMessage = request.messages.at(-1)!
    expect(lastMessage.content.some(block => block.type === 'text' && block.text === MEMORY_REVIEW_PROMPT)).toBe(true)
    expect(request.messages.some(message => message.content.some(block =>
      block.type === 'text' && block.text === 'I work the night shift.'))).toBe(true)
  })

  it('denies non-whitelisted tool calls at runtime', async () => {
    const store = await freshStore()
    const c = await setup(new ScriptedAdapter([
      toolCallResponse('c1', 'bash', { command: 'ls' }),
      textResponse('Nothing to save.'),
    ]))
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(outcome).toMatchObject({ saved: 0, reason: 'finished' })
  })

  it('rejects malformed tool arguments without crashing the loop', async () => {
    const store = await freshStore()
    const c = await setup(new ScriptedAdapter([
      toolCallResponse('c1', 'memory', { action: 'add' }), // missing content+target
      textResponse('Nothing to save.'),
    ]))
    // The memory tool validates arguments itself and returns an error result;
    // the review loop must complete rather than throw.
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(outcome.reason).toBe('finished')
  })

  it('stops at max iterations when the model keeps calling tools', async () => {
    const store = await freshStore()
    const loopCall = toolCallResponse('c1', 'memory', { action: 'add', target: 'memory', content: 'fact' })
    const c = await setup(new ScriptedAdapter([
      () => loopCall,
      () => loopCall,
      () => loopCall,
    ]))
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 3,
      signal: new AbortController().signal,
    })
    expect(outcome.reason).toBe('max-iterations')
    expect(outcome.iterations).toBe(3)
  })

  it('honors a pre-aborted signal', async () => {
    const store = await freshStore()
    const adapter = new ScriptedAdapter([])
    const c = await setup(adapter)
    const aborter = new AbortController()
    aborter.abort()
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: aborter.signal,
    })
    expect(outcome).toMatchObject({ iterations: 0, saved: 0, reason: 'aborted' })
    expect(adapter.requests).toHaveLength(0)
  })

  it('degrades to failed when the stream throws', async () => {
    const store = await freshStore()
    const c = await setup(new ScriptedAdapter([])) // exhausted -> throws
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(outcome).toMatchObject({ iterations: 1, reason: 'failed' })
  })

  it('degrades to failed when the stream waterfall rejects before dispatch', async () => {
    const store = await freshStore()
    const c = await setup(new ScriptedAdapter([textResponse('Nothing to save.')]))
    // A throwing `llm/stream` listener makes the waterfall reject — the one
    // failure class the adapter boundary does NOT convert into a finish chunk.
    c.on('llm/stream', (_options, _next) => {
      throw new Error('middleware refused the call')
    })
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(outcome).toMatchObject({ iterations: 1, saved: 0, reason: 'failed' })
  })

  it('omits the system field when the session never sent a request header', async () => {
    const store = await freshStore()
    const adapter = new ScriptedAdapter([textResponse('Nothing to save.')])
    const c = await setup(adapter)
    const bare = Session.create(SessionId('no-header'))
    bare.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await runMemoryReview(c, {
      session: bare,
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(adapter.requests[0]!.system).toBeUndefined()
  })

  it('degrades to aborted when the provider finish chunk reports aborted', async () => {
    const store = await freshStore()
    const c = await setup(new ScriptedAdapter([finishResponse('aborted')]))
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(outcome).toMatchObject({ iterations: 1, saved: 0, reason: 'aborted' })
  })

  it('degrades to failed when the provider finish chunk reports an error', async () => {
    const store = await freshStore()
    const c = await setup(new ScriptedAdapter([finishResponse('error')]))
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(outcome).toMatchObject({ iterations: 1, saved: 0, reason: 'failed' })
  })

  it('feeds unparseable and non-object tool arguments back as error results', async () => {
    const store = await freshStore()
    // The argument strings are crafted raw so one fails JSON.parse and the
    // other parses to a non-object.
    const rawJson = (raw: string): StreamChunk[] => {
      const callId = CallId('c1')
      return [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'memory', arguments: raw } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ]
    }
    const adapter = new ScriptedAdapter([
      rawJson('{not-json'),
      rawJson('[1,2,3]'),
      textResponse('Nothing to save.'),
    ])
    const c = await setup(adapter)
    const outcome = await runMemoryReview(c, {
      session: session(),
      store,
      route: { provider: 'mock', model: 'mock-model' },
      maxIterations: 16,
      signal: new AbortController().signal,
    })
    expect(outcome.reason).toBe('finished')
    // Both bad calls became error tool-result messages in the replay.
    const second = adapter.requests[1]!
    expect(second.messages.some(m => m.content.some(b =>
      b.type === 'tool-result' && b.content.some(inner => inner.type === 'text' && inner.text === 'Invalid tool arguments: not valid JSON.')))).toBe(true)
    const third = adapter.requests[2]!
    expect(third.messages.some(m => m.content.some(b =>
      b.type === 'tool-result' && b.content.some(inner => inner.type === 'text' && inner.text === 'Invalid tool arguments: expected an object.')))).toBe(true)
    expect(store.entriesFor('memory')).toHaveLength(0)
  })
})
