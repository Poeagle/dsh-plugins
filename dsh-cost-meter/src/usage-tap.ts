/** Capture gateway `reasoning_tokens` without rewriting the upstream body. */

export interface UsageTapSlot {
  reasoningTokens?: number
}

interface LlmStreamFace {
  stream(options: unknown): AsyncIterable<unknown>
}

interface PreparedLlmCallFace {
  stream: (options: unknown) => AsyncIterable<unknown>
  [key: string]: unknown
}

interface LlmServiceFace extends LlmStreamFace {
  prepareCall?(config: unknown, signal?: unknown): Promise<PreparedLlmCallFace>
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
 * @param slots Active stream slots. Async generators drop AsyncLocalStorage
 *   across `await`, so the fetch tap reads this stack, not ALS alone.
 * @returns Disposer that restores the previous `fetch`.
 */
export function installFetchTap(slots: UsageTapSlot[]): () => void {
  const original = globalThis.fetch
  if (typeof original !== 'function') return () => {}
  const tapped: typeof fetch = async (input, init) => {
    const response = await original(input, init)
    const store = slots.at(-1)
    if (store === undefined || !shouldTapRequest(input)) return response
    return tapFetchResponse(response, store)
  }
  globalThis.fetch = tapped
  return () => {
    if (globalThis.fetch === tapped) globalThis.fetch = original
  }
}

function popSlot(slots: UsageTapSlot[], store: UsageTapSlot): void {
  const index = slots.lastIndexOf(store)
  if (index >= 0) slots.splice(index, 1)
}

/**
 * Wrap `llm.stream` so each call has a tap slot and usage chunks carry reasoning.
 * The slot stays on the stack until the iterator settles so `fetch` inside an
 * async generator still sees it. AsyncLocalStorage does not survive that hop.
 * @param stream Original `llm.stream` bound to the service.
 * @param slots Active stream slots read by the fetch tap.
 * @returns A replacement `stream` with the same call signature.
 */
export function wrapLlmStream(
  stream: LlmStreamFace['stream'],
  slots: UsageTapSlot[],
): LlmStreamFace['stream'] {
  return (options: unknown) => {
    const store: UsageTapSlot = {}
    slots.push(store)
    let released = false
    const release = () => {
      if (released) return
      released = true
      popSlot(slots, store)
    }
    let inner: AsyncIterable<unknown>
    try {
      inner = stream(options)
    } catch (error) {
      release()
      throw error
    }
    return {
      [Symbol.asyncIterator]() {
        const iterator = inner[Symbol.asyncIterator]()
        return {
          next: async () => {
            try {
              const result = await iterator.next()
              if (result.done) {
                release()
                return result
              }
              return { done: false, value: attachReasoningToChunk(result.value, store.reasoningTokens) }
            } catch (error) {
              release()
              throw error
            }
          },
          return: async (value?: unknown) => {
            try {
              return await (iterator.return?.(value) ?? Promise.resolve({ done: true as const, value }))
            } finally {
              release()
            }
          },
          throw: async (error?: unknown) => {
            try {
              return await (iterator.throw?.(error) ?? Promise.reject(error))
            } finally {
              release()
            }
          },
        }
      },
    }
  }
}

/**
 * Wrap `llm.prepareCall` so the one-shot stream the agent loop actually
 * iterates also carries the fetch-tap slot. `preparedCall.stream` bypasses
 * `llm.stream`; wrapping only the latter leaves grok reasoning off the log.
 * @param prepareCall Original `llm.prepareCall` bound to the service.
 * @param slots Active stream slots read by the fetch tap.
 * @returns A replacement `prepareCall` that taps the returned stream.
 */
export function wrapPrepareCall(
  prepareCall: NonNullable<LlmServiceFace['prepareCall']>,
  slots: UsageTapSlot[],
): NonNullable<LlmServiceFace['prepareCall']> {
  return async (config, signal) => {
    const prepared = await prepareCall(config, signal)
    if (prepared === null || typeof prepared !== 'object' || typeof prepared.stream !== 'function') {
      return prepared
    }
    return { ...prepared, stream: wrapLlmStream(prepared.stream.bind(prepared), slots) }
  }
}

/**
 * Install the fetch tap and wrap `ctx.llm.stream` plus `ctx.llm.prepareCall`.
 * The agent loop dispatches through `preparedCall.stream`; title and
 * compaction still use `llm.stream`. Both must enter the same tap slot.
 * @param ctx Host context. `llm` is optional so tests without it still load.
 * @returns Disposer that unwraps fetch, `llm.stream`, and `llm.prepareCall`.
 */
export function installUsageTap(ctx: { inject: (deps: string[], callback: (inner: { llm?: LlmServiceFace }) => void) => unknown }): () => void {
  const slots: UsageTapSlot[] = []
  const restoreFetch = installFetchTap(slots)
  let restoreLlm = () => {}
  ctx.inject(['llm'], inner => {
    const llm = inner.llm
    if (llm === undefined) return
    const restorers: Array<() => void> = []
    if (typeof llm.stream === 'function') {
      const original = llm.stream
      llm.stream = wrapLlmStream(original.bind(llm), slots)
      restorers.push(() => {
        llm.stream = original
      })
    }
    if (typeof llm.prepareCall === 'function') {
      const original = llm.prepareCall
      llm.prepareCall = wrapPrepareCall(original.bind(llm), slots)
      restorers.push(() => {
        llm.prepareCall = original
      })
    }
    restoreLlm = () => {
      for (const restore of restorers) restore()
    }
  })
  return () => {
    restoreLlm()
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
