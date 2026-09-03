window.__ModuleLoader__.load({
	id: "dsh-cost-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/pricing.ts
		const DEFAULT_GROUP = {
			id: "default",
			name: "默认",
			input: 1,
			output: 2,
			cacheReadMultiplier: .02,
			cacheWriteMultiplier: 1,
			periods: [],
			contextSurcharges: []
		};
		const DEFAULT_PRICING = {
			currency: "CNY",
			unitTokens: 1e6,
			timezone: "Asia/Shanghai",
			groups: [DEFAULT_GROUP],
			models: {},
			billingProbe: {
				enabled: false,
				intervalMinutes: 30,
				timeoutMs: 1e4,
				concurrency: 2
			}
		};
		const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
		const END_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
		const ALL_WEEKDAYS = [
			1,
			2,
			3,
			4,
			5,
			6,
			7
		];
		const DEFAULT_GROUP_ID = "default";
		function minuteOfDay(value) {
			if (value === "24:00") return 1440;
			const [hour, minute] = value.split(":").map(Number);
			return hour * 60 + minute;
		}
		/** ISO weekdays a period matches; omitted or empty means every day. */
		function periodDays(period) {
			return period.days !== void 0 && period.days.length > 0 ? period.days : ALL_WEEKDAYS;
		}
		function finiteOr(value, fallback) {
			return value !== void 0 && Number.isFinite(value) ? value : fallback;
		}
		/** One when the multiplier is omitted, empty, or non-finite. */
		function multiplierOrOne(value) {
			return value !== void 0 && Number.isFinite(value) ? value : 1;
		}
		/** Latest automatic-probe timestamp on one model assignment, or null when none. */
		function lastProbeAt(assignment) {
			if (assignment?.lastProbedAt !== void 0 && Number.isFinite(assignment.lastProbedAt) && assignment.lastProbedAt > 0) return assignment.lastProbedAt;
			const history = assignment?.discountMultiplierHistory ?? [];
			for (let index = history.length - 1; index >= 0; index -= 1) {
				const entry = history[index];
				if (entry.source === "manual") continue;
				if (entry.effectiveAt > 0 && (entry.source === "probe" || entry.source === void 0)) return entry.effectiveAt;
			}
			return null;
		}
		/** Dated discount-multiplier changes, newest last. Baseline `effectiveAt: 0` is omitted. */
		function multiplierHistoryRows(assignment) {
			return (assignment?.discountMultiplierHistory ?? []).filter((entry) => Number.isFinite(entry.effectiveAt) && entry.effectiveAt > 0);
		}
		/** Latest probe or dated multiplier change, or null when none. */
		function lastUpdatedAt(assignment) {
			const times = [lastProbeAt(assignment), multiplierHistoryRows(assignment).at(-1)?.effectiveAt].filter((value) => value !== void 0 && value !== null && value > 0);
			return times.length === 0 ? null : Math.max(...times);
		}
		/** Compact a token threshold for UI labels, e.g. 200000 → `200K`. */
		function formatTokenThreshold(tokens) {
			if (Number.isSafeInteger(tokens) && tokens >= 1e6 && tokens % 1e6 === 0) return `${tokens / 1e6}M`;
			if (Number.isSafeInteger(tokens) && tokens >= 1e3 && tokens % 1e3 === 0) return `${tokens / 1e3}K`;
			return tokens.toLocaleString("zh-CN");
		}
		function formatContextSurcharge(afterTokens, multiplier) {
			if (multiplier === void 0 || multiplier === null || multiplier === 1) return null;
			if (afterTokens === void 0 || afterTokens === null) return `×${multiplier}`;
			return `超过 ${formatTokenThreshold(afterTokens)} ×${multiplier}`;
		}
		function assertNonNegative(value, path) {
			if (!Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be a non-negative finite number`);
		}
		function minuteSegments(period) {
			const start = minuteOfDay(period.start);
			const end = minuteOfDay(period.end);
			if (start === end) return [[0, 1440]];
			return start < end ? [[start, end]] : [[start, 1440], [0, end]];
		}
		function daysOverlap(left, right) {
			const rightDays = new Set(periodDays(right));
			return periodDays(left).some((day) => rightDays.has(day));
		}
		function overlaps(left, right) {
			if (!daysOverlap(left, right)) return false;
			return minuteSegments(left).some(([leftStart, leftEnd]) => minuteSegments(right).some(([rightStart, rightEnd]) => Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd)));
		}
		function assertDays(days, path) {
			if (days === void 0) return;
			if (!Array.isArray(days) || days.length === 0) throw new TypeError(`${path}.days must be omitted or contain ISO weekdays 1-7`);
			const seen = /* @__PURE__ */ new Set();
			for (const day of days) {
				if (!Number.isInteger(day) || day < 1 || day > 7 || seen.has(day)) throw new TypeError(`${path}.days must be unique ISO weekdays 1-7`);
				seen.add(day);
			}
		}
		function assertPeriods(periods, path) {
			if (periods === void 0) return;
			const ids = /* @__PURE__ */ new Set();
			for (const [index, period] of periods.entries()) {
				const itemPath = `${path}[${index}]`;
				if (period.id.trim() === "" || ids.has(period.id)) throw new TypeError(`${itemPath}.id must be unique and non-empty`);
				ids.add(period.id);
				if (period.name.trim() === "") throw new TypeError(`${itemPath}.name is required`);
				if (!TIME_PATTERN.test(period.start) || !END_TIME_PATTERN.test(period.end)) throw new TypeError(`${itemPath} must use HH:mm start and HH:mm or 24:00 end times`);
				assertNonNegative(period.multiplier, `${itemPath}.multiplier`);
				assertDays(period.days, itemPath);
			}
			for (let left = 0; left < periods.length; left += 1) for (let right = left + 1; right < periods.length; right += 1) if (overlaps(periods[left], periods[right])) throw new TypeError(`${path} contains overlapping periods`);
		}
		function assertContextSurcharges(tiers, path) {
			if (tiers === void 0) return;
			const thresholds = /* @__PURE__ */ new Set();
			for (const [index, tier] of tiers.entries()) {
				const itemPath = `${path}[${index}]`;
				if (!Number.isSafeInteger(tier.afterTokens) || tier.afterTokens < 0) throw new TypeError(`${itemPath}.afterTokens must be a non-negative safe integer`);
				if (thresholds.has(tier.afterTokens)) throw new TypeError(`${path} contains duplicate afterTokens`);
				thresholds.add(tier.afterTokens);
				assertNonNegative(tier.multiplier, `${itemPath}.multiplier`);
			}
		}
		function slugify(value) {
			const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
			return slug === "" ? "group" : slug.slice(0, 40);
		}
		function uniqueId(base, used) {
			if (!used.has(base)) {
				used.add(base);
				return base;
			}
			let index = 2;
			while (used.has(`${base}-${index}`)) index += 1;
			const id = `${base}-${index}`;
			used.add(id);
			return id;
		}
		function periodMultiplierOf(period, base) {
			if (period.multiplier !== void 0 && Number.isFinite(period.multiplier)) return period.multiplier;
			const rates = period.rates;
			if (rates === void 0) return 1;
			if (rates.input !== void 0 && Number.isFinite(rates.input) && base.input > 0) return rates.input / base.input;
			if (rates.output !== void 0 && Number.isFinite(rates.output) && base.output > 0) return rates.output / base.output;
			const ratios = [];
			for (const key of ["cacheRead", "cacheWrite"]) {
				const value = rates[key];
				const denom = base[key];
				if (value === void 0 || !Number.isFinite(value) || denom <= 0) continue;
				ratios.push(value / denom);
			}
			if (ratios.length === 0) return 1;
			return ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
		}
		function normalizeDays(days) {
			if (!Array.isArray(days)) return void 0;
			const unique = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((left, right) => left - right);
			return unique.length === 0 || unique.length === ALL_WEEKDAYS.length ? void 0 : unique;
		}
		function normalizePeriod(period, multiplier) {
			const days = normalizeDays(period.days);
			return {
				id: period.id,
				name: period.name,
				start: period.start,
				end: period.end,
				multiplier,
				...days !== void 0 ? { days } : {}
			};
		}
		function normalizePeriods(periods, base) {
			if (periods === void 0) return [];
			return periods.map((period) => normalizePeriod(period, periodMultiplierOf(period, base)));
		}
		function tokenRatesOf(partial, fallback) {
			return {
				input: finiteOr(partial?.input, fallback.input),
				cacheRead: finiteOr(partial?.cacheRead, fallback.cacheRead),
				cacheWrite: finiteOr(partial?.cacheWrite, fallback.cacheWrite),
				output: finiteOr(partial?.output, fallback.output)
			};
		}
		function ratio(numerator, denominator) {
			if (denominator <= 0) return 0;
			return Number((numerator / denominator).toPrecision(12));
		}
		function groupFromRates(id, name, rates, periods, contextSurcharges) {
			const input = rates.input;
			return {
				id,
				name,
				input,
				output: rates.output,
				cacheReadMultiplier: ratio(rates.cacheRead, input),
				cacheWriteMultiplier: ratio(rates.cacheWrite, input),
				periods,
				contextSurcharges: contextSurcharges ?? []
			};
		}
		function sameGroup(left, right) {
			return left.input === right.input && left.output === right.output && left.cacheReadMultiplier === right.cacheReadMultiplier && left.cacheWriteMultiplier === right.cacheWriteMultiplier && JSON.stringify(left.periods ?? []) === JSON.stringify(right.periods ?? []) && JSON.stringify(left.contextSurcharges ?? []) === JSON.stringify(right.contextSurcharges ?? []);
		}
		function assignmentFromPlan(plan, groupId) {
			const assignment = { groupId };
			if (plan.discountMultiplier !== void 0) assignment.discountMultiplier = plan.discountMultiplier;
			if (plan.discountMultiplierHistory !== void 0) assignment.discountMultiplierHistory = [...plan.discountMultiplierHistory].sort((left, right) => left.effectiveAt - right.effectiveAt);
			if (plan.lastProbedAt !== void 0) assignment.lastProbedAt = plan.lastProbedAt;
			if (plan.modelMultiplier !== void 0) assignment.modelMultiplier = plan.modelMultiplier;
			if (plan.reasoningExtra !== void 0) assignment.reasoningExtra = plan.reasoningExtra;
			return assignment;
		}
		/**
		* Accept the current group/assignment document and the previous
		* default/models absolute-rate document. Always returns a group-based config.
		*/
		function normalizePricing(raw) {
			const input = raw !== null && typeof raw === "object" ? raw : {};
			const currency = typeof input.currency === "string" && input.currency.trim() !== "" ? input.currency : DEFAULT_PRICING.currency;
			const unitTokens = Number.isSafeInteger(input.unitTokens) && (input.unitTokens ?? 0) >= 1 ? input.unitTokens : DEFAULT_PRICING.unitTokens;
			const timezone = typeof input.timezone === "string" && input.timezone.trim() !== "" ? input.timezone : DEFAULT_PRICING.timezone;
			const rawProbe = input.billingProbe;
			const billingProbe = rawProbe !== null && typeof rawProbe === "object" ? {
				enabled: rawProbe.enabled === true,
				intervalMinutes: rawProbe.intervalMinutes ?? 30,
				timeoutMs: rawProbe.timeoutMs ?? 1e4,
				concurrency: rawProbe.concurrency ?? 2,
				providers: Array.isArray(rawProbe.providers) ? [...rawProbe.providers] : void 0
			} : DEFAULT_PRICING.billingProbe;
			if (Array.isArray(input.groups) && input.groups.length > 0) {
				const groups = input.groups.map((group) => ({
					...group,
					periods: (group.periods ?? []).map((period) => normalizePeriod(period, multiplierOrOne(period.multiplier))),
					contextSurcharges: group.contextSurcharges ?? []
				}));
				const models = {};
				for (const [key, plan] of Object.entries(input.models ?? {})) {
					if (plan === void 0) continue;
					models[key] = assignmentFromPlan(plan, plan.groupId ?? DEFAULT_GROUP_ID);
				}
				return {
					currency,
					unitTokens,
					timezone,
					groups,
					models,
					billingProbe
				};
			}
			const fallbackRates = DEFAULT_GROUP;
			const defaultRates = tokenRatesOf(input.default?.rates, {
				input: fallbackRates.input,
				cacheRead: fallbackRates.input * fallbackRates.cacheReadMultiplier,
				cacheWrite: fallbackRates.input * fallbackRates.cacheWriteMultiplier,
				output: fallbackRates.output
			});
			const defaultGroup = groupFromRates(DEFAULT_GROUP_ID, "默认", defaultRates, normalizePeriods(input.default?.periods, defaultRates), input.default?.contextSurcharges);
			const groups = [defaultGroup];
			const used = /* @__PURE__ */ new Set([DEFAULT_GROUP_ID]);
			const models = {};
			for (const [key, plan] of Object.entries(input.models ?? {})) {
				if (plan === void 0) continue;
				const rates = tokenRatesOf(plan.rates, defaultRates);
				const periods = plan.periods === void 0 || plan.periods.length === 0 ? defaultGroup.periods ?? [] : normalizePeriods(plan.periods, rates);
				const contextSurcharges = plan.contextSurcharges ?? defaultGroup.contextSurcharges;
				const candidate = groupFromRates(uniqueId(slugify(key), used), key, rates, periods, contextSurcharges);
				const existing = groups.find((group) => sameGroup(group, candidate));
				if (existing !== void 0) {
					used.delete(candidate.id);
					models[key] = assignmentFromPlan(plan, existing.id);
					continue;
				}
				groups.push(candidate);
				models[key] = assignmentFromPlan(plan, candidate.id);
			}
			return {
				currency,
				unitTokens,
				timezone,
				groups,
				models,
				billingProbe
			};
		}
		function assertGroup(group, path) {
			if (group.id.trim() === "") throw new TypeError(`${path}.id must be non-empty`);
			if (group.name.trim() === "") throw new TypeError(`${path}.name is required`);
			assertNonNegative(group.input, `${path}.input`);
			assertNonNegative(group.output, `${path}.output`);
			assertNonNegative(group.cacheReadMultiplier, `${path}.cacheReadMultiplier`);
			assertNonNegative(group.cacheWriteMultiplier, `${path}.cacheWriteMultiplier`);
			assertPeriods(group.periods, `${path}.periods`);
			assertContextSurcharges(group.contextSurcharges, `${path}.contextSurcharges`);
		}
		function validatePricing(config) {
			for (const [index, group] of (config.groups ?? []).entries()) assertPeriods(group.periods, `groups[${index}].periods`);
			config = normalizePricing(config);
			if (config.currency.trim() === "" || config.currency.length > 8) throw new TypeError("currency must contain 1-8 characters");
			if (!Number.isSafeInteger(config.unitTokens) || config.unitTokens < 1) throw new TypeError("unitTokens must be a positive safe integer");
			try {
				new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format(0);
			} catch {
				throw new TypeError(`timezone "${config.timezone}" is not an IANA time zone`);
			}
			const probe = config.billingProbe;
			if (probe !== void 0) {
				if (typeof probe.enabled !== "boolean") throw new TypeError("billingProbe.enabled must be boolean");
				if (probe.intervalMinutes !== void 0 && (!Number.isSafeInteger(probe.intervalMinutes) || probe.intervalMinutes < 5 || probe.intervalMinutes > 1440)) throw new TypeError("billingProbe.intervalMinutes must be an integer from 5 to 1440");
				if (probe.timeoutMs !== void 0 && (!Number.isSafeInteger(probe.timeoutMs) || probe.timeoutMs < 1e3 || probe.timeoutMs > 6e4)) throw new TypeError("billingProbe.timeoutMs must be an integer from 1000 to 60000");
				if (probe.concurrency !== void 0 && (!Number.isSafeInteger(probe.concurrency) || probe.concurrency < 1 || probe.concurrency > 8)) throw new TypeError("billingProbe.concurrency must be an integer from 1 to 8");
				if (probe.providers !== void 0 && (!Array.isArray(probe.providers) || probe.providers.some((provider) => typeof provider !== "string" || provider.trim() === ""))) throw new TypeError("billingProbe.providers must contain non-empty strings");
			}
			if (!Array.isArray(config.groups) || config.groups.length === 0) throw new TypeError("groups must contain at least one pricing group");
			const ids = /* @__PURE__ */ new Set();
			for (const [index, group] of config.groups.entries()) {
				const path = `groups[${index}]`;
				if (ids.has(group.id)) throw new TypeError(`${path}.id "${group.id}" is not unique`);
				ids.add(group.id);
				assertGroup(group, path);
			}
			for (const [key, assignment] of Object.entries(config.models)) {
				if (key.trim() === "" || !key.includes("/")) throw new TypeError(`model key "${key}" must be provider/model`);
				if (assignment.groupId === void 0 || assignment.groupId.trim() === "" || !ids.has(assignment.groupId)) throw new TypeError(`models.${key}.groupId "${assignment.groupId}" does not match a pricing group`);
				if (assignment.discountMultiplier !== void 0) assertNonNegative(assignment.discountMultiplier, `models.${key}.discountMultiplier`);
				let previousEffectiveAt = -1;
				for (const [index, entry] of (assignment.discountMultiplierHistory ?? []).entries()) {
					if (!Number.isSafeInteger(entry.effectiveAt) || entry.effectiveAt < 0 || entry.effectiveAt <= previousEffectiveAt) throw new TypeError(`models.${key}.discountMultiplierHistory[${index}].effectiveAt must be strictly increasing epoch milliseconds`);
					assertNonNegative(entry.discountMultiplier, `models.${key}.discountMultiplierHistory[${index}].discountMultiplier`);
					if (entry.source !== void 0 && entry.source !== "probe" && entry.source !== "manual") throw new TypeError(`models.${key}.discountMultiplierHistory[${index}].source must be probe or manual`);
					previousEffectiveAt = entry.effectiveAt;
				}
				if (assignment.discountMultiplierHistory !== void 0 && !Array.isArray(assignment.discountMultiplierHistory)) throw new TypeError(`models.${key}.discountMultiplierHistory must be an array`);
				if (assignment.lastProbedAt !== void 0 && (!Number.isSafeInteger(assignment.lastProbedAt) || assignment.lastProbedAt < 0)) throw new TypeError(`models.${key}.lastProbedAt must be a non-negative epoch millisecond`);
				if (assignment.modelMultiplier !== void 0) assertNonNegative(assignment.modelMultiplier, `models.${key}.modelMultiplier`);
			}
		}
		//#endregion
		//#region src/session-table.ts
		/** Pure session-overview query helpers shared by the host tests and the dock UI. */
		/** Combine one listed session with its independently folded cost. */
		function mergeListedSessionCost(item, cost) {
			return {
				sessionId: item.sessionId,
				parentSession: item.parentSessionId ?? null,
				origin: item.origin ?? null,
				cost
			};
		}
		function routeLabel(provider, model) {
			if (provider && model) return `${provider}/${model}`;
			return model ?? provider ?? null;
		}
		/** Map items with a bounded number of in-flight promises, preserving input order. */
		async function mapWithConcurrency(items, concurrency, mapper) {
			const limit = Math.max(1, Math.min(items.length, Math.floor(concurrency) || 1));
			const results = new Array(items.length);
			let next = 0;
			const worker = async () => {
				while (next < items.length) {
					const index = next;
					next += 1;
					results[index] = await mapper(items[index], index);
				}
			};
			await Promise.all(Array.from({ length: limit }, () => worker()));
			return results;
		}
		function emptyHourlySlice(hour = "", hourLabel = "") {
			return {
				hour,
				hourLabel,
				turns: 0,
				steps: 0,
				toolCalls: 0,
				inputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 0,
				inputCost: 0,
				cacheReadCost: 0,
				cacheWriteCost: 0,
				outputCost: 0,
				cost: 0,
				cacheRate: 0,
				model: null,
				provider: null,
				periodName: null,
				groupId: null,
				groupName: null
			};
		}
		/** Local calendar date of an hourly ISO bucket. */
		function localDateOfHour(hour) {
			const date = new Date(hour);
			if (Number.isNaN(date.getTime())) return "";
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		}
		function hourlyRoute(entry) {
			return routeLabel(entry.provider, entry.model);
		}
		function asHourlySlice(value) {
			if (typeof value.hour !== "string" || value.hour === "") return null;
			return {
				hour: value.hour,
				hourLabel: value.hourLabel ?? value.hour,
				turns: value.turns ?? 0,
				steps: value.steps ?? 0,
				toolCalls: value.toolCalls ?? 0,
				inputTokens: value.inputTokens ?? 0,
				cacheReadTokens: value.cacheReadTokens ?? 0,
				cacheWriteTokens: value.cacheWriteTokens ?? 0,
				outputTokens: value.outputTokens ?? 0,
				inputCost: value.inputCost ?? 0,
				cacheReadCost: value.cacheReadCost ?? 0,
				cacheWriteCost: value.cacheWriteCost ?? 0,
				outputCost: value.outputCost ?? 0,
				cost: value.cost ?? 0,
				cacheRate: value.cacheRate ?? 0,
				model: value.model ?? null,
				provider: value.provider ?? null,
				periodName: value.periodName ?? null,
				groupId: value.groupId ?? null,
				groupName: value.groupName ?? null,
				contextMultiplier: value.contextMultiplier,
				contextAfterTokens: value.contextAfterTokens ?? null,
				rates: value.rates ?? null
			};
		}
		/** Flatten each session's own hourly buckets; parent rows do not include child sessions. */
		function flattenHourlyEntries(rows) {
			const entries = [];
			for (const row of rows) for (const hourly of row.cost.hourly ?? []) {
				const entry = asHourlySlice(hourly);
				if (entry === null) continue;
				entries.push({
					sessionId: row.sessionId,
					origin: row.origin,
					parentSession: row.parentSession,
					entry
				});
			}
			return entries;
		}
		function filterHourlyEntries(entries, filter) {
			const sessionId = filter.sessionId.trim().toLowerCase();
			return entries.filter((item) => {
				if (filter.date && localDateOfHour(item.entry.hour) !== filter.date) return false;
				if (filter.hour && item.entry.hour !== filter.hour && item.entry.hourLabel !== filter.hour) return false;
				if (sessionId && !item.sessionId.toLowerCase().includes(sessionId)) return false;
				if (filter.origin && (item.origin ?? "") !== filter.origin) return false;
				const route = hourlyRoute(item.entry);
				if (filter.route && route !== filter.route) return false;
				return true;
			});
		}
		function sumHourlySlices(rows, hour = "", hourLabel = "") {
			const out = emptyHourlySlice(hour, hourLabel);
			for (const row of rows) {
				out.turns += row.turns;
				out.steps += row.steps;
				out.toolCalls += row.toolCalls;
				out.inputTokens += row.inputTokens;
				out.cacheReadTokens += row.cacheReadTokens;
				out.cacheWriteTokens += row.cacheWriteTokens;
				out.outputTokens += row.outputTokens;
				out.inputCost += row.inputCost;
				out.cacheReadCost += row.cacheReadCost;
				out.cacheWriteCost += row.cacheWriteCost;
				out.outputCost += row.outputCost;
				out.cost += row.cost;
			}
			const totalTokens = out.inputTokens + out.cacheReadTokens + out.cacheWriteTokens + out.outputTokens;
			out.cacheRate = totalTokens > 0 ? (out.cacheReadTokens + out.cacheWriteTokens) / totalTokens : 0;
			return out;
		}
		/** Group flattened hourly entries by time bucket, newest hour last. */
		function groupHourlyEntries(entries) {
			const groups = /* @__PURE__ */ new Map();
			for (const item of entries) {
				const existing = groups.get(item.entry.hour);
				if (existing === void 0) {
					groups.set(item.entry.hour, {
						hour: item.entry.hour,
						hourLabel: item.entry.hourLabel,
						sessions: [item],
						totals: emptyHourlySlice(item.entry.hour, item.entry.hourLabel)
					});
					continue;
				}
				existing.sessions.push(item);
			}
			return [...groups.values()].sort((left, right) => left.hour.localeCompare(right.hour)).map((group) => ({
				...group,
				totals: sumHourlySlices(group.sessions.map((item) => item.entry), group.hour, group.hourLabel)
			}));
		}
		function queryHourlyOverview(rows, filter) {
			return groupHourlyEntries(filterHourlyEntries(flattenHourlyEntries(rows), filter));
		}
		/** Local calendar date of an epoch millisecond, or the current time when omitted. */
		function localTodayDate(now = Date.now()) {
			return localDateOfHour(new Date(now).toISOString());
		}
		/** Sum independently folded hourly cost, optionally restricted to one local date. */
		function overviewCost(rows, date = "") {
			return sumHourlySlices(queryHourlyOverview(rows, {
				date,
				hour: "",
				sessionId: "",
				origin: "",
				route: ""
			}).flatMap((group) => group.sessions.map((item) => item.entry))).cost;
		}
		const NUMERIC_DISPLAY_COLUMNS = /* @__PURE__ */ new Set([
			"activity",
			"input",
			"cache",
			"output",
			"usage"
		]);
		function surchargeText(entry) {
			return formatContextSurcharge(entry.contextAfterTokens, entry.contextMultiplier) ?? "";
		}
		function cellText(row, key) {
			const value = row[key];
			if (value === null || value === void 0) return "";
			return String(value);
		}
		function rowTotalTokens(row) {
			return row.inputTokens + row.cacheTokens + row.outputTokens;
		}
		function metricTokens(row, key) {
			if (key === "input") return row.inputTokens;
			if (key === "cache") return row.cacheTokens;
			if (key === "output") return row.outputTokens;
			return rowTotalTokens(row);
		}
		function metricCost(row, key) {
			if (key === "input") return row.inputCost;
			if (key === "cache") return row.cacheCost;
			if (key === "output") return row.outputCost;
			return row.cost;
		}
		function averageUnitPrice(cost, tokens, unitTokens) {
			if (!(tokens > 0) || !Number.isFinite(cost) || !Number.isFinite(unitTokens) || unitTokens <= 0) return null;
			return cost / tokens * unitTokens;
		}
		function formatUsageCell(tokens, cost, unitTokens, _symbol) {
			const tokenText = String(tokens);
			const costText = formatMoneyAmount(cost);
			const avg = averageUnitPrice(cost, tokens, unitTokens);
			return avg === null ? `${tokenText}(${costText})` : `${tokenText}(${costText}/${formatMoneyAmount(avg)})`;
		}
		function activityText(row) {
			return `${row.turns} 轮 / ${row.steps} 步 / ${row.toolCalls} 工具`;
		}
		function displayCellText(row, key, unitTokens = 1e6, symbol = "") {
			if (key === "activity") return activityText(row);
			if (key === "input" || key === "cache" || key === "output" || key === "usage") return formatUsageCell(metricTokens(row, key), metricCost(row, key), unitTokens, symbol);
			return cellText(row, key);
		}
		function displaySortValue(row, key) {
			if (key === "activity") return row.turns;
			if (key === "input") return row.inputCost;
			if (key === "cache") return row.cacheCost;
			if (key === "output") return row.outputCost;
			if (key === "usage") return row.cost;
			return cellText(row, key);
		}
		/** One table row per independent hourly bucket. Time view labels by date+hour; model view labels by route. */
		function flattenCostTableRows(entries, view) {
			return entries.map((item, index) => {
				const route = hourlyRoute(item.entry) ?? "-";
				const date = localDateOfHour(item.entry.hour);
				return {
					id: `${item.sessionId}:${item.entry.hour}:${route}:${item.entry.contextMultiplier ?? 1}:${index}`,
					dimension: view === "model" ? route : `${date} ${item.entry.hourLabel}`,
					date,
					hour: item.entry.hour,
					hourLabel: item.entry.hourLabel,
					sessionId: item.sessionId,
					origin: item.origin ?? "",
					route,
					periodName: item.entry.periodName ?? "",
					surcharge: surchargeText(item.entry),
					turns: item.entry.turns,
					steps: item.entry.steps,
					toolCalls: item.entry.toolCalls,
					inputTokens: item.entry.inputTokens,
					inputCost: item.entry.inputCost,
					cacheTokens: item.entry.cacheReadTokens + item.entry.cacheWriteTokens,
					cacheCost: item.entry.cacheReadCost + item.entry.cacheWriteCost,
					outputTokens: item.entry.outputTokens,
					outputCost: item.entry.outputCost,
					cacheRate: item.entry.cacheRate,
					cost: item.entry.cost,
					inputRate: item.entry.rates?.input ?? null,
					cacheReadRate: item.entry.rates?.cacheRead ?? null,
					cacheWriteRate: item.entry.rates?.cacheWrite ?? null,
					outputRate: item.entry.rates?.output ?? null
				};
			});
		}
		function formatMoneyAmount(value) {
			if (!Number.isFinite(value)) return "0.00";
			const abs = Math.abs(value);
			if (abs > 0 && abs < .01) return value.toFixed(4);
			const two = value.toFixed(2);
			if (Math.abs(value - Number(two)) < 1e-9) return two;
			return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
		}
		const PARENT_OPTIONAL_COLUMNS = [
			"route",
			"activity",
			"input",
			"cache",
			"output"
		];
		const CHILD_OPTIONAL_COLUMNS = [
			"sessionId",
			"origin",
			"route",
			"surcharge",
			"periodName",
			"activity",
			"input",
			"cache",
			"output"
		];
		function optionalCostTableColumns(level = "parent") {
			return level === "child" ? CHILD_OPTIONAL_COLUMNS : PARENT_OPTIONAL_COLUMNS;
		}
		function defaultVisibleCostColumns(view, level = "parent") {
			return (level === "child" ? CHILD_OPTIONAL_COLUMNS : PARENT_OPTIONAL_COLUMNS).filter((key) => (level === "parent" && view === "model" ? key !== "route" : true) && (level === "child" && view === "model" ? key !== "route" : true));
		}
		function resolveVisibleCostColumns(view, selected, level = "parent") {
			const allowed = new Set(optionalCostTableColumns(level));
			return [
				"dimension",
				...selected.filter((key) => allowed.has(key) && (view !== "model" || key !== "route")),
				"usage"
			];
		}
		function filterCostTableRows(rows, filter, unitTokens = 1e6, symbol = "") {
			return rows.filter((row) => {
				for (const [key, raw] of Object.entries(filter)) {
					if (raw === void 0) continue;
					const needle = raw.trim().toLowerCase();
					if (needle === "") continue;
					if (!displayCellText(row, key, unitTokens, symbol).toLowerCase().includes(needle)) return false;
				}
				return true;
			});
		}
		function sortCostTableRows(rows, sort) {
			const direction = sort.dir === "asc" ? 1 : -1;
			return [...rows].sort((left, right) => {
				const leftValue = displaySortValue(left, sort.key);
				const rightValue = displaySortValue(right, sort.key);
				const compared = typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue), "zh-CN");
				return compared === 0 ? left.id.localeCompare(right.id) : compared * direction;
			});
		}
		function queryCostTable(entries, view, filter, sort) {
			return sortCostTableRows(filterCostTableRows(flattenCostTableRows(entries, view), filter), sort);
		}
		function uniqueText(values) {
			const unique = [...new Set(values.filter((value) => value !== ""))];
			return unique.length === 1 ? unique[0] : "";
		}
		function uniqueRate(values) {
			const unique = [...new Set(values.filter((value) => value !== null))];
			return unique.length === 1 ? unique[0] : null;
		}
		function summarizeCostGroup(id, dimension, children) {
			const totals = costTableTotals(children);
			return {
				id,
				dimension,
				date: uniqueText(children.map((row) => row.date)),
				hour: uniqueText(children.map((row) => row.hour)),
				hourLabel: uniqueText(children.map((row) => row.hourLabel)),
				sessionId: uniqueText(children.map((row) => row.sessionId)),
				origin: uniqueText(children.map((row) => row.origin)),
				route: uniqueText(children.map((row) => row.route)),
				periodName: uniqueText(children.map((row) => row.periodName)),
				surcharge: uniqueText(children.map((row) => row.surcharge)),
				...totals,
				inputRate: uniqueRate(children.map((row) => row.inputRate)),
				cacheReadRate: uniqueRate(children.map((row) => row.cacheReadRate)),
				cacheWriteRate: uniqueRate(children.map((row) => row.cacheWriteRate)),
				outputRate: uniqueRate(children.map((row) => row.outputRate))
			};
		}
		/** Collapse filtered hourly rows into one date or model summary with expandable children. */
		function groupCostTableRows(rows, view) {
			const buckets = /* @__PURE__ */ new Map();
			for (const row of rows) {
				const key = view === "model" ? row.route : row.date;
				const list = buckets.get(key);
				if (list === void 0) buckets.set(key, [row]);
				else list.push(row);
			}
			return [...buckets.entries()].map(([key, children]) => {
				const dimension = key === "" ? "-" : key;
				const id = `${view}:${dimension}`;
				return {
					id,
					summary: summarizeCostGroup(id, dimension, children),
					children: children.map((child) => ({
						...child,
						dimension: view === "model" ? `${child.date} ${child.hourLabel}` : child.hourLabel
					}))
				};
			});
		}
		function defaultChildCostTableSort(_view) {
			return {
				key: "dimension",
				dir: "asc"
			};
		}
		/** Filter hourly details, then group and sort summaries for the expandable table. */
		function queryCostTableGroups(entries, view, filter, sort, childFilter = {}, childSort = defaultChildCostTableSort(view), unitTokens = 1e6, symbol = "") {
			const groups = groupCostTableRows(filterCostTableRows(flattenCostTableRows(entries, view), filter, unitTokens, symbol), view);
			const order = new Map(groups.map((group) => [group.summary.id, group]));
			return sortCostTableRows(groups.map((group) => group.summary), sort).flatMap((summary) => {
				const group = order.get(summary.id);
				if (group === void 0) return [];
				const children = sortCostTableRows(filterCostTableRows(group.children, childFilter, unitTokens, symbol), childSort);
				return [{
					...group,
					children
				}];
			});
		}
		function costTableColumnValues(rows, key, unitTokens = 1e6, symbol = "") {
			return [...new Set(rows.map((row) => displayCellText(row, key, unitTokens, symbol)).filter((value) => value !== ""))].sort((left, right) => left.localeCompare(right, "zh-CN"));
		}
		function toggleCostTableSort(current, key) {
			if (current.key === key) return {
				key,
				dir: current.dir === "asc" ? "desc" : "asc"
			};
			return {
				key,
				dir: NUMERIC_DISPLAY_COLUMNS.has(key) ? "desc" : "asc"
			};
		}
		function defaultCostTableSort(view) {
			return {
				key: "dimension",
				dir: view === "model" ? "asc" : "desc"
			};
		}
		function costTableTotals(rows) {
			const out = {
				turns: 0,
				steps: 0,
				toolCalls: 0,
				inputTokens: 0,
				inputCost: 0,
				cacheTokens: 0,
				cacheCost: 0,
				outputTokens: 0,
				outputCost: 0,
				cacheRate: 0,
				cost: 0
			};
			for (const row of rows) {
				out.turns += row.turns;
				out.steps += row.steps;
				out.toolCalls += row.toolCalls;
				out.inputTokens += row.inputTokens;
				out.inputCost += row.inputCost;
				out.cacheTokens += row.cacheTokens;
				out.cacheCost += row.cacheCost;
				out.outputTokens += row.outputTokens;
				out.outputCost += row.outputCost;
				out.cost += row.cost;
			}
			const totalTokens = out.inputTokens + out.cacheTokens + out.outputTokens;
			out.cacheRate = totalTokens > 0 ? out.cacheTokens / totalTokens : 0;
			return out;
		}
		//#endregion
		//#region src/provider-balance.ts
		function succeeded(row) {
			return row.remaining !== null && row.error === void 0;
		}
		function gatewayHost(origin) {
			try {
				return new URL(origin).host;
			} catch {
				return origin;
			}
		}
		/** True when `origin` is an http(s) wallet URL that can be opened. */
		function walletHref(origin) {
			if (origin === void 0 || origin === "") return void 0;
			try {
				const url = new URL(origin);
				if (url.protocol !== "http:" && url.protocol !== "https:") return void 0;
				return url.origin;
			} catch {
				return;
			}
		}
		/**
		* One chip per gateway origin. Failed probes and rows without an openable
		* origin are dropped so a chip never appears without a host and href.
		*/
		function collapseBalanceChips(rows) {
			const order = [];
			const byOrigin = /* @__PURE__ */ new Map();
			for (const row of rows) {
				if (!succeeded(row)) continue;
				const origin = walletHref(row.origin);
				if (origin === void 0 || byOrigin.has(origin)) continue;
				order.push(origin);
				byOrigin.set(origin, {
					...row,
					origin,
					name: gatewayHost(origin)
				});
			}
			return order.map((origin) => byOrigin.get(origin));
		}
		//#endregion
		//#region src/client.ts
		const inject = ["slots", "remote"];
		function browserInterval(callback, delay) {
			const id = window.setInterval(callback, delay);
			return () => window.clearInterval(id);
		}
		function remoteErrorText(error) {
			if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
			return error === void 0 ? "未知错误" : String(error);
		}
		const SESSION_COST_CONCURRENCY = 8;
		async function loadAllSessionCosts(costMeter, sessions) {
			const remote = await costMeter.sessionCosts();
			if (remote.ok && Array.isArray(remote.value)) return remote.value;
			if (sessions === void 0) throw new Error(remoteErrorText(remote.error) || "会话费用加载失败");
			const listed = await sessions.list({});
			if (!listed.result.ok || listed.result.value === void 0) throw new Error(remoteErrorText(remote.error ?? listed.result.error) || "会话费用加载失败");
			const unique = [];
			const seen = /* @__PURE__ */ new Set();
			for (const item of listed.result.value.items) {
				if (item.sessionId === "" || seen.has(item.sessionId)) continue;
				seen.add(item.sessionId);
				unique.push(item);
			}
			return (await mapWithConcurrency(unique, SESSION_COST_CONCURRENCY, async (item) => {
				const response = await costMeter.sessionCost(item.sessionId);
				if (!response.ok || response.value === null || response.value === void 0) return null;
				return mergeListedSessionCost(item, response.value);
			})).filter((row) => row !== null);
		}
		const PRICING_ROUTE = "/cost-meter/pricing";
		/**
		* Pricing config source backed by the plugin's own host route. dsh's settings
		* RPC only serves an explicit allowlist of namespaces, so the card reads and
		* writes through this route instead of settings.describe (same pattern as the
		* modlens settings card).
		*/
		var PricingRouteSource = class {
			snapshot = {
				status: "loading",
				writable: true
			};
			listeners = /* @__PURE__ */ new Set();
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			async load() {
				try {
					const response = await fetch(PRICING_ROUTE, { headers: { accept: "application/json" } });
					if (!response.ok) this.snapshot = {
						status: "unavailable",
						writable: false
					};
					else {
						const body = await response.json();
						if (body.ok && body.value) {
							const previous = this.snapshot.value;
							const changed = previous === void 0 || JSON.stringify(previous) !== JSON.stringify(body.value);
							this.snapshot = {
								status: "ready",
								value: body.value,
								revision: (this.snapshot.revision ?? 0) + (changed ? 1 : 0),
								writable: true
							};
						} else this.snapshot = {
							status: "unavailable",
							writable: false
						};
					}
				} catch {
					this.snapshot = {
						status: "unavailable",
						writable: false
					};
				}
				for (const listener of this.listeners) listener();
			}
			async save(config) {
				try {
					const response = await fetch(PRICING_ROUTE, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json"
						},
						body: JSON.stringify(normalizePricing(config))
					});
					const body = await response.json();
					if (!response.ok || body.ok !== true || body.value === void 0) return typeof body.error === "string" && body.error !== "" ? body.error : `保存失败（HTTP ${response.status}）`;
					this.snapshot = {
						status: "ready",
						value: body.value,
						revision: (this.snapshot.revision ?? 0) + 1,
						writable: true
					};
					for (const listener of this.listeners) listener();
					return null;
				} catch (error) {
					return error instanceof Error ? error.message : "保存失败，请检查配置或刷新后重试。";
				}
			}
		};
		var CatalogSource = class {
			api;
			snapshot = {
				status: "loading",
				groups: []
			};
			listeners = /* @__PURE__ */ new Set();
			constructor(api) {
				this.api = api;
			}
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			async load() {
				try {
					const response = await this.api.llm.models({});
					this.snapshot = response.result.ok && response.result.value ? {
						status: "ready",
						groups: response.result.value.groups
					} : {
						status: "error",
						groups: []
					};
				} catch {
					this.snapshot = {
						status: "error",
						groups: []
					};
				}
				for (const listener of this.listeners) listener();
			}
		};
		const cloneConfig = (value) => normalizePricing(JSON.parse(JSON.stringify(value ?? DEFAULT_PRICING)));
		const money = (value) => value > 0 && value < .01 ? value.toFixed(4) : value.toFixed(2);
		const currencySymbol = (currency) => ({
			CNY: "¥",
			USD: "$",
			EUR: "€",
			JPY: "¥"
		})[currency.toUpperCase()] ?? `${currency} `;
		const inputStyle = {
			height: 32,
			minWidth: 0,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			padding: "0 9px",
			background: "var(--dsw-alias-bg-layer-3)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 12
		};
		const buttonStyle = {
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			padding: "5px 10px",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			fontSize: 12,
			cursor: "pointer"
		};
		const primaryButtonStyle = {
			...buttonStyle,
			background: "var(--dsw-alias-label-primary)",
			color: "var(--dsw-alias-bg-layer-3)"
		};
		function newGroupId(groups) {
			const used = new Set(groups.map((group) => group.id));
			let index = 1;
			while (used.has(`group-${index}`)) index += 1;
			return `group-${index}`;
		}
		function NumberInput(props) {
			return react.default.createElement("input", {
				style: inputStyle,
				type: "number",
				min: 0,
				step: "any",
				inputMode: "decimal",
				value: props.value ?? "",
				placeholder: props.placeholder ?? "",
				onChange: (event) => props.onChange(event.target.value === "" ? void 0 : Number(event.target.value))
			});
		}
		function field(label, child) {
			return react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, label, child);
		}
		const CURRENCIES = [
			"CNY",
			"USD",
			"EUR",
			"JPY"
		];
		const TIMEZONES = [
			"Asia/Shanghai",
			"Asia/Hong_Kong",
			"Asia/Tokyo",
			"Asia/Singapore",
			"UTC",
			"America/New_York",
			"America/Los_Angeles",
			"Europe/London",
			"Europe/Paris"
		];
		const UNIT_TOKEN_OPTIONS = [1e3, 1e6];
		const INTERVAL_OPTIONS = [
			5,
			15,
			30,
			60,
			120,
			360,
			1440
		];
		const CONCURRENCY_OPTIONS = [
			1,
			2,
			4,
			8
		];
		const CACHE_MULT_OPTIONS = [
			0,
			.02,
			.1,
			.25,
			.5,
			1
		];
		const PERIOD_MULT_OPTIONS = [
			.25,
			.5,
			.8,
			1,
			1.5,
			2
		];
		const WEEKDAY_OPTIONS = [
			{
				value: 1,
				label: "一"
			},
			{
				value: 2,
				label: "二"
			},
			{
				value: 3,
				label: "三"
			},
			{
				value: 4,
				label: "四"
			},
			{
				value: 5,
				label: "五"
			},
			{
				value: 6,
				label: "六"
			},
			{
				value: 7,
				label: "日"
			}
		];
		const MODEL_MULT_OPTIONS = [
			.5,
			.8,
			1,
			1.2,
			1.5,
			2
		];
		const SURCHARGE_AFTER_OPTIONS = [
			32e3,
			64e3,
			128e3,
			2e5,
			256e3,
			1e6
		];
		const SURCHARGE_MULT_OPTIONS = [
			1.5,
			2,
			3
		];
		function withCurrent(options, value) {
			if (value === void 0 || !Number.isFinite(value) || options.includes(value)) return [...options];
			return [...options, value].sort((left, right) => left - right);
		}
		function Select(props) {
			return react.default.createElement("select", {
				style: inputStyle,
				value: props.value,
				onChange: (event) => props.onChange(event.target.value)
			}, ...props.options.map((option) => react.default.createElement("option", {
				key: option.value,
				value: option.value
			}, option.label)));
		}
		function NumberSelect(props) {
			const format = props.format ?? ((value) => String(value));
			return react.default.createElement(Select, {
				value: String(props.value),
				options: withCurrent(props.options, props.value).map((value) => ({
					value: String(value),
					label: format(value)
				})),
				onChange: (next) => props.onChange(Number(next))
			});
		}
		function formatProbeTime(time) {
			const date = new Date(time);
			const pad = (value) => String(value).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		function formatUnitTokens(value) {
			return value === 1e6 ? "每 1M tokens" : value === 1e3 ? "每 1K tokens" : `每 ${value.toLocaleString("zh-CN")} tokens`;
		}
		function PeriodEditor(props) {
			const set = (key, value) => props.onChange({
				...props.period,
				[key]: value
			});
			const selected = new Set(props.period.days ?? WEEKDAY_OPTIONS.map((option) => option.value));
			const allDay = props.period.start === props.period.end;
			const toggleDay = (day) => {
				const next = new Set(selected);
				if (next.has(day)) next.delete(day);
				else next.add(day);
				if (next.size === 0 || next.size === WEEKDAY_OPTIONS.length) {
					const rest = { ...props.period };
					delete rest.days;
					props.onChange(rest);
					return;
				}
				set("days", [...next].sort((left, right) => left - right));
			};
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 8
			} }, react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "minmax(120px, 1fr) 100px 100px 96px auto",
				gap: 8,
				alignItems: "end"
			} }, field("时段名称", react.default.createElement("input", {
				style: inputStyle,
				value: props.period.name,
				onChange: (event) => set("name", event.target.value)
			})), field("开始", react.default.createElement("input", {
				style: inputStyle,
				type: "time",
				value: allDay ? "00:00" : props.period.start,
				disabled: allDay,
				onChange: (event) => set("start", event.target.value)
			})), field("结束", react.default.createElement("input", {
				style: inputStyle,
				type: "time",
				value: allDay ? "00:00" : props.period.end,
				disabled: allDay,
				onChange: (event) => set("end", event.target.value)
			})), field("倍率", react.default.createElement(NumberSelect, {
				value: props.period.multiplier,
				options: PERIOD_MULT_OPTIONS,
				format: (value) => `×${value}`,
				onChange: (value) => set("multiplier", value)
			})), react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				onClick: props.onRemove
			}, "删除")), react.default.createElement("div", { style: {
				display: "flex",
				flexWrap: "wrap",
				gap: 8,
				alignItems: "center"
			} }, react.default.createElement("label", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				fontSize: 12
			} }, react.default.createElement("input", {
				type: "checkbox",
				checked: allDay,
				onChange: (event) => props.onChange(event.target.checked ? {
					...props.period,
					start: "00:00",
					end: "00:00"
				} : {
					...props.period,
					start: "08:00",
					end: "22:00"
				})
			}), "全天"), ...WEEKDAY_OPTIONS.map((option) => react.default.createElement("label", {
				key: option.value,
				style: {
					display: "flex",
					alignItems: "center",
					gap: 4,
					fontSize: 12
				}
			}, react.default.createElement("input", {
				type: "checkbox",
				checked: selected.has(option.value),
				onChange: () => toggleDay(option.value)
			}), option.label))));
		}
		function PeriodsEditor(props) {
			const add = () => props.onChange([...props.periods, {
				id: `period-${Date.now()}-${props.periods.length}`,
				name: "低峰",
				start: "00:00",
				end: "08:00",
				multiplier: 1
			}]);
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, ...props.periods.map((period, index) => react.default.createElement(PeriodEditor, {
				key: period.id,
				period,
				onChange: (next) => props.onChange(props.periods.map((item, at) => at === index ? next : item)),
				onRemove: () => props.onChange(props.periods.filter((_item, at) => at !== index))
			})), react.default.createElement("button", {
				type: "button",
				style: {
					...buttonStyle,
					alignSelf: "flex-start"
				},
				onClick: add
			}, "+ 添加时段倍率"));
		}
		function ContextSurchargesEditor(props) {
			const add = () => props.onChange([...props.tiers, {
				afterTokens: 2e5,
				multiplier: 2
			}]);
			const set = (index, next) => props.onChange(props.tiers.map((item, at) => at === index ? next : item));
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 8
			} }, react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, props.hint ?? "单次请求上下文（未缓存输入 + 缓存读 + 缓存写）超过阈值后，该请求整单费用按倍率计。输出不计入阈值。"), ...props.tiers.map((tier, index) => react.default.createElement("div", {
				key: `${tier.afterTokens}-${index}`,
				style: {
					display: "grid",
					gridTemplateColumns: "minmax(140px, 1fr) minmax(100px, 160px) auto",
					gap: 8,
					alignItems: "end"
				}
			}, react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "超过 Token 数", react.default.createElement(NumberSelect, {
				value: tier.afterTokens,
				options: SURCHARGE_AFTER_OPTIONS,
				format: formatTokenThreshold,
				onChange: (value) => set(index, {
					...tier,
					afterTokens: value
				})
			})), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "整单倍率", react.default.createElement(NumberSelect, {
				value: tier.multiplier,
				options: SURCHARGE_MULT_OPTIONS,
				format: (value) => `×${value}`,
				onChange: (value) => set(index, {
					...tier,
					multiplier: value
				})
			})), react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				onClick: () => props.onChange(props.tiers.filter((_item, at) => at !== index))
			}, "删除"))), react.default.createElement("button", {
				type: "button",
				style: {
					...buttonStyle,
					alignSelf: "flex-start"
				},
				onClick: add
			}, "+ 添加上下文翻倍"));
		}
		function catalogRoutes(catalog) {
			return catalog.groups.flatMap((provider) => provider.models.map((model) => ({
				key: `${provider.id}/${model.id}`,
				providerId: provider.id,
				providerName: provider.name,
				modelId: model.id,
				modelName: model.name
			})));
		}
		function routeFromKey(key, catalog) {
			const found = catalogRoutes(catalog).find((route) => route.key === key);
			if (found !== void 0) return found;
			const slash = key.indexOf("/");
			const providerId = slash === -1 ? key : key.slice(0, slash);
			const modelId = slash === -1 ? key : key.slice(slash + 1);
			return {
				key,
				providerId,
				providerName: providerId,
				modelId,
				modelName: modelId
			};
		}
		function GroupModelRow(props) {
			const set = (next) => props.onChange(next);
			const updatedAt = lastUpdatedAt(props.assignment);
			return react.default.createElement("div", { style: {
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				padding: "10px 0",
				display: "flex",
				flexDirection: "column",
				gap: 8
			} }, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 10
			} }, react.default.createElement("div", { style: {
				flex: 1,
				minWidth: 0
			} }, react.default.createElement("div", { style: {
				fontSize: 13,
				fontWeight: 500,
				color: "var(--dsw-alias-label-primary)"
			} }, props.route.modelName), react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginTop: 2
			} }, props.route.key)), react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				onClick: props.onRemove
			}, "移出")), react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "minmax(110px, 1fr) minmax(110px, 1fr) auto",
				gap: 8,
				alignItems: "end"
			} }, field("优惠倍率", react.default.createElement(NumberSelect, {
				value: props.assignment.discountMultiplier ?? 1,
				options: MODEL_MULT_OPTIONS,
				format: (value) => `×${value}`,
				onChange: (value) => set({
					...props.assignment,
					discountMultiplier: value
				})
			})), field("模型倍率", react.default.createElement(NumberSelect, {
				value: props.assignment.modelMultiplier ?? 1,
				options: MODEL_MULT_OPTIONS,
				format: (value) => `×${value}`,
				onChange: (value) => set({
					...props.assignment,
					modelMultiplier: value
				})
			})), react.default.createElement("label", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				fontSize: 11,
				color: "var(--dsw-alias-label-secondary)",
				paddingBottom: 6
			} }, react.default.createElement("input", {
				type: "checkbox",
				checked: props.assignment.reasoningExtra === true,
				onChange: (event) => {
					const next = { ...props.assignment };
					if (event.target.checked) next.reasoningExtra = true;
					else delete next.reasoningExtra;
					set(next);
				}
			}), "推理另计")), updatedAt === null ? null : react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, `更新 ${formatProbeTime(updatedAt)}`));
		}
		function GroupModelPicker(props) {
			const [open, setOpen] = react.default.useState(false);
			const [query, setQuery] = react.default.useState("");
			const [selected, setSelected] = react.default.useState(/* @__PURE__ */ new Set());
			const groupName = (id) => props.groups.find((group) => group.id === id)?.name ?? id;
			const needle = query.trim().toLowerCase();
			const candidates = catalogRoutes(props.catalog).filter((route) => props.models[route.key]?.groupId !== props.groupId).filter((route) => needle === "" || `${route.key} ${route.providerName} ${route.modelName}`.toLowerCase().includes(needle));
			const visibleKeys = candidates.map((route) => route.key);
			const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
			const toggle = (key) => setSelected((current) => {
				const next = new Set(current);
				if (next.has(key)) next.delete(key);
				else next.add(key);
				return next;
			});
			const toggleVisible = () => setSelected((current) => {
				const next = new Set(current);
				if (allVisibleSelected) for (const key of visibleKeys) next.delete(key);
				else for (const key of visibleKeys) next.add(key);
				return next;
			});
			const add = (keys) => {
				if (keys.length === 0) return;
				props.onAdd(keys);
				setSelected((current) => {
					const next = new Set(current);
					for (const key of keys) next.delete(key);
					return next;
				});
			};
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 8
			} }, react.default.createElement("button", {
				type: "button",
				style: {
					...buttonStyle,
					alignSelf: "flex-start"
				},
				onClick: () => setOpen(!open)
			}, open ? "收起模型目录" : "+ 向此分组添加模型"), open ? react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 8,
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				padding: 10
			} }, react.default.createElement("input", {
				style: inputStyle,
				value: query,
				placeholder: "搜索 provider / 模型…",
				onChange: (event) => setQuery(event.target.value)
			}), react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8
			} }, react.default.createElement("label", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)"
			} }, react.default.createElement("input", {
				type: "checkbox",
				checked: allVisibleSelected,
				disabled: visibleKeys.length === 0,
				onChange: toggleVisible
			}), visibleKeys.length === 0 ? "无可添加模型" : `全选当前列表（${visibleKeys.length}）`), react.default.createElement("span", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, selected.size > 0 ? `已选 ${selected.size}` : "可多选后一次加入")), react.default.createElement("div", { style: {
				maxHeight: 220,
				overflow: "auto",
				display: "flex",
				flexDirection: "column"
			} }, candidates.length === 0 ? react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, props.catalog.status === "loading" ? "正在加载模型…" : "没有可添加的模型") : null, ...candidates.map((route) => {
				const current = props.models[route.key];
				return react.default.createElement("label", {
					key: route.key,
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "6px 0",
						borderTop: "1px solid var(--dsw-alias-border-l2)",
						fontSize: 12
					}
				}, react.default.createElement("input", {
					type: "checkbox",
					checked: selected.has(route.key),
					onChange: () => toggle(route.key)
				}), react.default.createElement("span", { style: {
					flex: 1,
					minWidth: 0
				} }, react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, route.modelName), react.default.createElement("span", { style: {
					color: "var(--dsw-alias-label-tertiary)",
					marginLeft: 8
				} }, route.key)), current !== void 0 ? react.default.createElement("span", { style: {
					fontSize: 11,
					color: "var(--dsw-alias-label-tertiary)"
				} }, `现属 ${groupName(current.groupId)}`) : null);
			})), react.default.createElement("div", { style: {
				display: "flex",
				justifyContent: "flex-end",
				gap: 8
			} }, react.default.createElement("button", {
				type: "button",
				style: primaryButtonStyle,
				disabled: selected.size === 0,
				onClick: () => add([...selected])
			}, selected.size === 0 ? "添加所选" : `添加所选（${selected.size}）`))) : null);
		}
		function GroupEditor(props) {
			const [collapsed, setCollapsed] = react.default.useState(props.group.id !== "default");
			const [modelsOpen, setModelsOpen] = react.default.useState(true);
			const setGroup = (next) => props.onChange({
				...props.config,
				groups: props.config.groups.map((group) => group.id === props.group.id ? next : group)
			});
			const set = (key, value) => setGroup({
				...props.group,
				[key]: value
			});
			const assigned = Object.entries(props.config.models).filter(([, assignment]) => assignment.groupId === props.group.id).sort(([left], [right]) => left.localeCompare(right));
			const setAssignment = (key, assignment) => props.onChange({
				...props.config,
				models: {
					...props.config.models,
					[key]: assignment
				}
			});
			const removeModel = (key) => {
				const { [key]: _removed, ...models } = props.config.models;
				props.onChange({
					...props.config,
					models
				});
			};
			const addModels = (keys) => {
				const models = { ...props.config.models };
				for (const key of keys) {
					const previous = models[key];
					models[key] = previous === void 0 ? { groupId: props.group.id } : {
						...previous,
						groupId: props.group.id
					};
				}
				props.onChange({
					...props.config,
					models
				});
			};
			return react.default.createElement("div", { style: {
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				padding: 12,
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 10,
					cursor: "pointer"
				},
				onClick: () => setCollapsed(!collapsed)
			}, react.default.createElement("span", {
				"aria-hidden": true,
				style: {
					transform: collapsed ? "rotate(-90deg)" : void 0,
					transition: "transform 0.15s",
					fontSize: 12,
					color: "var(--dsw-alias-label-tertiary)"
				}
			}, "▾"), react.default.createElement("div", { style: {
				flex: 1,
				minWidth: 0
			} }, react.default.createElement("div", { style: {
				fontSize: 13,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary)"
			} }, props.group.name), react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginTop: 2
			} }, `${props.group.id} · ${assigned.length} 个模型`)), props.config.groups.length > 1 ? react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				onClick: (event) => {
					event.stopPropagation();
					props.onRemove();
				}
			}, "删除分组") : null), collapsed ? null : react.default.createElement(react.default.Fragment, null, react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "minmax(140px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr)",
				gap: 8
			} }, field("分组名称", react.default.createElement("input", {
				style: inputStyle,
				value: props.group.name,
				onChange: (event) => set("name", event.target.value)
			})), field("基准输入", react.default.createElement(NumberInput, {
				value: props.group.input,
				onChange: (value) => set("input", value ?? 0)
			})), field("基准输出", react.default.createElement(NumberInput, {
				value: props.group.output,
				onChange: (value) => set("output", value ?? 0)
			}))), react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "repeat(2, minmax(140px, 1fr))",
				gap: 8
			} }, field("缓存读倍率", react.default.createElement(NumberSelect, {
				value: props.group.cacheReadMultiplier,
				options: CACHE_MULT_OPTIONS,
				format: (value) => `×${value}`,
				onChange: (value) => set("cacheReadMultiplier", value)
			})), field("缓存写倍率", react.default.createElement(NumberSelect, {
				value: props.group.cacheWriteMultiplier,
				options: CACHE_MULT_OPTIONS,
				format: (value) => `×${value}`,
				onChange: (value) => set("cacheWriteMultiplier", value)
			}))), react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, `缓存读 = 基准输入 × ${props.group.cacheReadMultiplier}；缓存写 = 基准输入 × ${props.group.cacheWriteMultiplier}。时段与上下文倍率作用于整单。`), react.default.createElement("h4", { style: {
				margin: "4px 0 0",
				fontSize: 12,
				fontWeight: 600
			} }, "不同时段倍率"), react.default.createElement(PeriodsEditor, {
				periods: props.group.periods ?? [],
				onChange: (periods) => set("periods", periods)
			}), react.default.createElement("h4", { style: {
				margin: "4px 0 0",
				fontSize: 12,
				fontWeight: 600
			} }, "超过上下文倍率"), react.default.createElement(ContextSurchargesEditor, {
				tiers: props.group.contextSurcharges ?? [],
				onChange: (contextSurcharges) => set("contextSurcharges", contextSurcharges)
			}), react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8
			} }, react.default.createElement("button", {
				type: "button",
				style: {
					...buttonStyle,
					padding: "4px 8px"
				},
				onClick: () => setModelsOpen(!modelsOpen),
				"aria-expanded": modelsOpen
			}, modelsOpen ? "收起模型列表" : `展开模型列表（${assigned.length}）`), react.default.createElement("h4", { style: {
				margin: 0,
				fontSize: 12,
				fontWeight: 600
			} }, "此分组的模型")), react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "在分组内添加模型，再改每个模型的优惠倍率和模型倍率。一个模型只能属于一个分组；从目录移入会从原分组带走。未加入任何分组的模型使用 default 分组。"), assigned.length === 0 ? react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "还没有模型。") : null, modelsOpen && assigned.length > 0 ? react.default.createElement("div", { style: {
				maxHeight: 320,
				overflow: "auto",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				padding: "0 10px"
			} }, ...assigned.map(([key, assignment]) => react.default.createElement(GroupModelRow, {
				key,
				route: routeFromKey(key, props.catalog),
				assignment,
				onChange: (next) => setAssignment(key, next),
				onRemove: () => removeModel(key)
			}))) : null, react.default.createElement(GroupModelPicker, {
				groupId: props.group.id,
				groups: props.config.groups,
				models: props.config.models,
				catalog: props.catalog,
				onAdd: addModels
			})));
		}
		function PricingSettingsCard(props) {
			const settings = props.usePricing((snapshot) => snapshot);
			const catalog = props.useCatalog((snapshot) => snapshot);
			const [draft, setDraft] = react.default.useState(() => cloneConfig(settings.value));
			const [seedRevision, setSeedRevision] = react.default.useState(settings.revision);
			const seedJson = react.default.useRef(JSON.stringify(cloneConfig(settings.value)));
			const acceptRemote = react.default.useRef(false);
			const [saving, setSaving] = react.default.useState(false);
			const [saved, setSaved] = react.default.useState(false);
			const [failure, setFailure] = react.default.useState(null);
			react.default.useEffect(() => {
				if (settings.revision === seedRevision) return;
				const next = cloneConfig(settings.value);
				const nextJson = JSON.stringify(next);
				setDraft((current) => {
					if (!acceptRemote.current && JSON.stringify(current) !== seedJson.current) return current;
					acceptRemote.current = false;
					seedJson.current = nextJson;
					return next;
				});
				setSeedRevision(settings.revision);
				setFailure(null);
			}, [
				settings.revision,
				settings.value,
				seedRevision
			]);
			react.default.useEffect(() => {
				props.refreshCatalog();
			}, [props.refreshCatalog]);
			react.default.useEffect(() => {
				if (props.refreshPricing === void 0 || props.interval === void 0) return;
				const load = () => {
					props.refreshPricing?.();
				};
				load();
				return props.interval(load, 3e4);
			}, [props.refreshPricing, props.interval]);
			if (settings.status === "unavailable") return react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 13,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "费用设置暂不可用。");
			if (settings.status === "loading" && settings.value === void 0) return react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 13,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "正在加载费用设置…");
			const baseline = cloneConfig(settings.value);
			const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
			let invalid = null;
			try {
				validatePricing(draft);
			} catch (error) {
				invalid = error instanceof Error ? error.message : String(error);
			}
			const setGroups = (groups) => {
				const ids = new Set(groups.map((group) => group.id));
				const models = Object.fromEntries(Object.entries(draft.models).flatMap(([key, assignment]) => ids.has(assignment.groupId) ? [[key, assignment]] : []));
				setDraft({
					...draft,
					groups,
					models
				});
			};
			const catalogProviders = [...new Set(catalogRoutes(catalog).map((route) => route.providerId))].sort();
			const selectedProviders = new Set(draft.billingProbe?.providers ?? []);
			const save = async () => {
				if (invalid || !dirty) return;
				setSaving(true);
				setFailure(null);
				const error = await props.save(draft);
				setSaving(false);
				if (error === null) {
					acceptRemote.current = true;
					setSaved(true);
					setTimeout(() => setSaved(false), 2e3);
				} else setFailure(error);
			};
			const timezoneOptions = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES];
			const currencyOptions = CURRENCIES.includes(draft.currency) ? CURRENCIES : [draft.currency, ...CURRENCIES];
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 16,
				padding: "4px 0 16px"
			} }, react.default.createElement("section", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "最终单价 = 分组基准（含缓存 / 时段 / 上下文倍率）× 优惠倍率 × 模型倍率。"), react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "120px 160px 1fr",
				gap: 8
			} }, field("币种", react.default.createElement(Select, {
				value: draft.currency,
				options: currencyOptions.map((value) => ({
					value,
					label: value
				})),
				onChange: (value) => setDraft({
					...draft,
					currency: value
				})
			})), field("计价单位", react.default.createElement(NumberSelect, {
				value: draft.unitTokens,
				options: UNIT_TOKEN_OPTIONS,
				format: formatUnitTokens,
				onChange: (value) => setDraft({
					...draft,
					unitTokens: value
				})
			})), field("计价时区", react.default.createElement(Select, {
				value: draft.timezone,
				options: timezoneOptions.map((value) => ({
					value,
					label: value
				})),
				onChange: (value) => setDraft({
					...draft,
					timezone: value
				})
			}))), react.default.createElement("label", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12
			} }, react.default.createElement("input", {
				type: "checkbox",
				checked: draft.billingProbe?.enabled === true,
				onChange: (event) => setDraft({
					...draft,
					billingProbe: {
						...draft.billingProbe ?? {},
						enabled: event.target.checked
					}
				})
			}), "自动探测上游倍率"), draft.billingProbe?.enabled === true ? react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "160px 120px",
				gap: 8
			} }, field("探测周期", react.default.createElement(NumberSelect, {
				value: draft.billingProbe.intervalMinutes ?? 30,
				options: INTERVAL_OPTIONS,
				format: (value) => value >= 60 ? `${value / 60} 小时` : `${value} 分钟`,
				onChange: (value) => setDraft({
					...draft,
					billingProbe: {
						...draft.billingProbe,
						intervalMinutes: value
					}
				})
			})), field("并发数", react.default.createElement(NumberSelect, {
				value: draft.billingProbe.concurrency ?? 2,
				options: CONCURRENCY_OPTIONS,
				onChange: (value) => setDraft({
					...draft,
					billingProbe: {
						...draft.billingProbe,
						concurrency: value
					}
				})
			}))) : null, draft.billingProbe?.enabled === true ? react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 6
			} }, react.default.createElement("span", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, catalogProviders.length === 0 ? "不限制供应商（目录为空时探测全部已配置模型）" : "探测这些供应商，不选则全部探测"), catalogProviders.length === 0 ? null : react.default.createElement("div", { style: {
				display: "flex",
				flexWrap: "wrap",
				gap: 8
			} }, ...catalogProviders.map((provider) => react.default.createElement("label", {
				key: provider,
				style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					fontSize: 12
				}
			}, react.default.createElement("input", {
				type: "checkbox",
				checked: selectedProviders.size === 0 || selectedProviders.has(provider),
				onChange: (event) => {
					const next = new Set(selectedProviders);
					if (selectedProviders.size === 0) for (const id of catalogProviders) next.add(id);
					if (event.target.checked) next.add(provider);
					else next.delete(provider);
					const providers = next.size === catalogProviders.length ? void 0 : [...next];
					setDraft({
						...draft,
						billingProbe: {
							...draft.billingProbe,
							providers
						}
					});
				}
			}), provider)))) : null), react.default.createElement("section", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("h3", { style: {
				margin: 0,
				fontSize: 13,
				fontWeight: 600
			} }, "基准费用分组"), react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "添加分组，再在分组里选择模型并改每个模型的倍率。未加入任何分组的模型使用 id 为 default 的分组，没有则用第一个分组。"), ...draft.groups.map((group) => react.default.createElement(GroupEditor, {
				key: group.id,
				group,
				config: draft,
				catalog,
				onChange: setDraft,
				onRemove: () => setGroups(draft.groups.filter((item) => item.id !== group.id))
			})), react.default.createElement("button", {
				type: "button",
				style: {
					...buttonStyle,
					alignSelf: "flex-start"
				},
				onClick: () => setGroups([...draft.groups, {
					...DEFAULT_GROUP,
					id: newGroupId(draft.groups),
					name: "新分组",
					periods: [],
					contextSurcharges: []
				}])
			}, "+ 添加基准费用分组")), catalog.status === "error" ? react.default.createElement("p", {
				role: "alert",
				style: {
					margin: 0,
					fontSize: 12,
					color: "var(--dsw-alias-label-error)"
				}
			}, "模型目录加载失败，仍可编辑已加入分组的模型。") : null, invalid ? react.default.createElement("p", {
				role: "alert",
				style: {
					margin: 0,
					fontSize: 12,
					color: "var(--dsw-alias-label-error)"
				}
			}, invalid) : null, failure ? react.default.createElement("p", {
				role: "alert",
				style: {
					margin: 0,
					fontSize: 12,
					color: "var(--dsw-alias-label-error)"
				}
			}, failure) : null, react.default.createElement("div", { style: {
				display: "flex",
				justifyContent: "flex-end",
				gap: 8,
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				paddingTop: 12
			} }, react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				disabled: !dirty || saving,
				onClick: () => setDraft(baseline)
			}, "放弃修改"), react.default.createElement("button", {
				type: "button",
				style: primaryButtonStyle,
				disabled: !dirty || saving || invalid !== null,
				onClick: save
			}, saving ? "保存中…" : saved ? "✓ 保存成功" : "保存")));
		}
		const FILTER_INPUT = {
			...inputStyle,
			height: 22,
			width: "100%",
			minWidth: 56,
			fontSize: 11,
			padding: "0 6px",
			boxSizing: "border-box",
			fontWeight: 400
		};
		const TABLE_BORDER = "1px solid var(--dsw-alias-border-l2)";
		const TABLE_CELL = {
			fontSize: 12,
			padding: "6px 8px",
			textAlign: "right",
			whiteSpace: "nowrap",
			border: TABLE_BORDER,
			verticalAlign: "middle"
		};
		const TABLE_CELL_LEFT = {
			...TABLE_CELL,
			textAlign: "left"
		};
		const TABLE_HEAD = {
			...TABLE_CELL,
			fontWeight: 600,
			background: "var(--dsw-alias-bg-layer-3, #f5f5f5)",
			position: "sticky",
			top: 0,
			zIndex: 2,
			verticalAlign: "top"
		};
		const TABLE_HEAD_LEFT = {
			...TABLE_HEAD,
			textAlign: "left"
		};
		const COLUMN_BY_KEY = new Map([
			{
				key: "dimension",
				label: "分组",
				left: true
			},
			{
				key: "sessionId",
				label: "会话",
				left: true
			},
			{
				key: "origin",
				label: "来源",
				left: true
			},
			{
				key: "route",
				label: "模型",
				left: true
			},
			{
				key: "surcharge",
				label: "翻倍"
			},
			{
				key: "periodName",
				label: "计价时段",
				left: true
			},
			{
				key: "activity",
				label: "用量"
			},
			{
				key: "input",
				label: "输入",
				compact: true
			},
			{
				key: "cache",
				label: "缓存",
				compact: true
			},
			{
				key: "output",
				label: "输出",
				compact: true
			},
			{
				key: "usage",
				label: "合计",
				compact: true
			}
		].map((column) => [column.key, column]));
		function columnLabel(key, view, level) {
			if (key === "dimension") {
				if (level === "child") return view === "model" ? "时段" : "时段";
				return view === "model" ? "模型" : "日期";
			}
			return COLUMN_BY_KEY.get(key)?.label ?? key;
		}
		function formatCostCell(row, key, symbol, unitTokens) {
			if (key === "sessionId" && row.sessionId.length > 12) return `${row.sessionId.slice(0, 8)}…`;
			const text = displayCellText(row, key, unitTokens, symbol);
			return text === "" ? "-" : text;
		}
		function asHourlyEntry(sessionId, origin, parentSession, entry) {
			return {
				sessionId,
				origin,
				parentSession,
				entry
			};
		}
		function flattenFoldEntries(sessionId, fold, origin = null, parentSession = null) {
			if (fold === null) return [];
			const own = (fold.hourly ?? []).flatMap((entry) => entry.hour ? [asHourlyEntry(sessionId, origin, parentSession, entry)] : []);
			const children = (fold.subagents ?? []).flatMap((child) => flattenFoldEntries(child.sessionId, child, "subagent", sessionId));
			return [...own, ...children];
		}
		function CostTable(props) {
			const [view, setView] = react.default.useState("time");
			const [sort, setSort] = react.default.useState(() => defaultCostTableSort("time"));
			const [filter, setFilter] = react.default.useState({});
			const [childSort, setChildSort] = react.default.useState(() => defaultChildCostTableSort("time"));
			const [childFilter, setChildFilter] = react.default.useState({});
			const [selected, setSelected] = react.default.useState(() => defaultVisibleCostColumns("time"));
			const [childSelected, setChildSelected] = react.default.useState(() => defaultVisibleCostColumns("time", "child"));
			const [columnMenu, setColumnMenu] = react.default.useState(null);
			const [filterMenu, setFilterMenu] = react.default.useState(null);
			const [expanded, setExpanded] = react.default.useState(() => /* @__PURE__ */ new Set());
			const setViewMode = (next) => {
				setView(next);
				setSort(defaultCostTableSort(next));
				setChildSort(defaultChildCostTableSort(next));
				setSelected(defaultVisibleCostColumns(next));
				setChildSelected(defaultVisibleCostColumns(next, "child"));
				setColumnMenu(null);
				setExpanded(/* @__PURE__ */ new Set());
			};
			const parentColumns = resolveVisibleCostColumns(view, selected, "parent").flatMap((key) => {
				const column = COLUMN_BY_KEY.get(key);
				return column === void 0 ? [] : [column];
			});
			const childColumns = resolveVisibleCostColumns(view, childSelected, "child").flatMap((key) => {
				const column = COLUMN_BY_KEY.get(key);
				return column === void 0 ? [] : [column];
			});
			const allRows = queryCostTable(props.entries, view, {}, defaultCostTableSort(view));
			const groups = queryCostTableGroups(props.entries, view, filter, sort, childFilter, childSort, props.unitTokens, props.symbol);
			const childRows = groups.flatMap((group) => group.children);
			const detailCount = childRows.length;
			const totals = costTableTotals(childRows);
			const patchFilter = (setter) => (key, value) => setter((current) => {
				const next = { ...current };
				if (value === "") delete next[key];
				else next[key] = value;
				return next;
			});
			const setFilterValue = patchFilter(setFilter);
			const setChildFilterValue = patchFilter(setChildFilter);
			const toggleGroup = (id) => setExpanded((current) => {
				const next = new Set(current);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
			const headerButton = (column, current, onSort, level) => {
				const active = current.key === column.key;
				const mark = !active ? "" : current.dir === "asc" ? " ↑" : " ↓";
				return react.default.createElement("button", {
					type: "button",
					"aria-sort": active ? current.dir === "asc" ? "ascending" : "descending" : "none",
					onClick: () => onSort((prev) => toggleCostTableSort(prev, column.key)),
					style: {
						border: 0,
						background: "transparent",
						padding: 0,
						cursor: "pointer",
						font: "inherit",
						fontWeight: 600,
						color: "inherit",
						whiteSpace: "nowrap"
					}
				}, `${columnLabel(column.key, view, level)}${mark}`);
			};
			const filterControl = (column, current, onChange, rows, level) => {
				const options = costTableColumnValues(rows, column.key, props.unitTokens, props.symbol);
				const value = current[column.key] ?? "";
				const open = filterMenu?.level === level && filterMenu.key === column.key;
				const control = column.compact !== true && options.length > 0 && options.length <= 16 ? react.default.createElement("select", {
					style: FILTER_INPUT,
					value,
					onChange: (event) => onChange(column.key, event.target.value)
				}, react.default.createElement("option", { value: "" }, "全部"), ...options.map((option) => react.default.createElement("option", {
					key: option,
					value: option
				}, option))) : react.default.createElement("input", {
					style: FILTER_INPUT,
					value,
					placeholder: "筛选",
					onChange: (event) => onChange(column.key, event.target.value)
				});
				return react.default.createElement("div", { style: {
					position: "relative",
					display: "inline-flex"
				} }, react.default.createElement("button", {
					type: "button",
					title: `筛选${columnLabel(column.key, view, level)}`,
					"aria-label": `筛选${columnLabel(column.key, view, level)}`,
					"aria-expanded": open,
					onClick: () => setFilterMenu(open ? null : {
						level,
						key: column.key
					}),
					style: {
						border: 0,
						background: "transparent",
						padding: 1,
						cursor: "pointer",
						fontSize: 16,
						lineHeight: 1,
						color: value === "" ? "var(--dsw-alias-label-tertiary)" : "var(--dsw-alias-label-primary)"
					}
				}, "⌕"), open ? react.default.createElement("div", { style: {
					position: "absolute",
					right: 0,
					top: "100%",
					zIndex: 6,
					minWidth: 140,
					padding: 4,
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					border: TABLE_BORDER,
					borderRadius: 6,
					boxShadow: "0 6px 18px rgba(0,0,0,0.12)"
				} }, control) : null);
			};
			const headerCell = (column, current, onSort, currentFilter, onFilter, rows, level) => react.default.createElement("th", {
				key: `${level}-${column.key}`,
				scope: "col",
				style: column.left ? TABLE_HEAD_LEFT : TABLE_HEAD
			}, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: column.left ? "flex-start" : "flex-end",
				gap: 4,
				minWidth: column.compact ? 180 : 72
			} }, headerButton(column, current, onSort, level), filterControl(column, currentFilter, onFilter, rows, level)));
			const dataCells = (row, columns, first, child = false) => columns.map((column, index) => react.default.createElement("td", {
				key: column.key,
				style: {
					...column.left ? TABLE_CELL_LEFT : column.key === "usage" ? {
						...TABLE_CELL,
						fontWeight: 600
					} : TABLE_CELL,
					...child ? {
						background: "var(--dsw-alias-bg-layer-2, #fafafa)",
						color: "var(--dsw-alias-label-secondary)"
					} : { fontWeight: 600 },
					whiteSpace: column.compact ? "pre-line" : "nowrap",
					lineHeight: column.compact ? 1.35 : void 0
				},
				title: column.key === "sessionId" ? row.sessionId : formatCostCell(row, column.key, props.symbol, props.unitTokens)
			}, index === 0 ? first : formatCostCell(row, column.key, props.symbol, props.unitTokens)));
			const viewChip = (id, label) => react.default.createElement("button", {
				type: "button",
				onClick: () => setViewMode(id),
				"aria-pressed": view === id,
				style: {
					...buttonStyle,
					padding: "4px 10px",
					background: view === id ? "var(--dsw-alias-label-primary)" : "transparent",
					color: view === id ? "var(--dsw-alias-bg-layer-3)" : "var(--dsw-alias-label-secondary)"
				}
			}, label);
			const columnPicker = (level) => {
				const keys = optionalCostTableColumns(level).filter((key) => view !== "model" || key !== "route");
				const chosen = level === "parent" ? selected : childSelected;
				const setChosen = level === "parent" ? setSelected : setChildSelected;
				return react.default.createElement("div", { style: { position: "relative" } }, react.default.createElement("button", {
					type: "button",
					style: buttonStyle,
					"aria-expanded": columnMenu === level,
					onClick: () => setColumnMenu((open) => open === level ? null : level)
				}, level === "parent" ? "汇总列" : "明细列"), columnMenu === level ? react.default.createElement("div", { style: {
					position: "absolute",
					right: 0,
					top: "100%",
					marginTop: 4,
					zIndex: 5,
					minWidth: 180,
					padding: 8,
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					border: TABLE_BORDER,
					borderRadius: 8,
					boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
					display: "flex",
					flexDirection: "column",
					gap: 6
				} }, ...keys.map((key) => react.default.createElement("label", {
					key,
					style: {
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontSize: 12
					}
				}, react.default.createElement("input", {
					type: "checkbox",
					checked: chosen.includes(key),
					onChange: (event) => setChosen((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))
				}), columnLabel(key, view, level)))) : null);
			};
			const hasFilter = Object.keys(filter).length > 0 || Object.keys(childFilter).length > 0;
			if (props.entries.length === 0) return react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, props.empty);
			const childTable = (rows) => react.default.createElement("table", { style: {
				width: "100%",
				minWidth: 720,
				borderCollapse: "collapse",
				whiteSpace: "nowrap"
			} }, react.default.createElement("thead", null, react.default.createElement("tr", null, ...childColumns.map((column) => headerCell(column, childSort, setChildSort, childFilter, setChildFilterValue, childRows, "child")))), react.default.createElement("tbody", null, rows.length === 0 ? react.default.createElement("tr", null, react.default.createElement("td", {
				style: {
					...TABLE_CELL_LEFT,
					color: "var(--dsw-alias-label-tertiary)"
				},
				colSpan: childColumns.length
			}, "没有符合筛选的明细")) : null, ...rows.map((child) => react.default.createElement("tr", { key: child.id }, ...dataCells(child, childColumns, formatCostCell(child, "dimension", props.symbol, props.unitTokens), true)))));
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10,
				minHeight: 0,
				flex: 1
			} }, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8,
				flexWrap: "wrap"
			} }, react.default.createElement("div", {
				role: "tablist",
				style: {
					display: "flex",
					gap: 6
				}
			}, viewChip("time", "按日期"), viewChip("model", "按模型")), react.default.createElement("div", { style: {
				display: "flex",
				gap: 6,
				alignItems: "center"
			} }, hasFilter ? react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				onClick: () => {
					setFilter({});
					setChildFilter({});
				}
			}, "清除筛选") : null, columnPicker("parent"), columnPicker("child"))), react.default.createElement("div", { style: {
				overflow: "auto",
				fontSize: 12,
				border: TABLE_BORDER,
				borderRadius: 8,
				minHeight: 0,
				flex: 1
			} }, react.default.createElement("table", { style: {
				width: "100%",
				minWidth: 960,
				borderCollapse: "collapse"
			} }, react.default.createElement("thead", null, react.default.createElement("tr", null, ...parentColumns.map((column) => headerCell(column, sort, setSort, filter, setFilterValue, allRows, "parent")))), react.default.createElement("tbody", null, groups.length === 0 ? react.default.createElement("tr", null, react.default.createElement("td", {
				style: {
					...TABLE_CELL_LEFT,
					color: "var(--dsw-alias-label-tertiary)"
				},
				colSpan: parentColumns.length
			}, "没有符合筛选的明细")) : null, ...groups.flatMap((group) => {
				const open = expanded.has(group.id);
				const summaryFirst = react.default.createElement("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: 6
				} }, react.default.createElement("button", {
					type: "button",
					"aria-expanded": open,
					"aria-label": open ? `收起${group.summary.dimension}` : `展开${group.summary.dimension}`,
					onClick: () => toggleGroup(group.id),
					style: {
						width: 18,
						height: 18,
						padding: 0,
						border: TABLE_BORDER,
						borderRadius: 3,
						background: "var(--dsw-alias-bg-layer-1, #fff)",
						cursor: "pointer",
						font: "inherit",
						fontSize: 12,
						lineHeight: "16px"
					}
				}, open ? "−" : "+"), formatCostCell(group.summary, "dimension", props.symbol, props.unitTokens));
				const childBlock = open ? react.default.createElement("tr", { key: `${group.id}-children` }, react.default.createElement("td", {
					colSpan: parentColumns.length,
					style: {
						...TABLE_CELL_LEFT,
						padding: 0,
						background: "var(--dsw-alias-bg-layer-2, #fafafa)"
					}
				}, react.default.createElement("div", { style: { padding: "8px 12px 12px 36px" } }, childTable(group.children)))) : null;
				return [react.default.createElement("tr", { key: group.id }, ...dataCells(group.summary, parentColumns, summaryFirst, false)), ...childBlock === null ? [] : [childBlock]];
			}), groups.length > 0 ? react.default.createElement("tr", { style: { fontWeight: 600 } }, ...parentColumns.map((column, index) => react.default.createElement("td", {
				key: column.key,
				style: index === 0 ? {
					...TABLE_CELL_LEFT,
					fontWeight: 600
				} : column.key === "usage" ? {
					...TABLE_CELL,
					fontWeight: 600
				} : TABLE_CELL
			}, index === 0 ? `合计 ${groups.length} 组 / ${detailCount} 条` : formatCostCell({
				...rowZero,
				...totals
			}, column.key, props.symbol, props.unitTokens)))) : null))));
		}
		const rowZero = {
			id: "",
			dimension: "",
			date: "",
			hour: "",
			hourLabel: "",
			sessionId: "",
			origin: "",
			route: "",
			periodName: "",
			surcharge: "",
			turns: 0,
			steps: 0,
			toolCalls: 0,
			inputTokens: 0,
			inputCost: 0,
			cacheTokens: 0,
			cacheCost: 0,
			outputTokens: 0,
			outputCost: 0,
			cacheRate: 0,
			cost: 0,
			inputRate: null,
			cacheReadRate: null,
			cacheWriteRate: null,
			outputRate: null
		};
		const DOCK_TEXT = {
			margin: 0,
			padding: "2px 16px 0",
			textAlign: "center",
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 12,
			lineHeight: "20px"
		};
		const DOCK_ACTION = {
			display: "inline",
			padding: 0,
			border: "none",
			background: "none",
			color: "inherit",
			font: "inherit",
			lineHeight: "inherit",
			cursor: "pointer",
			textDecoration: "none"
		};
		const BALANCE_CARD = {
			display: "inline-flex",
			flexDirection: "column",
			justifyContent: "center",
			alignItems: "flex-start",
			gap: 0,
			minHeight: 32,
			padding: "2px 10px",
			flex: "none",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 12,
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			textDecoration: "none",
			cursor: "pointer",
			lineHeight: 1.2,
			whiteSpace: "nowrap"
		};
		function CostModal(props) {
			return react.default.createElement("div", {
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 9999,
					background: "rgba(0,0,0,0.5)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: 20
				},
				onClick: props.onClose
			}, react.default.createElement("div", {
				style: {
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					borderRadius: 12,
					padding: 24,
					width: "min(1680px, 98vw)",
					maxHeight: "90vh",
					overflow: "hidden",
					boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
					display: "flex",
					flexDirection: "column",
					gap: 16
				},
				onClick: (event) => event.stopPropagation()
			}, react.default.createElement("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: 12
			} }, react.default.createElement("h2", { style: {
				margin: 0,
				fontSize: 18,
				fontWeight: 600
			} }, props.title), react.default.createElement("button", {
				type: "button",
				style: {
					background: "none",
					border: "none",
					color: "inherit",
					fontSize: 20,
					cursor: "pointer",
					padding: "4px 8px",
					borderRadius: 4
				},
				onClick: props.onClose,
				"aria-label": "关闭"
			}, "✕")), react.default.createElement("div", { style: {
				minHeight: 0,
				flex: 1,
				overflow: "hidden",
				display: "flex",
				flexDirection: "column"
			} }, props.children)));
		}
		function BalanceHeader(props) {
			const [balances, setBalances] = react.default.useState([]);
			react.default.useEffect(() => {
				let loading = false;
				const load = () => {
					if (loading) return;
					loading = true;
					props.costMeter.providerBalances().then((response) => {
						if (response.ok && Array.isArray(response.value)) setBalances(response.value);
					}).catch(() => {}).finally(() => {
						loading = false;
					});
				};
				load();
				return props.interval(load, 5e3);
			}, []);
			const cards = [];
			for (const item of collapseBalanceChips(balances)) {
				const href = walletHref(item.origin);
				if (href === void 0) continue;
				cards.push(react.default.createElement("a", {
					key: href,
					href,
					target: "_blank",
					rel: "noreferrer",
					style: BALANCE_CARD,
					title: href
				}, react.default.createElement("span", { style: {
					fontSize: 11,
					color: "var(--dsw-alias-label-tertiary)",
					maxWidth: 160,
					overflow: "hidden",
					textOverflow: "ellipsis"
				} }, item.name), react.default.createElement("span", { style: {
					display: "inline-flex",
					alignItems: "baseline",
					gap: 6
				} }, react.default.createElement("span", { style: {
					fontSize: 13,
					fontWeight: 600
				} }, `${currencySymbol(item.unit)}${money(item.remaining ?? 0)}`), react.default.createElement("span", { style: {
					fontSize: 10,
					color: "var(--dsw-alias-label-tertiary)"
				} }, new Date(item.observedAt).toLocaleTimeString("zh-CN", { hour12: false })))));
			}
			if (cards.length === 0) return null;
			return react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "stretch",
				gap: 8,
				minWidth: 0,
				overflowX: "auto",
				flexWrap: "nowrap"
			} }, ...cards);
		}
		function CostDock(props) {
			const [state, setState] = react.default.useState(null);
			const [sessionRows, setSessionRows] = react.default.useState([]);
			const [sessionLoadError, setSessionLoadError] = react.default.useState(null);
			const [sessionLoading, setSessionLoading] = react.default.useState(false);
			const [modal, setModal] = react.default.useState(null);
			react.default.useEffect(() => {
				let loading = false;
				const load = () => {
					if (typeof props.sessionId !== "string" || loading) return;
					loading = true;
					props.costMeter.sessionCost(props.sessionId).then((response) => {
						if (response.ok && response.value && typeof response.value === "object") setState(response.value);
					}).catch(() => {}).finally(() => {
						loading = false;
					});
				};
				load();
				return props.interval(load, 5e3);
			}, [props.sessionId]);
			react.default.useEffect(() => {
				let loading = false;
				const load = () => {
					if (loading) return;
					loading = true;
					setSessionLoading(true);
					loadAllSessionCosts(props.costMeter, props.sessions).then((rows) => {
						setSessionRows(rows);
						setSessionLoadError(null);
					}).catch((error) => {
						setSessionLoadError(`会话费用加载失败：${remoteErrorText(error)}`);
					}).finally(() => {
						loading = false;
						setSessionLoading(false);
					});
				};
				load();
				return props.interval(load, 3e4);
			}, []);
			const symbol = currencySymbol(state?.currency ?? sessionRows[0]?.cost.currency ?? "CNY");
			const unitTokens = state?.unitTokens ?? sessionRows[0]?.cost.unitTokens ?? 1e6;
			const today = localTodayDate();
			const todayCost = overviewCost(sessionRows, today);
			const historyCost = overviewCost(sessionRows);
			const allEntries = flattenHourlyEntries(sessionRows);
			const todayEntries = allEntries.filter((item) => localDateOfHour(item.entry.hour) === today);
			const costText = (label, value, view) => react.default.createElement("button", {
				type: "button",
				style: DOCK_ACTION,
				onClick: () => setModal(view),
				title: label
			}, `${label} ${symbol}${money(value)}`);
			const loading = sessionLoading && sessionRows.length === 0 ? react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "正在加载…") : null;
			const error = sessionLoadError ? react.default.createElement("p", {
				role: "alert",
				style: {
					margin: 0,
					fontSize: 12,
					color: "var(--dsw-alias-label-error)"
				}
			}, sessionLoadError) : null;
			const parts = [
				costText("本会话", state?.cost ?? 0, "session"),
				costText("今日", todayCost, "today"),
				costText("累计", historyCost, "history")
			];
			return react.default.createElement(react.default.Fragment, null, react.default.createElement("p", { style: DOCK_TEXT }, ...parts.flatMap((part, index) => index === 0 ? [part] : [" · ", part])), modal === "session" ? react.default.createElement(CostModal, {
				title: "本会话费用",
				onClose: () => setModal(null),
				children: react.default.createElement(CostTable, {
					entries: flattenFoldEntries(props.sessionId, state),
					symbol,
					unitTokens,
					empty: "本会话还没有可统计的用量。"
				})
			}) : null, modal === "today" ? react.default.createElement(CostModal, {
				title: `今日费用 · ${today}`,
				onClose: () => setModal(null),
				children: react.default.createElement("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: 8,
					minHeight: 0,
					flex: 1
				} }, loading, error, react.default.createElement(CostTable, {
					entries: todayEntries,
					symbol,
					unitTokens,
					empty: "今天还没有费用。"
				}))
			}) : null, modal === "history" ? react.default.createElement(CostModal, {
				title: "累计费用",
				onClose: () => setModal(null),
				children: react.default.createElement("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: 8,
					minHeight: 0,
					flex: 1
				} }, loading, error, react.default.createElement(CostTable, {
					entries: allEntries,
					symbol,
					unitTokens,
					empty: "还没有历史费用。"
				}))
			}) : null);
		}
		async function apply(ctx) {
			const remote = ctx.get("remote");
			if (!remote) return;
			await remote.$mount({
				package: "dsh-cost-meter",
				descriptors: [
					{
						id: "dsh-cost-meter#costMeter/sessionCost",
						service: "costMeter",
						namespace: "costMeter",
						method: "sessionCost",
						invocation: { kind: "direct" },
						parameters: [{
							name: "sessionId",
							wire: "sessionId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-cost-meter#sessionCost#sessionId",
								schema: {
									_zod: true,
									parse: (value) => value
								}
							}
						}],
						result: {
							mode: "strict",
							typeSymbol: "dsh-cost-meter#sessionCost#result",
							schema: {
								_zod: true,
								parse: (value) => value
							}
						}
					},
					{
						id: "dsh-cost-meter#costMeter/sessionCosts",
						service: "costMeter",
						namespace: "costMeter",
						method: "sessionCosts",
						invocation: { kind: "direct" },
						parameters: [],
						result: {
							mode: "strict",
							typeSymbol: "dsh-cost-meter#sessionCosts#result",
							schema: {
								_zod: true,
								parse: (value) => value
							}
						}
					},
					{
						id: "dsh-cost-meter#costMeter/providerBalances",
						service: "costMeter",
						namespace: "costMeter",
						method: "providerBalances",
						invocation: { kind: "direct" },
						parameters: [],
						result: {
							mode: "strict",
							typeSymbol: "dsh-cost-meter#providerBalances#result",
							schema: {
								_zod: true,
								parse: (value) => value
							}
						}
					}
				]
			});
			const slots = ctx.get("slots");
			const costMeter = ctx.get("remote.costMeter");
			if (!slots || !costMeter) return;
			const pricing = new PricingRouteSource();
			pricing.load();
			const catalog = new CatalogSource({ llm: { models: async () => ({ result: {
				ok: true,
				value: { groups: [] }
			} }) } });
			catalog.load();
			const remoteEvents = ctx.get("remote");
			ctx.effect(() => remoteEvents.$on?.("llm/adapters-updated", () => {
				catalog.load();
			}) ?? (() => {}), "cost-meter catalog updates");
			slots.inject("conversation.session.header.utilities", () => slots.register({
				name: "conversation.session.header.utilities",
				id: "cost-meter-balance",
				order: 40
			}, () => react.default.createElement(BalanceHeader, {
				costMeter,
				interval: browserInterval
			})));
			slots.inject("conversation.composer.dock", () => slots.register({
				name: "conversation.composer.dock",
				id: "cost-meter",
				order: 40
			}, (props) => react.default.createElement(CostDock, {
				...props,
				costMeter,
				sessions: void 0,
				interval: browserInterval
			})));
			slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "cost-meter",
				order: 25,
				label: "API 费用",
				inject: () => ({
					hooks: {
						pricing,
						catalog
					},
					refreshCatalog: catalog.load,
					refreshPricing: pricing.load,
					interval: browserInterval,
					save: (config) => pricing.save(config)
				})
			}, PricingSettingsCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map