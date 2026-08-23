/**
 * Post-turn background memory review — the DSH port of the upstream review
 * fork. After a completed turn, a best-effort auxiliary conversation replays
 * the session history under a review prompt with ONLY the memory tool
 * available and lets the model decide whether anything deserves a durable
 * entry. The fork stays off-session (no log entries, no projection updates)
 * — it mirrors the upstream persistence-disabled fork agent and exists only
 * to mutate the shared file-backed store.
 * @module dsh-memory/review
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  BlockAssembler,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { CallId, ContentBlock, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { MEMORY_TOOL_DESCRIPTION, MEMORY_TOOL_PARAMETERS, dispatchMemoryTool, toMemoryToolArgs } from './schema.ts'
import type { MemoryStore } from './store.ts'
import type { MemoryReviewChange } from './types.ts'

/** The review directive appended after the replayed conversation. */
export const MEMORY_REVIEW_PROMPT =
  'Review the conversation above and consider saving a durable fact if appropriate.\n\n'
  + 'Classify every candidate before writing it:\n'
  + '1. Use target="user" ONLY for stable facts about the person: name, location, age, '
  + 'identity, education, employer, role, personal preferences, or communication style.\n'
  + '2. Use target="memory" for project and environment facts: repositories, code conventions, '
  + 'product details, workflows, tool behavior, technical rules, and instructions about how the '
  + 'project should be operated.\n'
  + '3. Project/API debugging facts and implementation requirements MUST use target="memory"; '
  + 'they do not belong in USER.md. Personal profile facts MUST use target="user".\n\n'
  + 'Before every write, inspect the current entries and consolidate them: do not add a fact that is duplicated, '
  + 'semantically overlapping, or better represented by replacing, merging, shortening, or removing existing entries. '
  + 'Keep only stable, reusable facts and conventions; remove obsolete, redundant, and timeline-style details when a '
  + 'single compact entry preserves the useful fact. If nothing is worth saving after this review, just say \'Nothing to save.\' and stop.\n\n'
  + 'You can only call the memory tool. Other tools will be denied at runtime — '
  + 'do not attempt them.'

/** Outcome of one completed review run. */
export interface ReviewOutcome {
  /** Model steps taken (requests sent). */
  readonly iterations: number
  /** Count of memory tool calls that committed at least one store change. */
  readonly saved: number
  /** Entry-level changes observed after each committed write. */
  readonly changes: readonly MemoryReviewChange[]
  /** Why the loop stopped. */
  readonly reason: 'finished' | 'max-iterations' | 'aborted' | 'failed'
}

/** One review fork's resolved request route. */
interface ReviewRoute {
  readonly provider: string
  readonly model: string
}

/**
 * Build the memory-only tool schema the review request offers. Sharing the
 * parameter spec with the registry registration keeps the fork and the live
 * tool in lockstep.
 * @returns the tool schema.
 */
function memoryToolSchema(): ToolSchema {
  return {
    name: 'memory',
    description: MEMORY_TOOL_DESCRIPTION,
    // Spread into a fresh object type so the compiled schema satisfies the
    // transport's open `Record<string, unknown>` slot.
    parameters: { ...parameterSchemaSpecToJsonSchema(MEMORY_TOOL_PARAMETERS) },
  }
}

/**
 * Run one background memory review against the shared store. The session's
 * derived history replays verbatim under the parent's rendered system prompt
 * (same model, same prefix, so the provider's warm cache reads), followed by
 * the review directive; each assistant tool call dispatches directly against
 * the store without touching the session log.
 * @param ctx - context carrying the `llm` runtime.
 * @param options - the session under review, its shared store, the resolved
 * route, the iteration cap, and the cancellation signal.
 * @returns the run outcome; failures degrade to a failed outcome rather than
 * throwing (review is best-effort).
 */
export async function runMemoryReview(
  ctx: Context,
  options: {
    readonly session: Session
    readonly store: MemoryStore
    readonly route: ReviewRoute
    readonly maxIterations: number
    readonly signal: AbortSignal
  },
): Promise<ReviewOutcome> {
  const { session, store, route, maxIterations, signal } = options
  // Reuse the parent's rendered system prompt when present: the fork targets
  // the same model, so the byte-exact prefix keeps the request cache warm.
  const system = session.requestHeader()?.system
  const messages: Message[] = [
    ...session.deriveMessages(),
    createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-memory' },
      content: [{ type: 'text', text: MEMORY_REVIEW_PROMPT }],
    }),
  ]
  const tools = [memoryToolSchema()]

  let saved = 0
  const changes: MemoryReviewChange[] = []
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (signal.aborted) return { iterations: iteration - 1, saved, changes, reason: 'aborted' }
    const assembler = new BlockAssembler()
    try {
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        messages,
        ...(system === undefined ? {} : { system }),
        tools,
        signal,
        sessionId: session.id,
      })) {
        assembler.push(chunk)
      }
    } catch {
      // Stream construction or iteration failure: review degrades silently.
      return { iterations: iteration, saved, changes, reason: 'failed' }
    }
    const finish = assembler.finish
    if (finish.kind === 'aborted' || finish.kind === 'error') {
      return { iterations: iteration, saved, changes, reason: finish.kind === 'aborted' ? 'aborted' : 'failed' }
    }
    const blocks = assembler.blocks()
    messages.push(createAssistantMessage({
      content: blocks,
      source: { provider: route.provider, model: route.model, replayState: assembler.replayState },
    }))
    const toolCalls = blocks.filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
    if (finish.kind !== 'tool-calls' || toolCalls.length === 0) {
      return { iterations: iteration, saved, changes, reason: 'finished' }
    }
    for (const call of toolCalls) {
      const result = await executeReviewToolCall(store, call.id, call.name, call.arguments)
      if (result.saved) {
        saved += 1
        changes.push(...result.changes)
      }
      messages.push(createToolResultMessage({
        callId: call.id,
        content: [{ type: 'text', text: result.text }],
        isError: result.isError,
      }))
    }
  }
  return { iterations: maxIterations, saved, changes, reason: 'max-iterations' }
}

/** One executed tool call's model-facing outcome. */
interface ReviewToolOutcome {
  readonly text: string
  readonly isError: boolean
  /** Whether this call landed at least one successful write. */
  readonly saved: boolean
  /** Committed entry-level delta for the write, never model-proposed arguments. */
  readonly changes: readonly MemoryReviewChange[]
}

/**
 * Execute one review tool call directly against the shared store. The fork
 * offers only the memory tool, but a model may still produce another name —
 * such calls are denied at runtime exactly like the upstream whitelist.
 * @param store - the session's shared store.
 * @param callId - the provider call id (only correlation identity here).
 * @param name - the tool the model named.
 * @param rawArguments - the raw argument JSON string.
 * @returns the serialized result.
 */
async function executeReviewToolCall(
  store: MemoryStore,
  callId: CallId,
  name: string,
  rawArguments: string,
): Promise<ReviewToolOutcome> {
  void callId // correlation only — results ride the messages list.
  if (name !== 'memory') {
    return {
      text: `Background review denied non-whitelisted tool: ${name}. Only memory tools are allowed.`,
      isError: true,
      saved: false,
      changes: [],
    }
  }
  let args: unknown
  try {
    args = JSON.parse(rawArguments) as unknown
  } catch {
    return { text: 'Invalid tool arguments: not valid JSON.', isError: true, saved: false, changes: [] }
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { text: 'Invalid tool arguments: expected an object.', isError: true, saved: false, changes: [] }
  }
  const parsed = toMemoryToolArgs(args as Record<string, unknown>)
  const before = [...store.entriesFor(parsed.target)]
  const result = await dispatchMemoryTool(store, parsed)
  const after = store.entriesFor(parsed.target)
  const changes = result.success ? committedChanges(parsed.target, before, after) : []
  return { text: JSON.stringify(result), isError: !result.success, saved: changes.length > 0, changes }
}

/** Internal timestamps distinguish revisions but never belong in user-visible receipts. */
const TIMESTAMP_PREFIX = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]\s*/

/** Compare two committed store states without exposing model-proposed arguments. */
function committedChanges(
  target: MemoryReviewChange['target'],
  before: readonly string[],
  after: readonly string[],
): MemoryReviewChange[] {
  const beforeByContent = new Map(before.map(entry => [stripTimestamp(entry), entry]))
  const afterByContent = new Map(after.map(entry => [stripTimestamp(entry), entry]))
  return [
    ...[...beforeByContent.keys()].filter(content => !afterByContent.has(content)).map(content => ({ target, action: 'removed' as const, content })),
    ...[...afterByContent.keys()].filter(content => !beforeByContent.has(content)).map(content => ({ target, action: 'added' as const, content })),
  ]
}

/** Remove store-private timestamp metadata from a committed entry receipt. */
function stripTimestamp(entry: string): string {
  return entry.replace(TIMESTAMP_PREFIX, '')
}
