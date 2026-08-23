/**
 * The `memory` tool's model-facing schema and dispatch: parameter
 * declaration shared between the registry registration and the background
 * review fork's request schema, plus the single-op / batch dispatch that
 * mirrors the upstream handler.
 * @module dsh-memory/schema
 */

import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { MemoryOperation, MemoryTarget, MemoryToolResult } from './types.ts'
import type { MemoryStore } from './store.ts'

/** Model-facing description of the memory tool (single source for both the
 * registry registration and the review fork's tool schema). */
export const MEMORY_TOOL_DESCRIPTION =
  'Save durable facts to persistent memory that survive across sessions. Memory is '
  + 'injected into every future turn, so keep entries compact and high-signal.\n\n'
  + 'HOW: make ALL your changes in ONE call via an \'operations\' array (each item: '
  + '{action, content?, old_text?}). The batch applies atomically and the char limit is '
  + 'checked only on the FINAL result — so a single call can remove/replace stale entries '
  + 'to free room AND add new ones, even when an add alone would overflow. The response '
  + 'reports current/limit chars and confirms completion; one batch call finishes the '
  + "update, so don't repeat it. Use the bare action/content/old_text fields only for a "
  + 'single lone change.\n\n'
  + 'IMPORTANT: To UPDATE an existing entry, use action="replace" with old_text and content '
  + 'in the SAME call. old_text must be a unique substring of exactly one current entry; '
  + 'use the distinctive full entry text shown in current_entries, never text spanning the '
  + '§ separator. Do NOT use remove+add as two separate calls — replace does both atomically. '
  + 'Do not use filesystem, shell, or edit tools to modify MEMORY.md or USER.md; all memory '
  + 'writes MUST go through this memory tool.\n\n'
  + 'WHEN: save proactively when the user states a preference, correction, or personal '
  + 'detail, or you learn a stable fact about their environment, conventions, or workflow. '
  + 'Priority: user preferences & corrections > environment facts > procedures. The best '
  + 'memory stops the user repeating themselves.\n\n'
  + 'IF FULL: an add is rejected with the current entries shown. Reissue as ONE batch that '
  + 'removes or shortens enough stale entries and adds the new one together.\n\n'
  + "TARGETS: 'user' stores stable personal facts; choose the target by the fact type. Use target=\"user\" ONLY for stable personal "
  + 'facts about the user: name, location, age, identity, education, employer, role, personal '
  + 'preferences, or communication style. Use target="memory" for project and environment facts: '
  + 'repositories, code conventions, product details, workflows, tool behavior, technical rules, '
  + 'and instructions about how this project should be operated. Never put project rules or API '
  + 'debugging facts in USER.md. Never put a personal profile fact in MEMORY.md.\n\n'
  + 'SKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task progress, '
  + 'completed-work logs, temporary TODO state. Reusable '
  + 'procedures belong in a skill, not memory.'

/** The tool's parameter declaration (implicit open-object root). */
export const MEMORY_TOOL_PARAMETERS: ParameterSchemaSpec = {
  action: {
    type: 'string',
    enum: ['add', 'replace', 'remove'],
    description: "The action to perform (single-op shape). Omit when using 'operations'.",
  },
  target: {
    type: 'string',
    required: true,
    enum: ['memory', 'user'],
    description: "Which memory store: 'memory' for personal notes, 'user' for user profile.",
  },
  content: {
    type: 'string',
    description: "The entry content. Required for 'add' and 'replace' (single-op shape).",
  },
  old_text: {
    type: 'string',
    description: "REQUIRED for 'replace' and 'remove' (single-op shape): a short unique substring identifying the existing entry to modify. Omit only for 'add'.",
  },
  operations: {
    type: 'array',
    description: (
      'Batch shape: a list of operations applied atomically in one call '
      + 'against the final char budget. Preferred when making multiple changes '
      + 'or consolidating to make room. Each item is {action, content?, old_text?}.'
    ),
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          required: true,
          enum: ['add', 'replace', 'remove'],
        },
        content: { type: 'string', description: 'Entry content for add/replace.' },
        old_text: { type: 'string', description: 'Substring identifying the entry for replace/remove.' },
      },
    },
  },
}

/** The arguments one `memory` call accepts, after registry schema validation. */
export interface MemoryToolArgs {
  /** Single-op action; absent for the batch shape. */
  readonly action?: 'add' | 'replace' | 'remove'
  /** Which store; required by the schema and always present. */
  readonly target: MemoryTarget
  /** Entry content for add/replace. */
  readonly content?: string
  /** Unique substring for replace/remove. */
  readonly old_text?: string
  /** Batch shape, applied atomically. */
  readonly operations?: readonly MemoryOperation[]
}

/**
 * Narrow registry-validated tool arguments (the open-root object type) to the
 * dispatch shape. The registry schema already pins the enums and item keys;
 * this step only re-derives the narrowed fields, defaulting a missing target
 * to `memory` exactly like the upstream handler.
 * @param raw - validated arguments.
 * @returns the dispatch-ready arguments.
 */
export function toMemoryToolArgs(raw: Record<string, unknown>): MemoryToolArgs {
  const action = raw.action
  const content = raw.content
  const oldText = raw.old_text
  const operations = raw.operations
  return {
    ...(action === 'add' || action === 'replace' || action === 'remove' ? { action } : {}),
    target: raw.target === 'user' ? 'user' : 'memory',
    ...(typeof content === 'string' ? { content } : {}),
    ...(typeof oldText === 'string' ? { old_text: oldText } : {}),
    ...(Array.isArray(operations) ? { operations: operations as readonly MemoryOperation[] } : {}),
  }
}

/**
 * Recoverable error for a replace/remove call that arrived without
 * `old_text`: the operation is inherently targeted, so return the current
 * entry inventory plus an explicit retry instruction instead of a dead-end
 * message.
 * @param store - the live store whose entries form the retry inventory.
 * @param target - which store the call addressed.
 * @param action - the operation that needs the substring.
 * @returns the error result.
 */
function missingOldTextError(store: MemoryStore, target: MemoryTarget, action: 'replace' | 'remove'): MemoryToolResult {
  return {
    success: false,
    error: (
      `'${action}' needs old_text -- a short unique substring of the entry `
      + `to ${action}. None was provided. Reissue the ${action} with old_text `
      + 'set to part of one of the current_entries below.'
    ),
    current_entries: store.entriesFor(target),
    usage: store.usageString(target),
  }
}

/**
 * Dispatch one `memory` call to the store, mirroring the upstream handler:
 * the batch shape wins when `operations` is present; otherwise required
 * single-op parameters are validated BEFORE acting so an invalid write is
 * rejected immediately.
 * @param store - the shared per-session store.
 * @param args - the validated tool arguments.
 * @returns the result dict, JSON-serialized by the caller.
 */
export async function dispatchMemoryTool(store: MemoryStore, args: MemoryToolArgs): Promise<MemoryToolResult> {
  const target = args.target

  // Batch path: a NON-EMPTY `operations` list wins outright, matching the
  // upstream truthiness gate — an empty list falls through to the single-op
  // path and lands in the unknown-action error instead of applyBatch's
  // "operations list is empty." rejection.
  if (args.operations !== undefined && args.operations.length > 0) {
    return store.applyBatch(target, args.operations)
  }

  // Single-op path: validate required params BEFORE acting, with the same
  // falsy semantics as the upstream handler — absent or empty string counts
  // as missing; whitespace-only strings pass through to the store's own
  // trimmed-empty rejections.
  const action = args.action
  const content = args.content
  const oldText = args.old_text
  if (action === 'add' && (content === undefined || content === '')) {
    return { success: false, error: "Content is required for 'add' action." }
  }
  if (action === 'replace' && (oldText === undefined || oldText === '')) {
    return missingOldTextError(store, target, 'replace')
  }
  if (action === 'replace' && (content === undefined || content === '')) {
    return { success: false, error: "content is required for 'replace' action." }
  }
  if (action === 'remove' && (oldText === undefined || oldText === '')) {
    return missingOldTextError(store, target, 'remove')
  }

  if (action === 'add' && content !== undefined) return store.add(target, content)
  if (action === 'replace' && oldText !== undefined && content !== undefined) {
    return store.replace(target, oldText, content)
  }
  if (action === 'remove' && oldText !== undefined) return store.remove(target, oldText)
  // Only an undefined action reaches here: toMemoryToolArgs drops anything else.
  return { success: false, error: `Unknown action '${action ?? ''}'. Use: add, replace, remove` }
}
