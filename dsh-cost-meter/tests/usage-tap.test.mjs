import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyWireUsage,
  attachReasoningToChunk,
  reasoningFromWireUsage,
  scanSseBuffer,
  shouldTapRequest,
  tapFetchResponse,
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
