import { t as MemoryStore } from "./store-BcMNE9sl.js";
import z from "@deepseek-ai/schemastery";
import { defineTool, parameterSchemaSpecToJsonSchema } from "@deepseek-ai/dsh-tools";
import { BlockAssembler, createAssistantMessage, createToolResultMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
//#region src/schema.ts
/** Model-facing description of the memory tool (single source for both the
* registry registration and the review fork's tool schema). */
const MEMORY_TOOL_DESCRIPTION = "Save durable facts to persistent memory that survive across sessions. Memory is injected into every future turn, so keep entries compact and high-signal.\n\nHOW: make ALL your changes in ONE call via an 'operations' array (each item: {action, content?, old_text?}). The batch applies atomically and the char limit is checked only on the FINAL result — so a single call can remove/replace stale entries to free room AND add new ones, even when an add alone would overflow. The response reports current/limit chars and confirms completion; one batch call finishes the update, so don't repeat it. Use the bare action/content/old_text fields only for a single lone change.\n\nIMPORTANT: To UPDATE an existing entry, use action=\"replace\" with old_text and content in the SAME call. old_text must be a unique substring of exactly one current entry; use the distinctive full entry text shown in current_entries, never text spanning the § separator. Do NOT use remove+add as two separate calls — replace does both atomically. Do not use filesystem, shell, or edit tools to modify MEMORY.md or USER.md; all memory writes MUST go through this memory tool.\n\nWHEN: save proactively when the user states a preference, correction, or personal detail, or you learn a stable fact about their environment, conventions, or workflow. Priority: user preferences & corrections > environment facts > procedures. The best memory stops the user repeating themselves.\n\nIF FULL: an add is rejected with the current entries shown. Reissue as ONE batch that removes or shortens enough stale entries and adds the new one together.\n\nTARGETS: 'user' = who the user is (name, role, preferences, style). 'memory' = your notes (environment, conventions, tool quirks, lessons).\n\nSKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task progress, completed-work logs, temporary TODO state. Reusable procedures belong in a skill, not memory.";
/** The tool's parameter declaration (implicit open-object root). */
const MEMORY_TOOL_PARAMETERS = {
	action: {
		type: "string",
		enum: [
			"add",
			"replace",
			"remove"
		],
		description: "The action to perform (single-op shape). Omit when using 'operations'."
	},
	target: {
		type: "string",
		required: true,
		enum: ["memory", "user"],
		description: "Which memory store: 'memory' for personal notes, 'user' for user profile."
	},
	content: {
		type: "string",
		description: "The entry content. Required for 'add' and 'replace' (single-op shape)."
	},
	old_text: {
		type: "string",
		description: "REQUIRED for 'replace' and 'remove' (single-op shape): a short unique substring identifying the existing entry to modify. Omit only for 'add'."
	},
	operations: {
		type: "array",
		description: "Batch shape: a list of operations applied atomically in one call against the final char budget. Preferred when making multiple changes or consolidating to make room. Each item is {action, content?, old_text?}.",
		items: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					required: true,
					enum: [
						"add",
						"replace",
						"remove"
					]
				},
				content: {
					type: "string",
					description: "Entry content for add/replace."
				},
				old_text: {
					type: "string",
					description: "Substring identifying the entry for replace/remove."
				}
			}
		}
	}
};
/**
* Narrow registry-validated tool arguments (the open-root object type) to the
* dispatch shape. The registry schema already pins the enums and item keys;
* this step only re-derives the narrowed fields, defaulting a missing target
* to `memory` exactly like the upstream handler.
* @param raw - validated arguments.
* @returns the dispatch-ready arguments.
*/
function toMemoryToolArgs(raw) {
	const action = raw.action;
	const content = raw.content;
	const oldText = raw.old_text;
	const operations = raw.operations;
	return {
		...action === "add" || action === "replace" || action === "remove" ? { action } : {},
		target: raw.target === "user" ? "user" : "memory",
		...typeof content === "string" ? { content } : {},
		...typeof oldText === "string" ? { old_text: oldText } : {},
		...Array.isArray(operations) ? { operations } : {}
	};
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
function missingOldTextError(store, target, action) {
	return {
		success: false,
		error: `'${action}' needs old_text -- a short unique substring of the entry to ${action}. None was provided. Reissue the ${action} with old_text set to part of one of the current_entries below.`,
		current_entries: store.entriesFor(target),
		usage: store.usageString(target)
	};
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
async function dispatchMemoryTool(store, args) {
	const target = args.target;
	if (args.operations !== void 0 && args.operations.length > 0) return store.applyBatch(target, args.operations);
	const action = args.action;
	const content = args.content;
	const oldText = args.old_text;
	if (action === "add" && (content === void 0 || content === "")) return {
		success: false,
		error: "Content is required for 'add' action."
	};
	if (action === "replace" && (oldText === void 0 || oldText === "")) return missingOldTextError(store, target, "replace");
	if (action === "replace" && (content === void 0 || content === "")) return {
		success: false,
		error: "content is required for 'replace' action."
	};
	if (action === "remove" && (oldText === void 0 || oldText === "")) return missingOldTextError(store, target, "remove");
	if (action === "add" && content !== void 0) return store.add(target, content);
	if (action === "replace" && oldText !== void 0 && content !== void 0) return store.replace(target, oldText, content);
	if (action === "remove" && oldText !== void 0) return store.remove(target, oldText);
	return {
		success: false,
		error: `Unknown action '${action ?? ""}'. Use: add, replace, remove`
	};
}
//#endregion
//#region src/review.ts
/** The review directive appended after the replayed conversation. */
const MEMORY_REVIEW_PROMPT = "Review the conversation above and consider saving to memory if appropriate.\n\nFocus on:\n1. Has the user revealed things about themselves — their persona, desires, preferences, or personal details worth remembering?\n2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?\n\nIf something stands out, save it using the memory tool. If nothing is worth saving, just say 'Nothing to save.' and stop.\n\nYou can only call the memory tool. Other tools will be denied at runtime — do not attempt them.";
/**
* Build the memory-only tool schema the review request offers. Sharing the
* parameter spec with the registry registration keeps the fork and the live
* tool in lockstep.
* @returns the tool schema.
*/
function memoryToolSchema() {
	return {
		name: "memory",
		description: MEMORY_TOOL_DESCRIPTION,
		parameters: { ...parameterSchemaSpecToJsonSchema(MEMORY_TOOL_PARAMETERS) }
	};
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
async function runMemoryReview(ctx, options) {
	const { session, store, route, maxIterations, signal } = options;
	const system = session.requestHeader()?.system;
	const messages = [...session.deriveMessages(), createUserMessage({
		source: {
			kind: "plugin",
			plugin: "dsh-memory"
		},
		content: [{
			type: "text",
			text: MEMORY_REVIEW_PROMPT
		}]
	})];
	const tools = [memoryToolSchema()];
	let saved = 0;
	for (let iteration = 1; iteration <= maxIterations; iteration++) {
		if (signal.aborted) return {
			iterations: iteration - 1,
			saved,
			reason: "aborted"
		};
		const assembler = new BlockAssembler();
		try {
			for await (const chunk of ctx.llm.stream({
				provider: route.provider,
				model: route.model,
				messages,
				...system === void 0 ? {} : { system },
				tools,
				signal,
				sessionId: session.id
			})) assembler.push(chunk);
		} catch {
			return {
				iterations: iteration,
				saved,
				reason: "failed"
			};
		}
		const finish = assembler.finish;
		if (finish.kind === "aborted" || finish.kind === "error") return {
			iterations: iteration,
			saved,
			reason: finish.kind === "aborted" ? "aborted" : "failed"
		};
		const blocks = assembler.blocks();
		messages.push(createAssistantMessage({
			content: blocks,
			source: {
				provider: route.provider,
				model: route.model,
				replayState: assembler.replayState
			}
		}));
		const toolCalls = blocks.filter((block) => block.type === "tool-call");
		if (finish.kind !== "tool-calls" || toolCalls.length === 0) return {
			iterations: iteration,
			saved,
			reason: "finished"
		};
		for (const call of toolCalls) {
			const result = await executeReviewToolCall(store, call.id, call.name, call.arguments);
			if (result.saved) saved += 1;
			messages.push(createToolResultMessage({
				callId: call.id,
				content: [{
					type: "text",
					text: result.text
				}],
				isError: result.isError
			}));
		}
	}
	return {
		iterations: maxIterations,
		saved,
		reason: "max-iterations"
	};
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
async function executeReviewToolCall(store, callId, name, rawArguments) {
	if (name !== "memory") return {
		text: `Background review denied non-whitelisted tool: ${name}. Only memory tools are allowed.`,
		isError: true,
		saved: false
	};
	let args;
	try {
		args = JSON.parse(rawArguments);
	} catch {
		return {
			text: "Invalid tool arguments: not valid JSON.",
			isError: true,
			saved: false
		};
	}
	if (args === null || typeof args !== "object" || Array.isArray(args)) return {
		text: "Invalid tool arguments: expected an object.",
		isError: true,
		saved: false
	};
	const result = await dispatchMemoryTool(store, toMemoryToolArgs(args));
	const saved = result.success && result.message !== "Entry already exists (no duplicate added).";
	return {
		text: JSON.stringify(result),
		isError: false,
		saved
	};
}
//#endregion
//#region src/index.ts
/** Cordis plugin name. */
const name = "memory";
/** Services required before activation. */
const inject = [
	"tools",
	"llm",
	"agents"
];
/** Character budget of the `memory` store, mirroring the upstream default. */
const DEFAULT_MEMORY_CHAR_LIMIT = 2200;
/** Character budget of the `user` store, mirroring the upstream default. */
const DEFAULT_USER_CHAR_LIMIT = 1375;
/** Upstream nudge interval: one background review every ten user turns. */
const DEFAULT_NUDGE_INTERVAL = 10;
/** Review fork request cap, mirroring the upstream max_iterations. */
const DEFAULT_REVIEW_MAX_ITERATIONS = 16;
/** Schemastery configuration for the memory plugin. */
const Config = z.object({
	memoryCharLimit: z.number().step(1).min(1).default(DEFAULT_MEMORY_CHAR_LIMIT),
	userCharLimit: z.number().step(1).min(1).default(DEFAULT_USER_CHAR_LIMIT),
	nudgeInterval: z.number().step(1).min(0).default(10),
	reviewMaxIterations: z.number().step(1).min(1).default(16),
	reviewEnabled: z.boolean().default(true)
});
/**
* Resolve the auxiliary route for one session's review fork: the session's
* own epoch-header route keeps the replay on the same model (and therefore
* the same cached request prefix), with the live agent's configured route as
* the fallback for sessions that never sent a request.
* @param ctx - context carrying the agent registry.
* @param session - the session whose history replays.
* @returns provider and model, or undefined when no route is known.
*/
function resolveReviewRoute(ctx, session) {
	const header = session.requestHeader();
	if (header !== void 0) return {
		provider: header.config.provider,
		model: header.config.model
	};
	const agent = ctx.agents.get(session.id);
	if (agent?.options.provider !== void 0 && agent.options.model !== void 0) return {
		provider: agent.options.provider,
		model: agent.options.model
	};
}
/**
* Count the user-role messages already in a session log, for nudge hydration
* after a resume.
* @param session - the session to count.
* @returns the user-message event count.
*/
function priorUserTurns(session) {
	let count = 0;
	for (const event of session.events) if (event.type === "user/message") count += 1;
	return count;
}
/**
* Activate the memory subsystem: load the stores, register the tool and the
* system-prompt snapshot section, and attach the per-session nudge counters
* plus the background review spawner.
* @param ctx - registrant context.
* @param config - deployment memory policy.
*/
async function apply(ctx, config) {
	const store = new MemoryStore({
		dir: MemoryStore.defaultDir(),
		memoryCharLimit: config.memoryCharLimit,
		userCharLimit: config.userCharLimit
	});
	await store.loadFromDisk();
	/**
	* Resolve the effective nudge/review settings from the optional settings
	* service, falling back to the composition config when the service is
	* unavailable or the namespace is not registered.
	*/
	function effectiveSettings() {
		const settings = ctx.get("settings");
		if (settings?.get) {
			const raw = settings.get("memory");
			if (raw !== void 0) return {
				nudgeInterval: typeof raw.nudgeInterval === "number" ? raw.nudgeInterval : config.nudgeInterval,
				reviewEnabled: typeof raw.reviewEnabled === "boolean" ? raw.reviewEnabled : config.reviewEnabled
			};
		}
		return {
			nudgeInterval: config.nudgeInterval,
			reviewEnabled: config.reviewEnabled
		};
	}
	ctx.tools.register(defineTool({
		name: "memory",
		description: MEMORY_TOOL_DESCRIPTION,
		parameters: MEMORY_TOOL_PARAMETERS,
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		execute: async (args) => {
			return await dispatchMemoryTool(store, toMemoryToolArgs(args));
		}
	}));
	ctx.on("session/created", () => {
		store.refreshSnapshot();
	});
	/** Sessions that have already received the memory context injection. */
	const injected = /* @__PURE__ */ new Set();
	/**
	* Per-session lock to prevent concurrent injection from multiple agents
	* sharing the same session (main agent + subagent in same conversation).
	*/
	const injectionLocks = /* @__PURE__ */ new Map();
	ctx.on("agent/pre-step", async ({ agent, messages, signal: _signal }, next) => {
		const decision = await next();
		const text = store.renderContextBlock();
		if (text === "") return decision;
		if (decision.kind !== "enter") return decision;
		const sid = agent.session.id;
		let release;
		const existing = injectionLocks.get(sid);
		if (existing !== void 0) {
			await existing;
			return decision;
		}
		const lock = new Promise((resolve) => {
			release = resolve;
		});
		injectionLocks.set(sid, lock);
		try {
			if (injected.has(sid)) return decision;
			if (agent.session.events.some((e) => {
				if (e.type !== "user/message") return false;
				const msg = e.data;
				return msg.source?.kind === "plugin" && msg.source?.plugin === "memory";
			})) {
				injected.add(sid);
				return decision;
			}
			injected.add(sid);
			const contextMessage = createUserMessage({
				content: [{
					type: "text",
					text
				}],
				source: {
					kind: "plugin",
					plugin: name
				}
			});
			const lastClaimedIndex = decision.messages.findLastIndex((m) => messages.includes(m));
			return {
				kind: "enter",
				messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, contextMessage)
			};
		} finally {
			release();
			injectionLocks.delete(sid);
		}
	});
	/** Per-session nudge state, keyed by session id. */
	const states = /* @__PURE__ */ new Map();
	/** Sessions with a review fork in flight. */
	const reviewing = /* @__PURE__ */ new Set();
	/** Cancellation handles for in-flight review forks. */
	const aborters = /* @__PURE__ */ new Map();
	/** Lazily create one session's nudge state. */
	function stateFor(id) {
		let state = states.get(id);
		if (state === void 0) {
			state = {
				turnsSinceMemory: 0,
				hydrated: false,
				reviewPending: false
			};
			states.set(id, state);
		}
		return state;
	}
	/**
	* Count real user turns and fold the interval gate. The gate fires on the
	* Nth user turn and arms a pending review; the review itself waits for the
	* completed turn that follows, exactly like the upstream
	* `should_review_memory` handoff from turn setup to the finalizer.
	*/
	ctx.on("session/event", (session, event) => {
		if (event.type === "turn/start") store.resetConsolidationFailures();
		if (event.type !== "user/message") return;
		if ((session.header.delegationDepth ?? 0) > 0) return;
		if (event.data.source.kind !== "user") return;
		const state = stateFor(session.id);
		if (!state.hydrated) {
			state.hydrated = true;
			const prior = priorUserTurns(session) - 1;
			if (config.nudgeInterval > 0 && prior > 0) state.turnsSinceMemory = prior % config.nudgeInterval;
		}
		const { nudgeInterval, reviewEnabled } = effectiveSettings();
		if (nudgeInterval > 0 && reviewEnabled) {
			state.turnsSinceMemory += 1;
			if (state.turnsSinceMemory >= nudgeInterval) {
				state.turnsSinceMemory = 0;
				state.reviewPending = true;
			}
		}
	});
	/** Spawn the armed review once the gated turn completes. */
	ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end" || event.data.reason.kind !== "completed") return;
		const state = states.get(session.id);
		if (state === void 0 || !state.reviewPending) return;
		state.reviewPending = false;
		if (reviewing.has(session.id)) return;
		const route = resolveReviewRoute(ctx, session);
		if (route === void 0) return;
		reviewing.add(session.id);
		const aborter = new AbortController();
		aborters.set(session.id, aborter);
		runMemoryReview(ctx, {
			session,
			store,
			route,
			maxIterations: config.reviewMaxIterations,
			signal: aborter.signal
		}).catch((error) => {
			ctx.logger.warn(`memory: background review for ${String(session.id)} failed: ${String(error)}`);
		}).finally(() => {
			reviewing.delete(session.id);
			aborters.delete(session.id);
		});
	});
	/** Cancel a session's in-flight review fork and drop its state. */
	ctx.on("session/disposed", (session) => {
		aborters.get(session.id)?.abort();
		aborters.delete(session.id);
		reviewing.delete(session.id);
		states.delete(session.id);
		injected.delete(session.id);
		injectionLocks.delete(session.id);
	});
}
//#endregion
export { Config, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_NUDGE_INTERVAL, DEFAULT_REVIEW_MAX_ITERATIONS, DEFAULT_USER_CHAR_LIMIT, apply, inject, name };

//# sourceMappingURL=index.js.map