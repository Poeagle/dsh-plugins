/** Capture gateway `reasoning_tokens` without rewriting the upstream body. */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface UsageTapSlot {
  reasoningTokens?: number
}

interface LlmStreamFace {
  stream(options: unknown): AsyncIterable<unknown>
}

/**
 * Read `reasoning_tokens` from an OpenAI-compat usage object.
 * Wanzhao grok keeps this disjoint from `completion_tokens`.
 * @param usage Wire `usage` object, or undefined when the chunk has none.
 * @returns A positive reasoning count, or 0 when the field is absent.
 */
export function reasoningFromWireUsage(usage: unknown): number {
  if (usage === null || typeof usage !== 'object') return 0
  const raw = usage as Record<string, unknown>
  const completionDetails = object(raw.completion_tokens_details)
  const outputDetails = object(raw.output_tokens_details)
  for (const value of [raw.reasoning_tokens, completionDetails.reasoning_tokens, outputDetails.reasoning_tokens]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return 0
}

/**
 * Record reasoning from one wire usage object onto the in-flight tap slot.
 * @param slot Request-local slot created around one `llm.stream` call.
 * @param usage Wire `usage` object.
 */
export function applyWireUsage(slot: UsageTapSlot, usage: unknown): void {
  const reasoning = reasoningFromWireUsage(usage)
  if (reasoning > 0) slot.reasoningTokens = reasoning
}

/**
 * Scan an SSE buffer for `data:` frames that carry `usage`.
 * Incomplete trailing JSON is ignored until more bytes arrive.
 * @param buffer Decoded SSE text received so far.
 * @param slot Request-local slot to update.
 */
export function scanSseBuffer(buffer: string, slot: UsageTapSlot): void {
  for (const line of buffer.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (data === '' || data === '[DONE]') continue
    try {
      const payload = JSON.parse(data) as { usage?: unknown }
      if (payload.usage !== undefined) applyWireUsage(slot, payload.usage)
    } catch {
      // A partial `data:` frame is expected while the body is still arriving.
    }
  }
}

/**
 * Attach captured reasoning onto a harness usage chunk if the adapter omitted it.
 * @param chunk One value yielded by `llm.stream`.
 * @param reasoningTokens Captured gateway reasoning count.
 * @returns The original chunk, or a shallow copy with `usage.reasoningTokens`.
 */
export function attachReasoningToChunk(chunk: unknown, reasoningTokens: number | undefined): unknown {
  if (reasoningTokens === undefined || reasoningTokens <= 0) return chunk
  if (chunk === null || typeof chunk !== 'object') return chunk
  const typed = chunk as { type?: unknown; usage?: unknown }
  if (typed.type !== 'usage' || typed.usage === null || typeof typed.usage !== 'object') return chunk
  const usage = typed.usage as Record<string, unknown>
  if (typeof usage.reasoningTokens === 'number' && usage.reasoningTokens > 0) return chunk
  return { ...typed, usage: { ...usage, reasoningTokens } }
}

/**
 * @param input `fetch` input (URL string, URL, or Request).
 * @returns Whether this request is an OpenAI-compat completion/response call.
 */
export function shouldTapRequest(input: unknown): boolean {
  const url = requestUrl(input)
  return url.includes('/chat/completions') || url.includes('/responses')
}

/**
 * Pass upstream bytes through unchanged while parsing usage on the same chunks.
 * Reasoning is written to `slot` before the official client sees those bytes.
 * @param response Upstream `fetch` response. The body is consumed via a wrapper.
 * @param slot Request-local slot to update.
 * @returns A response with identical status, headers, and body bytes.
 */
export function tapFetchResponse(response: Response, slot: UsageTapSlot): Response {
  if (response.body === null) return response
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        ingestBuffer(buffer, slot)
        controller.close()
        return
      }
      buffer += decoder.decode(value, { stream: true })
      ingestBuffer(buffer, slot)
      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * Wrap `globalThis.fetch` so in-flight `llm.stream` calls can see gateway usage.
 * Responses outside an active tap slot, or to other URLs, pass through untouched.
 * @param slot AsyncLocalStorage holding the current stream's usage slot.
 * @returns Disposer that restores the previous `fetch`.
 */
export function installFetchTap(slot: AsyncLocalStorage<UsageTapSlot>): () => void {
  const original = globalThis.fetch
  if (typeof original !== 'function') return () => {}
  const tapped: typeof fetch = async (input, init) => {
    const response = await original(input, init)
    const store = slot.getStore()
    if (store === undefined || !shouldTapRequest(input)) return response
    return tapFetchResponse(response, store)
  }
  globalThis.fetch = tapped
  return () => {
    if (globalThis.fetch === tapped) globalThis.fetch = original
  }
}

/**
 * Wrap `llm.stream` so each call has a tap slot and usage chunks carry reasoning.
 * @param stream Original `llm.stream` bound to the service.
 * @param slot AsyncLocalStorage used by the fetch tap.
 * @returns A replacement `stream` with the same call signature.
 */
export function wrapLlmStream(
  stream: LlmStreamFace['stream'],
  slot: AsyncLocalStorage<UsageTapSlot>,
): LlmStreamFace['stream'] {
  return (options: unknown) => {
    const store: UsageTapSlot = {}
    const inner = slot.run(store, () => stream(options))
    return {
      [Symbol.asyncIterator]() {
        const iterator = inner[Symbol.asyncIterator]()
        return {
          next: () => slot.run(store, async () => {
            const result = await iterator.next()
            if (result.done) return result
            return { done: false, value: attachReasoningToChunk(result.value, store.reasoningTokens) }
          }),
          return: (value?: unknown) => iterator.return?.(value) ?? Promise.resolve({ done: true as const, value }),
          throw: (error?: unknown) => iterator.throw?.(error) ?? Promise.reject(error),
        }
      },
    }
  }
}

/**
 * Install the fetch tap and wrap `ctx.llm.stream` when the LLM service is present.
 * @param ctx Host context. `llm` is optional so tests without it still load.
 * @returns Disposer that unwraps fetch and `llm.stream`.
 */
export function installUsageTap(ctx: { inject: (deps: string[], callback: (inner: { llm?: LlmStreamFace }) => void) => unknown }): () => void {
  const slot = new AsyncLocalStorage<UsageTapSlot>()
  const restoreFetch = installFetchTap(slot)
  let restoreStream = () => {}
  ctx.inject(['llm'], inner => {
    const llm = inner.llm
    if (llm === undefined || typeof llm.stream !== 'function') return
    const original = llm.stream.bind(llm)
    llm.stream = wrapLlmStream(original, slot)
    restoreStream = () => {
      llm.stream = original
    }
  })
  return () => {
    restoreStream()
    restoreFetch()
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input !== null && typeof input === 'object' && 'url' in input) return String((input as { url: unknown }).url)
  return ''
}

function ingestBuffer(buffer: string, slot: UsageTapSlot): void {
  scanSseBuffer(buffer, slot)
  const trimmed = buffer.trim()
  if (!trimmed.startsWith('{')) return
  try {
    applyWireUsage(slot, (JSON.parse(trimmed) as { usage?: unknown }).usage)
  } catch {
    // A partial JSON body is expected while the response is still arriving.
  }
}
