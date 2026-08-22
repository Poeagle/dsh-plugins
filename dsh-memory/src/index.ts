/**
 * Persistent bounded memory for DSH agents — a port of the upstream memory
 * subsystem. Two `§`-delimited files under `$DSH_HOME/memories/` hold the
 * entries; a frozen snapshot captured at activation feeds the system prompt;
 * the `memory` tool mutates the live lists on disk; and after gated completed
 * turns a background review fork lets the model save durable facts on its
 * own.
 *
 * The model-visible semantics follow the upstream store: per-turn
 * consolidation-failure budget with a terminal stop message, terminal success
 * responses that never echo entries, drift detection with timestamped backups
 * before refusing a clobbering write, strict-scope threat scans on every
 * write, and the exact single-op / batch dispatch texts.
 * @module dsh-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { MemoryStore } from './store.ts'
import { MEMORY_TOOL_DESCRIPTION, MEMORY_TOOL_PARAMETERS, dispatchMemoryTool, toMemoryToolArgs } from './schema.ts'
import { runMemoryReview } from './review.ts'

/** Cordis plugin name. */
export const name = 'memory'

/** Services required before activation. */
export const inject = ['tools', 'llm', 'agents']

/** Character budget of the `memory` store, mirroring the upstream default. */
export const DEFAULT_MEMORY_CHAR_LIMIT = 2200
/** Character budget of the `user` store, mirroring the upstream default. */
export const DEFAULT_USER_CHAR_LIMIT = 1375
/** Upstream nudge interval: one background review every ten user turns. */
export const DEFAULT_NUDGE_INTERVAL = 10
/** Review fork request cap, mirroring the upstream max_iterations. */
export const DEFAULT_REVIEW_MAX_ITERATIONS = 16

/** Deployment policy for the memory subsystem. */
export interface Config {
  /** Character budget of the `memory` store. */
  memoryCharLimit: number
  /** Character budget of the `user` store. */
  userCharLimit: number
  /** Completed user turns between background memory reviews; 0 disables reviews. */
  nudgeInterval: number
  /** Max model steps per background review fork. */
  reviewMaxIterations: number
  /** Run background memory reviews after gated completed turns. */
  reviewEnabled: boolean
}

/** Schemastery configuration for the memory plugin. */
export const Config: z<Config> = z.object({
  memoryCharLimit: z.number().step(1).min(1).default(DEFAULT_MEMORY_CHAR_LIMIT),
  userCharLimit: z.number().step(1).min(1).default(DEFAULT_USER_CHAR_LIMIT),
  nudgeInterval: z.number().step(1).min(0).default(DEFAULT_NUDGE_INTERVAL),
  reviewMaxIterations: z.number().step(1).min(1).default(DEFAULT_REVIEW_MAX_ITERATIONS),
  reviewEnabled: z.boolean().default(true),
})

/** One live session's nudge bookkeeping. */
interface SessionNudgeState {
  /** User turns since the last review gate fired. */
  turnsSinceMemory: number
  /** Prior history has not been folded into the counter yet. */
  hydrated: boolean
  /** The gate fired on the latest user turn; the next completed turn reviews. */
  reviewPending: boolean
}

/**
 * Resolve the auxiliary route for one session's review fork: the session's
 * own epoch-header route keeps the replay on the same model (and therefore
 * the same cached request prefix), with the live agent's configured route as
 * the fallback for sessions that never sent a request.
 * @param ctx - context carrying the agent registry.
 * @param session - the session whose history replays.
 * @returns provider and model, or undefined when no route is known.
 */
function resolveReviewRoute(ctx: Context, session: Session): { provider: string; model: string } | undefined {
  const header = session.requestHeader()
  if (header !== undefined) {
    return { provider: header.config.provider, model: header.config.model }
  }
  const agent = ctx.agents.get(session.id)
  if (agent?.options.provider !== undefined && agent.options.model !== undefined) {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  return undefined
}

/**
 * Count the user-role messages already in a session log, for nudge hydration
 * after a resume.
 * @param session - the session to count.
 * @returns the user-message event count.
 */
function priorUserTurns(session: Session): number {
  let count = 0
  for (const event of session.events) {
    if (event.type === 'user/message') count += 1
  }
  return count
}

/**
 * Activate the memory subsystem: load the stores, register the tool and the
 * system-prompt snapshot section, and attach the per-session nudge counters
 * plus the background review spawner.
 * @param ctx - registrant context.
 * @param config - deployment memory policy.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const store = new MemoryStore({
    dir: MemoryStore.defaultDir(),
    memoryCharLimit: config.memoryCharLimit,
    userCharLimit: config.userCharLimit,
  })
  await store.loadFromDisk()

  /**
   * Resolve the effective nudge/review settings from the optional settings
   * service, falling back to the composition config when the service is
   * unavailable or the namespace is not registered.
   */
  function effectiveSettings(): { nudgeInterval: number; reviewEnabled: boolean } {
    const settings = ctx.get('settings') as { get?(ns: string): unknown } | undefined
    if (settings?.get) {
      const raw = settings.get('memory') as Record<string, unknown> | undefined
      if (raw !== undefined) {
        return {
          nudgeInterval: typeof raw.nudgeInterval === 'number' ? raw.nudgeInterval : config.nudgeInterval,
          reviewEnabled: typeof raw.reviewEnabled === 'boolean' ? raw.reviewEnabled : config.reviewEnabled,
        }
      }
    }
    return { nudgeInterval: config.nudgeInterval, reviewEnabled: config.reviewEnabled }
  }

  ctx.tools.register(defineTool({
    name: 'memory',
    description: MEMORY_TOOL_DESCRIPTION,
    parameters: MEMORY_TOOL_PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args) => {
      const result = await dispatchMemoryTool(store, toMemoryToolArgs(args))
      // The result carries only JSON-safe scalars, strings, and string lists.
      return result as unknown as Record<string, JsonValue>
    },
  }))

  // ── Context injection ─────────────────────────────────────────────────
  // Inject the memory snapshot as a user-role message via the agent inbox
  // on the first pre-step of each session. The UI renders inbox messages
  // with source.kind === 'plugin' as expandable "上下文注入" cards.
  // The snapshot is refreshed at session creation so new sessions always
  // see the latest data; mid-session writes do NOT refresh the snapshot.
  ctx.on('session/created', () => {
    void store.refreshSnapshot()
  })

  /** Sessions that have already received the memory context injection. */
  const injected = new Set<SessionId>()
  /**
   * Per-session lock to prevent concurrent injection from multiple agents
   * sharing the same session (main agent + subagent in same conversation).
   */
  const injectionLocks = new Map<SessionId, Promise<void>>()

  ctx.on('agent/pre-step', async (
    { agent, messages, signal: _signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    const text = store.renderContextBlock()
    if (text === '') return decision
    if (decision.kind !== 'enter') return decision

    const sid = agent.session.id

    // Atomically acquire a per-session lock. Two agents (main + subagent)
    // may fire pre-step concurrently for the same session; only one may
    // proceed to inject, the other waits and then skips.
    let release: () => void
    const existing = injectionLocks.get(sid)
    if (existing !== undefined) {
      // Another agent is already handling this session; wait for it.
      await existing
      // The log now has the injection; skip this one.
      return decision
    }
    const lock = new Promise<void>(resolve => { release = resolve })
    injectionLocks.set(sid, lock)

    try {
      // Fast path: already injected in an earlier turn.
      if (injected.has(sid)) return decision

      // After a restart the in-memory Set is empty, so check the session log.
      const alreadyInLog = agent.session.events.some(e => {
        if (e.type !== 'user/message') return false
        const msg = e.data as { source?: { kind?: string; plugin?: string } }
        return msg.source?.kind === 'plugin' && msg.source?.plugin === name
      })
      if (alreadyInLog) {
        injected.add(sid)
        return decision
      }

      injected.add(sid)
      const contextMessage = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: name },
      })
      // Prepend the memory context at the same position as other context
      // injections (after the user's claimed batch).
      const lastClaimedIndex = (decision.messages as any[]).findLastIndex(m => messages.includes(m as any))
      const entered = (decision.messages as any[]).toSpliced(lastClaimedIndex + 1, 0, contextMessage)
      return { kind: 'enter', messages: entered }
    } finally {
      release!()
      injectionLocks.delete(sid)
    }
  })

  /** Per-session nudge state, keyed by session id. */
  const states = new Map<SessionId, SessionNudgeState>()
  /** Sessions with a review fork in flight. */
  const reviewing = new Set<SessionId>()
  /** Cancellation handles for in-flight review forks. */
  const aborters = new Map<SessionId, AbortController>()

  /** Lazily create one session's nudge state. */
  function stateFor(id: SessionId): SessionNudgeState {
    let state = states.get(id)
    if (state === undefined) {
      state = { turnsSinceMemory: 0, hydrated: false, reviewPending: false }
      states.set(id, state)
    }
    return state
  }

  /**
   * Count real user turns and fold the interval gate. The gate fires on the
   * Nth user turn and arms a pending review; the review itself waits for the
   * completed turn that follows, exactly like the upstream
   * `should_review_memory` handoff from turn setup to the finalizer.
   */
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    // Per-turn consolidation budget: every turn starts clean.
    if (event.type === 'turn/start') store.resetConsolidationFailures()
    if (event.type !== 'user/message') return
    if ((session.header.delegationDepth ?? 0) > 0) return
    if (event.data.source.kind !== 'user') return
    const state = stateFor(session.id)
    if (!state.hydrated) {
      state.hydrated = true
      // A resumed session already carries prior user turns in its log; fold
      // them into the counter (minus this message) like the upstream
      // `prior_user_turns % interval` hydration.
      const prior = priorUserTurns(session) - 1
      if (config.nudgeInterval > 0 && prior > 0) {
        state.turnsSinceMemory = prior % config.nudgeInterval
      }
    }
    const { nudgeInterval, reviewEnabled } = effectiveSettings()
    if (nudgeInterval > 0 && reviewEnabled) {
      state.turnsSinceMemory += 1
      if (state.turnsSinceMemory >= nudgeInterval) {
        state.turnsSinceMemory = 0
        state.reviewPending = true
      }
    }
  })

  /** Spawn the armed review once the gated turn completes. */
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'turn/end' || event.data.reason.kind !== 'completed') return
    const state = states.get(session.id)
    if (state === undefined || !state.reviewPending) return
    state.reviewPending = false
    if (reviewing.has(session.id)) return
    const route = resolveReviewRoute(ctx, session)
    if (route === undefined) return
    reviewing.add(session.id)
    const aborter = new AbortController()
    aborters.set(session.id, aborter)
    void runMemoryReview(ctx, {
      session,
      store,
      route,
      maxIterations: config.reviewMaxIterations,
      signal: aborter.signal,
    }).catch((error: unknown) => {
      ctx.logger.warn(`memory: background review for ${String(session.id)} failed: ${String(error)}`)
    }).finally(() => {
      reviewing.delete(session.id)
      aborters.delete(session.id)
    })
  })

  /** Cancel a session's in-flight review fork and drop its state. */
  ctx.on('session/disposed', (session: Session) => {
    aborters.get(session.id)?.abort()
    aborters.delete(session.id)
    reviewing.delete(session.id)
    states.delete(session.id)
    injected.delete(session.id)
    injectionLocks.delete(session.id)
  })
}
