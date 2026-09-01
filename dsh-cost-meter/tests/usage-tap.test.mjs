import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyWireUsage,
  attachReasoningToChunk,
  installUsageTap,
  reasoningFromWireUsage,
  scanSseBuffer,
  shouldTapRequest,
  tapFetchResponse,
  wrapPrepareCall,
} from '../lib/index.js'

const wanzhaoUsage = {
  prompt_tokens: 642,
  completion_tokens: 1,
  total_tokens: 1022,
  prompt_tokens_details: { cached_tokens: 512 },
  completion_tokens_details: { reasoning_tokens: 379 },
}

test('reads disjoint reasoning_tokens from Wanzhao-style usage', () => {
  assert.equal(reasoningFromWireUsage(wanzhaoUsage), 379)
  assert.equal(reasoningFromWireUsage({ output_tokens_details: { reasoning_tokens: 12 } }), 12)
  assert.equal(reasoningFromWireUsage({ completion_tokens: 26, completion_tokens_details: { reasoning_tokens: 0 } }), 0)
  assert.equal(reasoningFromWireUsage(undefined), 0)
})

test('scans SSE usage frames and ignores partial JSON', () => {
  const slot = {}
  scanSseBuffer('data: {"id":"x","choices":[]}\n', slot)
  assert.equal(slot.reasoningTokens, undefined)
  scanSseBuffer(`data: {"usage":${JSON.stringify(wanzhaoUsage)}}\n`, slot)
  assert.equal(slot.reasoningTokens, 379)
  const partial = {}
  scanSseBuffer('data: {"usage":{"completion_tokens_details":{"reasoning_tokens":', partial)
  assert.equal(partial.reasoningTokens, undefined)
})

test('attaches reasoning onto a harness usage chunk once', () => {
  const chunk = { type: 'usage', usage: { inputTokens: 130, outputTokens: 1, cacheReadTokens: 512 } }
  assert.deepEqual(attachReasoningToChunk(chunk, 379).usage, {
    inputTokens: 130, outputTokens: 1, cacheReadTokens: 512, reasoningTokens: 379,
  })
  assert.equal(attachReasoningToChunk({ type: 'text-delta', text: 'x' }, 379).type, 'text-delta')
  const already = { type: 'usage', usage: { outputTokens: 1, reasoningTokens: 10 } }
  assert.equal(attachReasoningToChunk(already, 379).usage.reasoningTokens, 10)
})

test('taps only completion and responses URLs', () => {
  assert.equal(shouldTapRequest('https://sub.wanzhao.top/v1/chat/completions'), true)
  assert.equal(shouldTapRequest(new URL('https://sub.wanzhao.top/v1/responses')), true)
  assert.equal(shouldTapRequest('https://sub.wanzhao.top/v1/models'), false)
})

test('tapFetchResponse keeps body bytes and captures reasoning before they are read', async () => {
  const frame = `data: ${JSON.stringify({ usage: wanzhaoUsage })}\n\n`
  const bytes = new TextEncoder().encode(frame)
  const slot = {}
  applyWireUsage(slot, undefined)
  const tapped = tapFetchResponse(new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }), slot)
  const received = new Uint8Array(await tapped.arrayBuffer())
  assert.deepEqual([...received], [...bytes])
  assert.equal(slot.reasoningTokens, 379)
})

test('wrapPrepareCall taps the one-shot stream the agent loop iterates', async () => {
  const slots = []
  const wrapped = wrapPrepareCall(async () => ({
    extra: true,
    stream: async function* () {
      const store = slots.at(-1)
      assert.ok(store)
      store.reasoningTokens = 379
      yield { type: 'usage', usage: { inputTokens: 130, outputTokens: 1 } }
    },
  }), slots)
  const prepared = await wrapped({})
  assert.equal(prepared.extra, true)
  const chunks = []
  for await (const chunk of prepared.stream({})) chunks.push(chunk)
  assert.equal(chunks[0].usage.reasoningTokens, 379)
  assert.equal(slots.length, 0)
})

test('installUsageTap wraps prepareCall as well as stream', () => {
  const llm = {
    stream: async function* () { yield { type: 'usage', usage: { outputTokens: 1 } } },
    prepareCall: async () => ({
      stream: async function* () { yield { type: 'usage', usage: { outputTokens: 1 } } },
    }),
  }
  const originalStream = llm.stream
  const originalPrepare = llm.prepareCall
  const restore = installUsageTap({ inject(_deps, callback) { callback({ llm }) } })
  assert.notEqual(llm.stream, originalStream)
  assert.notEqual(llm.prepareCall, originalPrepare)
  restore()
  assert.equal(llm.stream, originalStream)
  assert.equal(llm.prepareCall, originalPrepare)
})

test('preparedCall.stream copies wire reasoning onto the usage chunk', async () => {
  const frame = `data: ${JSON.stringify({ usage: wanzhaoUsage })}\n\n`
  const bytes = new TextEncoder().encode(frame)
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
  const llm = {
    stream: async function* () { yield { type: 'usage', usage: { outputTokens: 0 } } },
    prepareCall: async () => ({
      stream: async function* () {
        const response = await fetch('https://sub.wanzhao.top/v1/chat/completions')
        await response.arrayBuffer()
        yield { type: 'usage', usage: { inputTokens: 130, outputTokens: 1 } }
      },
    }),
  }
  const restore = installUsageTap({ inject(_deps, callback) { callback({ llm }) } })
  try {
    const prepared = await llm.prepareCall({})
    const chunks = []
    for await (const chunk of prepared.stream({})) chunks.push(chunk)
    assert.equal(chunks[0].usage.reasoningTokens, 379)
  } finally {
    restore()
    globalThis.fetch = previousFetch
  }
})
