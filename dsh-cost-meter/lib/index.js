import { $ as querySessionRows, A as flattenCostTableRows, At as resolvePricing, B as isNumericCostTableColumn, C as defaultChildCostTableSort, Ct as lastUpdatedAt, D as filterCostTableRows, Dt as periodDays, E as displayCellText, Et as normalizeUsage, F as formatUnitTokensLabel, G as metricCost, H as localTodayDate, I as formatUsageCell, J as overviewCost, K as metricTokens, L as groupCostTableRows, M as formatCacheRatedCost, Mt as routeKey, N as formatMoneyAmount, Nt as togglePeriodAllDay, O as filterHourlyEntries, Ot as resolveContextMultiplier, P as formatRatedCost, Pt as validatePricing, Q as queryHourlyOverview, R as groupDailyOverview, S as costTableTotals, St as lastProbeAt, T as defaultVisibleCostColumns, Tt as normalizePricing, U as mapWithConcurrency, V as localDateOfHour, W as mergeListedSessionCost, X as queryCostTableGroups, Y as queryCostTable, Z as queryDailyOverview, _ as usageURL, _t as discountMultiplierAt, a as parseBillingMultiplier, at as sortCostTableRows, b as averageUnitPrice, bt as formatTokenThreshold, c as gatewayOrigin, ct as toggleCostTableSort, d as modelsURL, dt as DEFAULT_PRICING, et as resolveVisibleCostColumns, f as parseProviderBalance, ft as applyPeriodClock, g as shouldRemoveUnavailableProvider, gt as contextTokensOf, h as routesForProvider, ht as clockTime, i as nextBillingProbeDue, it as sharedContextSurcharge, j as flattenHourlyEntries, jt as resolveReasoningExtra, k as filterSessionRows, kt as resolveContextSurcharge, l as groupProviderBalanceTargetsByOrigin, lt as toggleSessionTableSort, m as probeProviderBalance, mt as billedOutputTokens, n as billingProbeURL, nt as sessionRoutes, o as collapseBalanceChips, ot as sortSessionRows, p as probeProviderAvailability, pt as assignmentWithManualMultiplier, q as optionalCostTableColumns, rt as sessionTotalTokens, s as collectProviderBalances, st as sumHourlySlices, t as assignmentWithObservedMultiplier, tt as rowTotalTokens, u as listProviderBalanceTargets, ut as DEFAULT_GROUP, v as walletHref, vt as foldSession, w as defaultCostTableSort, wt as multiplierHistoryRows, x as costTableColumnValues, xt as isPeriodAllDay, y as activityText, yt as formatContextSurcharge, z as groupHourlyEntries } from "./upstream-billing-probe-CqxZJKGv.js";
import z from "@deepseek-ai/schemastery";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/session-fold-cache.ts
/** In-process cache of each session's own fold, keyed by pricing and log fingerprints. */
function stableValue(value) {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter((key) => key !== "lastProbedAt").map((key) => [key, stableValue(value[key])]));
	return value;
}
/** Deterministic fingerprint of the live pricing used to value a fold. Probe timestamps do not change billed rates. */
function pricingFingerprint(config) {
	return JSON.stringify(stableValue(config));
}
function usageMix(event) {
	const usage = event.data.usage ?? (event.data.chunk?.type === "usage" ? event.data.chunk.usage : void 0) ?? event.data.stream?.find((record) => record.chunk?.type === "usage")?.chunk?.usage;
	if (usage === void 0) return 0;
	let mix = 0;
	for (const value of Object.values(usage)) if (typeof value === "number" && Number.isFinite(value)) mix = Math.imul(mix, 33) + (value | 0) >>> 0;
	return mix;
}
/**
* Cheap identity of one session log. Length, a rolling mix of type/time/usage,
* and the last event distinguish appends and last-writer-wins usage
* replacements without hashing the whole payload.
*/
function logFingerprint(events) {
	let mix = events.length >>> 0;
	for (const event of events) {
		mix = Math.imul(mix, 33) + event.type.length >>> 0;
		mix = Math.imul(mix, 33) + (event.time | 0) >>> 0;
		const turn = event.data.turn;
		const step = event.data.step;
		if (typeof turn === "number") mix = Math.imul(mix, 33) + (turn | 0) >>> 0;
		if (typeof step === "number") mix = Math.imul(mix, 33) + (step | 0) >>> 0;
		mix = Math.imul(mix, 33) + usageMix(event) >>> 0;
	}
	const last = events[events.length - 1];
	return `${events.length}:${mix}:${last?.type ?? ""}:${last?.time ?? 0}:${last?.data.turn ?? ""}:${last?.data.step ?? ""}:${usageMix(last ?? {
		type: "",
		time: 0,
		data: {}
	})}`;
}
/**
* Reuse a session's own fold when the pricing config and log fingerprint match.
* A pricing change drops every entry. Deleted ids are dropped by `retain()`.
*/
var SessionFoldCache = class {
	compute;
	entries = /* @__PURE__ */ new Map();
	pricing = "";
	stats = {
		hits: 0,
		misses: 0
	};
	constructor(compute = foldSession) {
		this.compute = compute;
	}
	get size() {
		return this.entries.size;
	}
	alignPricing(config) {
		const pricing = pricingFingerprint(config);
		if (this.pricing !== "" && this.pricing !== pricing) this.entries.clear();
		this.pricing = pricing;
		return pricing;
	}
	/**
	* Return a previously stored own-fold when the live pricing still matches.
	* Callers that already know the session is not live may skip a durable reread.
	* @param sessionId Durable session id.
	* @param config Live pricing. A different fingerprint clears the cache first.
	* @returns The cached own-fold, or undefined on a miss.
	*/
	peek(sessionId, config) {
		const pricing = this.alignPricing(config);
		const hit = this.entries.get(sessionId);
		if (hit === void 0 || hit.pricing !== pricing) return void 0;
		this.stats.hits += 1;
		return hit.cost;
	}
	/**
	* Return the cached own-fold or compute and store a new one.
	* @param sessionId Durable session id.
	* @param events Complete log used for the fingerprint and, on a miss, the fold.
	* @param config Live pricing. A different fingerprint clears the cache first.
	* @returns The session's own fold, never a parent-merged total.
	*/
	fold(sessionId, events, config) {
		const pricing = this.alignPricing(config);
		const log = logFingerprint(events);
		const hit = this.entries.get(sessionId);
		if (hit !== void 0 && hit.pricing === pricing && hit.log === log) {
			this.stats.hits += 1;
			return hit.cost;
		}
		this.stats.misses += 1;
		const cost = this.compute(events, config);
		this.entries.set(sessionId, {
			pricing,
			log,
			cost
		});
		return cost;
	}
	/** Drop entries whose session is no longer in the listed corpus. */
	retain(sessionIds) {
		const keep = new Set(sessionIds);
		for (const id of this.entries.keys()) if (!keep.has(id)) this.entries.delete(id);
	}
};
//#endregion
//#region src/usage-tap.ts
/**
* Read `reasoning_tokens` from an OpenAI-compat usage object.
* Wanzhao grok keeps this disjoint from `completion_tokens`.
* @param usage Wire `usage` object, or undefined when the chunk has none.
* @returns A positive reasoning count, or 0 when the field is absent.
*/
function reasoningFromWireUsage(usage) {
	if (usage === null || typeof usage !== "object") return 0;
	const raw = usage;
	const completionDetails = object(raw.completion_tokens_details);
	const outputDetails = object(raw.output_tokens_details);
	for (const value of [
		raw.reasoning_tokens,
		completionDetails.reasoning_tokens,
		outputDetails.reasoning_tokens
	]) if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	return 0;
}
/**
* Record reasoning from one wire usage object onto the in-flight tap slot.
* @param slot Request-local slot created around one `llm.stream` call.
* @param usage Wire `usage` object.
*/
function applyWireUsage(slot, usage) {
	const reasoning = reasoningFromWireUsage(usage);
	if (reasoning > 0) slot.reasoningTokens = reasoning;
}
/**
* Scan an SSE buffer for `data:` frames that carry `usage`.
* Incomplete trailing JSON is ignored until more bytes arrive.
* @param buffer Decoded SSE text received so far.
* @param slot Request-local slot to update.
*/
function scanSseBuffer(buffer, slot) {
	for (const line of buffer.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) continue;
		const data = trimmed.slice(5).trim();
		if (data === "" || data === "[DONE]") continue;
		try {
			const payload = JSON.parse(data);
			if (payload.usage !== void 0) applyWireUsage(slot, payload.usage);
		} catch {}
	}
}
/**
* Attach captured reasoning onto a harness usage chunk if the adapter omitted it.
* @param chunk One value yielded by `llm.stream`.
* @param reasoningTokens Captured gateway reasoning count.
* @returns The original chunk, or a shallow copy with `usage.reasoningTokens`.
*/
function attachReasoningToChunk(chunk, reasoningTokens) {
	if (reasoningTokens === void 0 || reasoningTokens <= 0) return chunk;
	if (chunk === null || typeof chunk !== "object") return chunk;
	const typed = chunk;
	if (typed.type !== "usage" || typed.usage === null || typeof typed.usage !== "object") return chunk;
	const usage = typed.usage;
	if (typeof usage.reasoningTokens === "number" && usage.reasoningTokens > 0) return chunk;
	return {
		...typed,
		usage: {
			...usage,
			reasoningTokens
		}
	};
}
/**
* @param input `fetch` input (URL string, URL, or Request).
* @returns Whether this request is an OpenAI-compat completion/response call.
*/
function shouldTapRequest(input) {
	const url = requestUrl(input);
	return url.includes("/chat/completions") || url.includes("/responses");
}
/**
* Pass upstream bytes through unchanged while parsing usage on the same chunks.
* Reasoning is written to `slot` before the official client sees those bytes.
* @param response Upstream `fetch` response. The body is consumed via a wrapper.
* @param slot Request-local slot to update.
* @returns A response with identical status, headers, and body bytes.
*/
function tapFetchResponse(response, slot) {
	if (response.body === null) return response;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const stream = new ReadableStream({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				buffer += decoder.decode();
				ingestBuffer(buffer, slot);
				controller.close();
				return;
			}
			buffer += decoder.decode(value, { stream: true });
			ingestBuffer(buffer, slot);
			controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		}
	});
	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}
/**
* Wrap `globalThis.fetch` so in-flight `llm.stream` calls can see gateway usage.
* Responses outside an active tap slot, or to other URLs, pass through untouched.
* @param slots Active stream slots. Async generators drop AsyncLocalStorage
*   across `await`, so the fetch tap reads this stack, not ALS alone.
* @returns Disposer that restores the previous `fetch`.
*/
function installFetchTap(slots) {
	const original = globalThis.fetch;
	if (typeof original !== "function") return () => {};
	const tapped = async (input, init) => {
		const response = await original(input, init);
		const store = slots.at(-1);
		if (store === void 0 || !shouldTapRequest(input)) return response;
		return tapFetchResponse(response, store);
	};
	globalThis.fetch = tapped;
	return () => {
		if (globalThis.fetch === tapped) globalThis.fetch = original;
	};
}
function popSlot(slots, store) {
	const index = slots.lastIndexOf(store);
	if (index >= 0) slots.splice(index, 1);
}
/**
* Wrap `llm.stream` so each call has a tap slot and usage chunks carry reasoning.
* The slot stays on the stack until the iterator settles so `fetch` inside an
* async generator still sees it. AsyncLocalStorage does not survive that hop.
* @param stream Original `llm.stream` bound to the service.
* @param slots Active stream slots read by the fetch tap.
* @returns A replacement `stream` with the same call signature.
*/
function wrapLlmStream(stream, slots) {
	return (options) => {
		const store = {};
		slots.push(store);
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			popSlot(slots, store);
		};
		let inner;
		try {
			inner = stream(options);
		} catch (error) {
			release();
			throw error;
		}
		return { [Symbol.asyncIterator]() {
			const iterator = inner[Symbol.asyncIterator]();
			return {
				next: async () => {
					try {
						const result = await iterator.next();
						if (result.done) {
							release();
							return result;
						}
						return {
							done: false,
							value: attachReasoningToChunk(result.value, store.reasoningTokens)
						};
					} catch (error) {
						release();
						throw error;
					}
				},
				return: async (value) => {
					try {
						return await (iterator.return?.(value) ?? Promise.resolve({
							done: true,
							value
						}));
					} finally {
						release();
					}
				},
				throw: async (error) => {
					try {
						return await (iterator.throw?.(error) ?? Promise.reject(error));
					} finally {
						release();
					}
				}
			};
		} };
	};
}
/**
* Wrap `llm.prepareCall` so the one-shot stream the agent loop actually
* iterates also carries the fetch-tap slot. `preparedCall.stream` bypasses
* `llm.stream`; wrapping only the latter leaves grok reasoning off the log.
* @param prepareCall Original `llm.prepareCall` bound to the service.
* @param slots Active stream slots read by the fetch tap.
* @returns A replacement `prepareCall` that taps the returned stream.
*/
function wrapPrepareCall(prepareCall, slots) {
	return async (config, signal) => {
		const prepared = await prepareCall(config, signal);
		if (prepared === null || typeof prepared !== "object" || typeof prepared.stream !== "function") return prepared;
		return {
			...prepared,
			stream: wrapLlmStream(prepared.stream.bind(prepared), slots)
		};
	};
}
/**
* Install the fetch tap and wrap `ctx.llm.stream` plus `ctx.llm.prepareCall`.
* The agent loop dispatches through `preparedCall.stream`; title and
* compaction still use `llm.stream`. Both must enter the same tap slot.
* @param ctx Host context. `llm` is optional so tests without it still load.
* @returns Disposer that unwraps fetch, `llm.stream`, and `llm.prepareCall`.
*/
function installUsageTap(ctx) {
	const slots = [];
	const restoreFetch = installFetchTap(slots);
	let restoreLlm = () => {};
	ctx.inject(["llm"], (inner) => {
		const llm = inner.llm;
		if (llm === void 0) return;
		const restorers = [];
		if (typeof llm.stream === "function") {
			const original = llm.stream;
			llm.stream = wrapLlmStream(original.bind(llm), slots);
			restorers.push(() => {
				llm.stream = original;
			});
		}
		if (typeof llm.prepareCall === "function") {
			const original = llm.prepareCall;
			llm.prepareCall = wrapPrepareCall(original.bind(llm), slots);
			restorers.push(() => {
				llm.prepareCall = original;
			});
		}
		restoreLlm = () => {
			for (const restore of restorers) restore();
		};
	});
	return () => {
		restoreLlm();
		restoreFetch();
	};
}
function object(value) {
	return value !== null && typeof value === "object" ? value : {};
}
function requestUrl(input) {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	if (input !== null && typeof input === "object" && "url" in input) return String(input.url);
	return "";
}
function ingestBuffer(buffer, slot) {
	scanSseBuffer(buffer, slot);
	const trimmed = buffer.trim();
	if (!trimmed.startsWith("{")) return;
	try {
		applyWireUsage(slot, JSON.parse(trimmed).usage);
	} catch {}
}
//#endregion
//#region src/index.ts
/**
* Settings schema admits both the current group document and the previous
* default/models document, then stores the normalized group form.
*
* The root is declared `volatile()` so the harness settings service projects
* the whole pricing document as this entry's live settings page (the namespace
* is the profile entry id, `cost-meter`) and writes reach the running
* references without remounting the plugin.
*/
const Config = z.transform(z.any(), (value) => {
	const normalized = normalizePricing(value ?? {});
	validatePricing(normalized);
	return normalized;
}).volatile();
const SETTINGS_NS = "cost-meter";
/**
* Read one profile entry's resolved settings value through the harness
* settings service. The pre-`0.1.7` `settings.get(ns)` reader was removed, so
* cross-namespace reads now go through `describe()`.
*/
function settingsValue(ctx, ns) {
	return ctx.get("settings")?.describe?.().find((row) => row.ns === ns)?.value;
}
function subagentChildren(records) {
	const children = /* @__PURE__ */ new Map();
	for (const record of records) {
		const parent = record.header.parentSession;
		if (parent === void 0 || record.header.origin !== "subagent") continue;
		const ids = children.get(parent);
		if (ids === void 0) children.set(parent, [record.header.id]);
		else ids.push(record.header.id);
	}
	return children;
}
function resolveEvents(sessionId, sessions, query) {
	const live = sessions?.get(sessionId)?.snapshotEvents();
	if (live !== void 0) return live;
	if (query === void 0) return void 0;
	return query.readSession(sessionId).then((snapshot) => snapshot.events);
}
async function foldOwnSession(sessionId, events, config, store) {
	return store === void 0 ? foldSession(events, config) : store.fold(sessionId, events, config);
}
async function ownFoldFor(sessionId, config, sessions, query, store) {
	const live = sessions?.get(sessionId)?.snapshotEvents();
	if (live === void 0 && store?.peek !== void 0) {
		const cached = store.peek(sessionId, config);
		if (cached !== void 0) return cached;
	}
	const events = live ?? await resolveEvents(sessionId, void 0, query);
	if (events === void 0) return void 0;
	return foldOwnSession(sessionId, events, config, store);
}
async function readSubagentTree(query, children, sessionId, config, seen, sessions, store) {
	const ids = children.get(sessionId) ?? [];
	const rows = [];
	for (const id of ids) {
		if (seen.has(id)) continue;
		seen.add(id);
		const cost = await ownFoldFor(id, config, sessions, query, store);
		if (cost === void 0) continue;
		rows.push({
			...cost,
			sessionId: id,
			children: await readSubagentTree(query, children, id, config, seen, sessions, store)
		});
	}
	return rows;
}
function mergeCostInto(target, cost) {
	target.cost += cost.cost;
	target.inputCost += cost.inputCost;
	target.cacheReadCost += cost.cacheReadCost;
	target.cacheWriteCost += cost.cacheWriteCost;
	target.outputCost += cost.outputCost;
	target.inputTokens += cost.inputTokens;
	target.cacheReadTokens += cost.cacheReadTokens;
	target.cacheWriteTokens += cost.cacheWriteTokens;
	target.outputTokens += cost.outputTokens;
	target.details.push(...cost.details);
}
/**
* Fold every listed session independently.
* @param query Durable session listing/read face, or undefined when the host has none.
* @param config Live pricing used for every session.
* @param store Optional own-fold cache. Hits reuse the previous fold for an unchanged log and pricing.
* @param sessions Optional live session map. Live events take precedence over a durable read.
* @returns Listed sessions in original order, skipping duplicate ids and unreadable logs. A listing failure returns [].
*/
async function collectSessionCosts(query, config, store, sessions) {
	if (query === void 0) return [];
	let records;
	try {
		records = await query.listSessions();
	} catch {
		return [];
	}
	const seen = /* @__PURE__ */ new Set();
	const rows = [];
	for (const record of records) {
		const sessionId = record.header.id;
		if (sessionId === "" || seen.has(sessionId)) continue;
		seen.add(sessionId);
		let cost;
		try {
			cost = await ownFoldFor(sessionId, config, sessions, query, store);
		} catch {
			continue;
		}
		if (cost === void 0) continue;
		rows.push({
			sessionId,
			parentSession: record.header.parentSession ?? null,
			origin: record.header.origin ?? null,
			cost
		});
	}
	store?.retain?.(seen);
	return rows;
}
function mergeCosts(primary, subagents) {
	const out = structuredClone(primary);
	out.subagents = structuredClone([...subagents]);
	const visit = (rows) => {
		for (const row of rows) {
			mergeCostInto(out, row);
			visit(row.children);
		}
	};
	visit(subagents);
	return out;
}
/** Typert Remote service exposing the cumulative cost of one session. */
var CostMeterService = class extends TypertRemoteService {
	static Config = Config;
	static inject = ["settings"];
	folds = new SessionFoldCache();
	inflightCosts = /* @__PURE__ */ new Map();
	inflightOverview;
	constructor(ctx) {
		super(ctx, "costMeter");
		ctx.effect(() => installUsageTap(ctx));
	}
	/** Compute one session's cost together with every descendant subagent session. */
	async sessionCost(sessionId) {
		if (typeof sessionId !== "string" || sessionId.length === 0) return null;
		const pending = this.inflightCosts.get(sessionId);
		if (pending !== void 0) return pending;
		const work = this.computeSessionCost(sessionId).finally(() => {
			if (this.inflightCosts.get(sessionId) === work) this.inflightCosts.delete(sessionId);
		});
		this.inflightCosts.set(sessionId, work);
		return work;
	}
	/** Fold every listed session independently for the all-session overview. */
	async sessionCosts() {
		if (this.inflightOverview !== void 0) return this.inflightOverview;
		const work = this.computeSessionCosts().finally(() => {
			if (this.inflightOverview === work) this.inflightOverview = void 0;
		});
		this.inflightOverview = work;
		return work;
	}
	async computeSessionCost(sessionId) {
		const sessions = this.ctx.get("sessions");
		const query = this.ctx.get("sessionQuery");
		const pricing = settingsValue(this.ctx, SETTINGS_NS);
		const config = normalizePricing(pricing ?? DEFAULT_PRICING);
		const cost = await ownFoldFor(sessionId, config, sessions, query, this.folds);
		if (cost === void 0) return null;
		if (query === void 0) return cost;
		return mergeCosts(cost, await readSubagentTree(query, subagentChildren(await query.listSessions()), sessionId, config, /* @__PURE__ */ new Set([sessionId]), sessions, this.folds));
	}
	async computeSessionCosts() {
		const query = this.ctx.get("sessionQuery");
		const sessions = this.ctx.get("sessions");
		const pricing = settingsValue(this.ctx, SETTINGS_NS);
		return collectSessionCosts(query, normalizePricing(pricing ?? DEFAULT_PRICING), this.folds, sessions);
	}
	/** Remaining balance once per gateway origin; failed origins are omitted. */
	async providerBalances() {
		const credentials = this.ctx.get("credentials");
		const providers = settingsValue(this.ctx, "llm-pi-ai")?.providers;
		return collectProviderBalances({
			providers,
			credentials
		});
	}
};
//#endregion
export { Config, DEFAULT_GROUP, DEFAULT_PRICING, SessionFoldCache, activityText, applyPeriodClock, applyWireUsage, assignmentWithManualMultiplier, assignmentWithObservedMultiplier, attachReasoningToChunk, averageUnitPrice, billedOutputTokens, billingProbeURL, clockTime, collapseBalanceChips, collectProviderBalances, collectSessionCosts, contextTokensOf, costTableColumnValues, costTableTotals, CostMeterService as default, defaultChildCostTableSort, defaultCostTableSort, defaultVisibleCostColumns, discountMultiplierAt, displayCellText, filterCostTableRows, filterHourlyEntries, filterSessionRows, flattenCostTableRows, flattenHourlyEntries, foldSession, formatCacheRatedCost, formatContextSurcharge, formatMoneyAmount, formatRatedCost, formatTokenThreshold, formatUnitTokensLabel, formatUsageCell, gatewayOrigin, groupCostTableRows, groupDailyOverview, groupHourlyEntries, groupProviderBalanceTargetsByOrigin, installUsageTap, isNumericCostTableColumn, isPeriodAllDay, lastProbeAt, lastUpdatedAt, listProviderBalanceTargets, localDateOfHour, localTodayDate, logFingerprint, mapWithConcurrency, mergeListedSessionCost, metricCost, metricTokens, modelsURL, multiplierHistoryRows, nextBillingProbeDue, normalizePricing, normalizeUsage, optionalCostTableColumns, overviewCost, parseBillingMultiplier, parseProviderBalance, periodDays, pricingFingerprint, probeProviderAvailability, probeProviderBalance, queryCostTable, queryCostTableGroups, queryDailyOverview, queryHourlyOverview, querySessionRows, reasoningFromWireUsage, resolveContextMultiplier, resolveContextSurcharge, resolvePricing, resolveReasoningExtra, resolveVisibleCostColumns, routeKey, routesForProvider, rowTotalTokens, scanSseBuffer, sessionRoutes, sessionTotalTokens, sharedContextSurcharge, shouldRemoveUnavailableProvider, shouldTapRequest, sortCostTableRows, sortSessionRows, sumHourlySlices, tapFetchResponse, toggleCostTableSort, togglePeriodAllDay, toggleSessionTableSort, usageURL, validatePricing, walletHref, wrapLlmStream, wrapPrepareCall };
