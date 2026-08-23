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
		const DEFAULT_PRICING = {
			currency: "CNY",
			unitTokens: 1e6,
			timezone: "Asia/Shanghai",
			default: {
				rates: {
					input: 1,
					cacheRead: .02,
					cacheWrite: 1,
					output: 2
				},
				periods: []
			},
			models: {}
		};
		const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
		const RATE_KEYS = [
			"input",
			"cacheRead",
			"cacheWrite",
			"output"
		];
		function routeKey(provider, model) {
			return provider && model ? `${provider}/${model}` : null;
		}
		function minuteOfDay(value) {
			const [hour, minute] = value.split(":").map(Number);
			return hour * 60 + minute;
		}
		/** Compact a token threshold for UI labels, e.g. 200000 → `200K`. */
		function formatTokenThreshold(tokens) {
			if (Number.isSafeInteger(tokens) && tokens >= 1e6 && tokens % 1e6 === 0) return `${tokens / 1e6}M`;
			if (Number.isSafeInteger(tokens) && tokens >= 1e3 && tokens % 1e3 === 0) return `${tokens / 1e3}K`;
			return tokens.toLocaleString("zh-CN");
		}
		/**
		* @param afterTokens Threshold that triggered the surcharge, or null when none applied.
		* @param multiplier Request-wide cost multiplier.
		* @returns A label such as `超过 200K ×2`, or null when the request is uncharged.
		*/
		function formatContextSurcharge(afterTokens, multiplier) {
			if (multiplier === void 0 || multiplier === null || multiplier === 1) return null;
			if (afterTokens === void 0 || afterTokens === null) return `×${multiplier}`;
			return `超过 ${formatTokenThreshold(afterTokens)} ×${multiplier}`;
		}
		function assertRates(rates, path, complete) {
			for (const key of RATE_KEYS) {
				const value = rates[key];
				if (value === void 0) {
					if (complete) throw new TypeError(`${path}.${key} is required`);
					continue;
				}
				if (!Number.isFinite(value) || value < 0) throw new TypeError(`${path}.${key} must be a non-negative finite number`);
			}
		}
		function minuteSegments(period) {
			const start = minuteOfDay(period.start);
			const end = minuteOfDay(period.end);
			return start < end ? [[start, end]] : [[start, 1440], [0, end]];
		}
		function overlaps(left, right) {
			return minuteSegments(left).some(([leftStart, leftEnd]) => minuteSegments(right).some(([rightStart, rightEnd]) => Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd)));
		}
		function assertPeriods(periods, path) {
			if (periods === void 0) return;
			const ids = /* @__PURE__ */ new Set();
			for (const [index, period] of periods.entries()) {
				const itemPath = `${path}[${index}]`;
				if (period.id.trim() === "" || ids.has(period.id)) throw new TypeError(`${itemPath}.id must be unique and non-empty`);
				ids.add(period.id);
				if (period.name.trim() === "") throw new TypeError(`${itemPath}.name is required`);
				if (!TIME_PATTERN.test(period.start) || !TIME_PATTERN.test(period.end) || period.start === period.end) throw new TypeError(`${itemPath} must use distinct HH:mm start and end times`);
				assertRates(period.rates, `${itemPath}.rates`, false);
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
				if (!Number.isFinite(tier.multiplier) || tier.multiplier < 0) throw new TypeError(`${itemPath}.multiplier must be a non-negative finite number`);
			}
		}
		function validatePricing(config) {
			if (config.currency.trim() === "" || config.currency.length > 8) throw new TypeError("currency must contain 1-8 characters");
			if (!Number.isSafeInteger(config.unitTokens) || config.unitTokens < 1) throw new TypeError("unitTokens must be a positive safe integer");
			try {
				new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format(0);
			} catch {
				throw new TypeError(`timezone "${config.timezone}" is not an IANA time zone`);
			}
			assertRates(config.default.rates, "default.rates", true);
			assertPeriods(config.default.periods, "default.periods");
			assertContextSurcharges(config.default.contextSurcharges, "default.contextSurcharges");
			for (const [key, plan] of Object.entries(config.models)) {
				if (key.trim() === "" || !key.includes("/")) throw new TypeError(`model key "${key}" must be provider/model`);
				if (plan.rates !== void 0) assertRates(plan.rates, `models.${key}.rates`, false);
				assertPeriods(plan.periods, `models.${key}.periods`);
				assertContextSurcharges(plan.contextSurcharges, `models.${key}.contextSurcharges`);
			}
		}
		//#endregion
		//#region src/session-table.ts
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
		/** Distinct provider/model routes observed on one session fold. */
		function sessionRoutes(row) {
			const routes = /* @__PURE__ */ new Set();
			if (row.cost.route) routes.add(row.cost.route);
			for (const hourly of row.cost.hourly ?? []) {
				const key = routeLabel(hourly.provider, hourly.model);
				if (key) routes.add(key);
			}
			for (const detail of row.cost.details ?? []) {
				const key = routeLabel(detail.provider, detail.model);
				if (key) routes.add(key);
			}
			return [...routes];
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
				periodName: null
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
				contextMultiplier: value.contextMultiplier,
				contextAfterTokens: value.contextAfterTokens ?? null
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
		//#endregion
		//#region src/client.ts
		const inject = [
			"slots",
			"remote",
			"timer",
			"connection"
		];
		function remoteErrorText(error) {
			if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
			return error === void 0 ? "未知错误" : String(error);
		}
		const SESSION_COST_CONCURRENCY = 8;
		async function loadAllSessionCosts(costMeter, sessions) {
			const remote = await costMeter.sessionCosts();
			if (remote.ok && Array.isArray(remote.value)) return remote.value;
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
						this.snapshot = body.ok && body.value ? {
							status: "ready",
							value: body.value,
							revision: 0,
							writable: true
						} : {
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
						body: JSON.stringify(config)
					});
					if (!response.ok) return false;
					const body = await response.json();
					if (body.ok && body.value) {
						this.snapshot = {
							status: "ready",
							value: body.value,
							revision: 0,
							writable: true
						};
						for (const listener of this.listeners) listener();
					}
					return body.ok === true;
				} catch {
					return false;
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
		const cloneConfig = (value) => JSON.parse(JSON.stringify(value ?? DEFAULT_PRICING));
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
		const surchargeLabel = (afterTokens, multiplier) => formatContextSurcharge(afterTokens, multiplier) ?? "-";
		const RATE_FIELDS = [
			{
				key: "input",
				label: "未缓存输入"
			},
			{
				key: "cacheRead",
				label: "缓存读取"
			},
			{
				key: "cacheWrite",
				label: "缓存写入"
			},
			{
				key: "output",
				label: "输出"
			}
		];
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
		function RatesGrid(props) {
			return react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "repeat(4, minmax(96px, 1fr))",
				gap: 8
			} }, ...RATE_FIELDS.map((field) => react.default.createElement("label", {
				key: field.key,
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 5,
					fontSize: 11,
					color: "var(--dsw-alias-label-tertiary)"
				}
			}, field.label, react.default.createElement(NumberInput, {
				value: props.rates[field.key],
				placeholder: props.fallback ? String(props.fallback[field.key]) : void 0,
				onChange: (value) => props.onChange({
					...props.rates,
					[field.key]: value
				})
			}))));
		}
		function PeriodEditor(props) {
			const set = (key, value) => props.onChange({
				...props.period,
				[key]: value
			});
			return react.default.createElement("div", { style: {
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				paddingTop: 10,
				display: "flex",
				flexDirection: "column",
				gap: 8
			} }, react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "minmax(120px, 1fr) 100px 100px auto",
				gap: 8,
				alignItems: "end"
			} }, react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "时段名称", react.default.createElement("input", {
				style: inputStyle,
				value: props.period.name,
				onChange: (event) => set("name", event.target.value)
			})), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "开始", react.default.createElement("input", {
				style: inputStyle,
				type: "time",
				value: props.period.start,
				onChange: (event) => set("start", event.target.value)
			})), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "结束", react.default.createElement("input", {
				style: inputStyle,
				type: "time",
				value: props.period.end,
				onChange: (event) => set("end", event.target.value)
			})), react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				onClick: props.onRemove
			}, "删除")), react.default.createElement(RatesGrid, {
				rates: props.period.rates,
				fallback: props.fallback,
				onChange: (rates) => set("rates", rates)
			}));
		}
		function PeriodsEditor(props) {
			const add = () => props.onChange([...props.periods, {
				id: `period-${Date.now()}-${props.periods.length}`,
				name: "低峰",
				start: "00:00",
				end: "08:00",
				rates: {}
			}]);
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, ...props.periods.map((period, index) => react.default.createElement(PeriodEditor, {
				key: period.id,
				period,
				fallback: props.fallback,
				onChange: (next) => props.onChange(props.periods.map((item, at) => at === index ? next : item)),
				onRemove: () => props.onChange(props.periods.filter((_item, at) => at !== index))
			})), react.default.createElement("button", {
				type: "button",
				style: {
					...buttonStyle,
					alignSelf: "flex-start"
				},
				onClick: add
			}, "+ 添加计价时段"));
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
			} }, "超过 Token 数", react.default.createElement(NumberInput, {
				value: tier.afterTokens,
				onChange: (value) => set(index, {
					...tier,
					afterTokens: value ?? 0
				})
			})), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "整单倍率", react.default.createElement(NumberInput, {
				value: tier.multiplier,
				onChange: (value) => set(index, {
					...tier,
					multiplier: value ?? 0
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
		function ModelPricingRow(props) {
			const key = routeKey(props.provider.id, props.model.id);
			const plan = props.config.models[key];
			const enabled = plan !== void 0;
			const [collapsed, setCollapsed] = react.default.useState(true);
			const setPlan = (next) => props.onChange({
				...props.config,
				models: {
					...props.config.models,
					[key]: next
				}
			});
			const toggle = () => {
				if (enabled) {
					const { [key]: _removed, ...models } = props.config.models;
					props.onChange({
						...props.config,
						models
					});
				} else setPlan({
					rates: {},
					periods: []
				});
			};
			return react.default.createElement("div", { style: {
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				padding: "12px 0",
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
				fontWeight: 500,
				color: "var(--dsw-alias-label-primary)"
			} }, props.model.name), react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginTop: 2
			} }, key)), react.default.createElement("span", { style: {
				fontSize: 11,
				color: enabled ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-label-tertiary)"
			} }, enabled ? "专属计价" : "使用默认价格"), react.default.createElement("input", {
				type: "checkbox",
				checked: enabled,
				onClick: (event) => event.stopPropagation(),
				onChange: toggle,
				"aria-label": `${key} 专属计价`
			})), !collapsed && enabled && plan ? react.default.createElement(react.default.Fragment, null, react.default.createElement(RatesGrid, {
				rates: plan.rates ?? {},
				fallback: props.config.default.rates,
				onChange: (rates) => setPlan({
					...plan,
					rates
				})
			}), react.default.createElement(PeriodsEditor, {
				periods: plan.periods ?? [],
				fallback: {
					...props.config.default.rates,
					...plan.rates ?? {}
				},
				onChange: (periods) => setPlan({
					...plan,
					periods
				})
			}), react.default.createElement(ContextSurchargesEditor, {
				tiers: plan.contextSurcharges ?? [],
				hint: "未配置时沿用默认上下文翻倍；清空列表表示该模型不翻倍。单次请求上下文（未缓存输入 + 缓存读 + 缓存写）超过阈值后，该请求整单费用按倍率计。",
				onChange: (contextSurcharges) => setPlan({
					...plan,
					contextSurcharges
				})
			})) : null);
		}
		function PricingSettingsCard(props) {
			const settings = props.usePricing((snapshot) => snapshot);
			const catalog = props.useCatalog((snapshot) => snapshot);
			const [open, setOpen] = react.default.useState(false);
			const [draft, setDraft] = react.default.useState(() => cloneConfig(settings.value));
			const [seedRevision, setSeedRevision] = react.default.useState(settings.revision);
			const [saving, setSaving] = react.default.useState(false);
			const [saved, setSaved] = react.default.useState(false);
			const [failure, setFailure] = react.default.useState(null);
			react.default.useEffect(() => {
				if (settings.revision !== seedRevision) {
					setDraft(cloneConfig(settings.value));
					setSeedRevision(settings.revision);
					setFailure(null);
				}
			}, [
				settings.revision,
				settings.value,
				seedRevision
			]);
			react.default.useEffect(() => {
				if (open) props.refreshCatalog();
			}, [open, props.refreshCatalog]);
			if (settings.status === "unavailable") return null;
			const baseline = cloneConfig(settings.value);
			const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
			let invalid = null;
			try {
				validatePricing(draft);
			} catch (error) {
				invalid = error instanceof Error ? error.message : String(error);
			}
			const setDefaultRates = (rates) => setDraft({
				...draft,
				default: {
					...draft.default,
					rates
				}
			});
			const displayGroups = catalog.groups;
			const save = async () => {
				if (invalid || !dirty) return;
				setSaving(true);
				setFailure(null);
				const ok = await props.save(draft, settings.revision);
				setSaving(false);
				if (ok) {
					setSaved(true);
					setTimeout(() => setSaved(false), 2e3);
				} else setFailure("保存失败，请检查配置或刷新后重试。");
			};
			return react.default.createElement("li", { style: {
				listStyle: "none",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				background: "var(--dsw-alias-bg-layer-3)"
			} }, react.default.createElement("button", {
				type: "button",
				onClick: () => setOpen(!open),
				"aria-expanded": open,
				style: {
					width: "100%",
					border: 0,
					background: "transparent",
					color: "inherit",
					textAlign: "left",
					padding: "14px 16px",
					display: "flex",
					alignItems: "center",
					gap: 12,
					cursor: "pointer"
				}
			}, react.default.createElement("span", { style: {
				flex: 1,
				display: "flex",
				flexDirection: "column",
				gap: 4
			} }, react.default.createElement("strong", { style: {
				fontSize: 15,
				fontWeight: 600
			} }, "API 费用统计"), react.default.createElement("span", { style: {
				fontSize: 13,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "按实际 provider、模型和时段配置估算输入、缓存与输出费用。")), dirty ? react.default.createElement("span", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-secondary)"
			} }, "未保存") : null, react.default.createElement("span", {
				"aria-hidden": true,
				style: { transform: open ? "rotate(180deg)" : void 0 }
			}, "⌄")), open ? react.default.createElement("div", { style: {
				margin: "0 16px",
				padding: "14px 0 10px",
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				display: "flex",
				flexDirection: "column",
				gap: 16
			} }, react.default.createElement("section", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("h3", { style: {
				margin: 0,
				fontSize: 13,
				fontWeight: 600
			} }, "默认计价"), react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "120px 160px 1fr",
				gap: 8
			} }, react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "币种", react.default.createElement("input", {
				style: inputStyle,
				value: draft.currency,
				onChange: (event) => setDraft({
					...draft,
					currency: event.target.value.toUpperCase()
				})
			})), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "每多少 Token", react.default.createElement(NumberInput, {
				value: draft.unitTokens,
				onChange: (value) => setDraft({
					...draft,
					unitTokens: value ?? 0
				})
			})), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "计价时区", react.default.createElement("input", {
				style: inputStyle,
				value: draft.timezone,
				onChange: (event) => setDraft({
					...draft,
					timezone: event.target.value
				})
			}))), react.default.createElement(RatesGrid, {
				rates: draft.default.rates,
				onChange: setDefaultRates
			}), react.default.createElement(PeriodsEditor, {
				periods: draft.default.periods ?? [],
				fallback: draft.default.rates,
				onChange: (periods) => setDraft({
					...draft,
					default: {
						...draft.default,
						periods
					}
				})
			}), react.default.createElement("h4", { style: {
				margin: "6px 0 0",
				fontSize: 12,
				fontWeight: 600
			} }, "上下文翻倍"), react.default.createElement(ContextSurchargesEditor, {
				tiers: draft.default.contextSurcharges ?? [],
				onChange: (contextSurcharges) => setDraft({
					...draft,
					default: {
						...draft.default,
						contextSurcharges
					}
				})
			})), react.default.createElement("section", null, react.default.createElement("h3", { style: {
				margin: "0 0 4px",
				fontSize: 13,
				fontWeight: 600
			} }, "可用模型"), react.default.createElement("p", { style: {
				margin: "0 0 8px",
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "未启用专属计价的模型自动使用默认价格。空白专属字段也逐项回退到默认价格。"), catalog.status === "loading" ? react.default.createElement("p", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "正在加载模型…") : null, catalog.status === "error" ? react.default.createElement("p", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-error)"
			} }, "模型目录加载失败。") : null, ...displayGroups.flatMap((group) => [react.default.createElement("h4", {
				key: `group:${group.id}`,
				style: {
					margin: "14px 0 0",
					fontSize: 12,
					color: "var(--dsw-alias-label-secondary)"
				}
			}, `${group.name} · ${group.id}`), ...group.models.map((model) => react.default.createElement(ModelPricingRow, {
				key: `${group.id}/${model.id}`,
				provider: group,
				model,
				config: draft,
				onChange: setDraft
			}))])), invalid ? react.default.createElement("p", {
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
			}, saving ? "保存中…" : saved ? "✓ 保存成功" : "保存"))) : null);
		}
		const EMPTY_HOURLY_FILTER = {
			date: "",
			hour: "",
			sessionId: "",
			origin: "",
			route: ""
		};
		function HourlyTable(props) {
			const routeOf = (row) => `${row.provider ?? ""}/${row.model ?? ""}`;
			const flatten = (rows) => rows.flatMap((row) => [...(row.hourly ?? []).map((entry) => ({
				sessionId: row.sessionId,
				entry
			})), ...flatten(row.children)]);
			const childRows = flatten(props.subagents ?? []);
			const sumRows = (rows) => {
				const first = rows[0];
				if (first === void 0) return null;
				const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
				const inputTokens = sum("inputTokens");
				const cacheReadTokens = sum("cacheReadTokens");
				const cacheWriteTokens = sum("cacheWriteTokens");
				const outputTokens = sum("outputTokens");
				return {
					...first,
					turns: sum("turns"),
					steps: sum("steps"),
					toolCalls: sum("toolCalls"),
					inputTokens,
					cacheReadTokens,
					cacheWriteTokens,
					outputTokens,
					inputCost: sum("inputCost"),
					cacheReadCost: sum("cacheReadCost"),
					cacheWriteCost: sum("cacheWriteCost"),
					outputCost: sum("outputCost"),
					cost: sum("cost"),
					cacheRate: (cacheReadTokens + cacheWriteTokens) / Math.max(1, inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens),
					provider: null,
					model: null,
					pricingSource: null,
					periodName: null
				};
			};
			const dataCells = (row) => [
				react.default.createElement("td", { style: props.cellBase }, String(row.turns)),
				react.default.createElement("td", { style: props.cellBase }, String(row.steps)),
				react.default.createElement("td", { style: props.cellBase }, String(row.toolCalls)),
				react.default.createElement("td", { style: props.cellBase }, row.inputTokens.toLocaleString("zh-CN")),
				react.default.createElement("td", { style: props.cellBase }, `${props.symbol}${money(row.inputCost)}`),
				react.default.createElement("td", { style: props.cellBase }, (row.cacheReadTokens + row.cacheWriteTokens).toLocaleString("zh-CN")),
				react.default.createElement("td", { style: props.cellBase }, `${props.symbol}${money(row.cacheReadCost + row.cacheWriteCost)}`),
				react.default.createElement("td", { style: props.cellBase }, row.outputTokens.toLocaleString("zh-CN")),
				react.default.createElement("td", { style: props.cellBase }, `${props.symbol}${money(row.outputCost)}`),
				react.default.createElement("td", { style: props.cellBase }, `${(row.cacheRate * 100).toFixed(1)}%`),
				react.default.createElement("td", { style: {
					...props.cellBase,
					fontWeight: 600
				} }, `${props.symbol}${money(row.cost)}`)
			];
			const hours = [.../* @__PURE__ */ new Set([...props.hourly.map((row) => row.hour), ...childRows.map((row) => row.entry.hour)])].sort();
			const totals = sumRows([...props.hourly, ...childRows.map((row) => row.entry)]);
			return react.default.createElement("table", { style: {
				width: "100%",
				borderCollapse: "collapse",
				whiteSpace: "nowrap",
				marginTop: 8
			} }, react.default.createElement("thead", null, react.default.createElement("tr", null, react.default.createElement("th", { style: props.headerLeft }, "时间段"), react.default.createElement("th", { style: props.headerStyle }, "轮次"), react.default.createElement("th", { style: props.headerStyle }, "步骤"), react.default.createElement("th", { style: props.headerStyle }, "工具调用"), react.default.createElement("th", { style: props.headerStyle }, "输入 tokens"), react.default.createElement("th", { style: props.headerStyle }, "输入价格"), react.default.createElement("th", { style: props.headerStyle }, "缓存 tokens"), react.default.createElement("th", { style: props.headerStyle }, "缓存价格"), react.default.createElement("th", { style: props.headerStyle }, "输出 tokens"), react.default.createElement("th", { style: props.headerStyle }, "输出价格"), react.default.createElement("th", { style: props.headerStyle }, "缓存率"), react.default.createElement("th", { style: props.headerStyle }, "总价"), react.default.createElement("th", { style: props.headerStyle }, "上下文翻倍"), react.default.createElement("th", { style: props.headerStyle }, "时段名称"), react.default.createElement("th", { style: props.headerStyle }, "模型"))), react.default.createElement("tbody", null, ...hours.flatMap((hour) => {
				const rootRows = props.hourly.filter((row) => row.hour === hour);
				const hourChildren = childRows.filter((row) => row.entry.hour === hour);
				const hourRows = [...rootRows, ...hourChildren.map((row) => row.entry)];
				const total = sumRows(hourRows);
				if (total === null) return [];
				const timeKey = `${props.sessionId}:time:${hour}`;
				const timeExpanded = props.expandedHours.has(timeKey);
				const routes = [...new Set(hourRows.map(routeOf))];
				const timeRow = react.default.createElement("tr", {
					key: timeKey,
					style: {
						borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)",
						fontWeight: 600
					}
				}, react.default.createElement("td", { style: props.cellLeft }, react.default.createElement("button", {
					type: "button",
					"aria-expanded": timeExpanded,
					onClick: () => props.toggleHour(timeKey),
					style: {
						border: 0,
						background: "transparent",
						cursor: "pointer",
						padding: "0 6px 0 0",
						fontSize: 13,
						color: "inherit"
					}
				}, timeExpanded ? "−" : "+"), total.hourLabel), ...dataCells(total), react.default.createElement("td", { style: props.cellBase }, surchargeLabel(hourRows.length === 1 ? hourRows[0]?.contextAfterTokens : null, hourRows.length === 1 ? hourRows[0]?.contextMultiplier : void 0)), react.default.createElement("td", { style: props.cellBase }, "-"), react.default.createElement("td", { style: props.cellBase }, `${routes.length} 个模型`));
				if (!timeExpanded) return [timeRow];
				return [timeRow, ...routes.flatMap((route) => {
					const entries = hourRows.filter((row) => routeOf(row) === route);
					const modelTotal = sumRows(entries);
					if (modelTotal === null) return [];
					const modelKey = `${props.sessionId}:model:${hour}:${route}`;
					const modelExpanded = props.expandedHours.has(modelKey);
					const children = hourChildren.filter((row) => routeOf(row.entry) === route);
					const modelRow = react.default.createElement("tr", {
						key: modelKey,
						style: {
							borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)",
							background: "var(--dsw-alias-bg-layer-2, #fafafa)"
						}
					}, react.default.createElement("td", { style: {
						...props.cellLeft,
						paddingLeft: 28
					} }, children.length > 0 ? react.default.createElement("button", {
						type: "button",
						"aria-expanded": modelExpanded,
						onClick: () => props.toggleHour(modelKey),
						style: {
							border: 0,
							background: "transparent",
							cursor: "pointer",
							padding: "0 6px 0 0",
							fontSize: 13,
							color: "inherit"
						}
					}, modelExpanded ? "−" : "+") : react.default.createElement("span", { style: {
						display: "inline-block",
						width: 19
					} }), `↳ ${route}`), ...dataCells(modelTotal), react.default.createElement("td", { style: props.cellBase }, surchargeLabel(entries.length === 1 ? entries[0]?.contextAfterTokens : null, entries.length === 1 ? entries[0]?.contextMultiplier : void 0)), react.default.createElement("td", { style: props.cellBase }, "-"), react.default.createElement("td", { style: props.cellBase }, route));
					if (!modelExpanded) return [modelRow];
					return [modelRow, ...children.map(({ sessionId, entry }) => react.default.createElement("tr", {
						key: `${props.sessionId}:child:${hour}:${route}:${sessionId}`,
						style: {
							borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)",
							color: "var(--dsw-alias-label-secondary)"
						}
					}, react.default.createElement("td", { style: {
						...props.cellLeft,
						paddingLeft: 52
					} }, `↳ 子代理 ${sessionId.slice(0, 8)}`), ...dataCells(entry), react.default.createElement("td", { style: props.cellBase }, surchargeLabel(entry.contextAfterTokens, entry.contextMultiplier)), react.default.createElement("td", { style: props.cellBase }, entry.periodName ?? "-"), react.default.createElement("td", { style: props.cellBase }, `${entry.provider ?? "?"}/${entry.model ?? "?"}`)))];
				})];
			}), totals ? react.default.createElement("tr", { style: {
				fontWeight: 600,
				borderTop: "2px solid var(--dsw-alias-border-l1, #bbb)"
			} }, react.default.createElement("td", { style: {
				...props.cellLeft,
				fontWeight: 600
			} }, "合计"), ...dataCells(totals), react.default.createElement("td", { style: props.cellBase }), react.default.createElement("td", { style: props.cellBase }), react.default.createElement("td", { style: props.cellBase })) : react.default.createElement("tr", null, react.default.createElement("td", {
				style: {
					...props.cellLeft,
					color: "var(--dsw-alias-label-tertiary)"
				},
				colSpan: 15
			}, "该会话暂无按时段明细"))));
		}
		function CostDock(props) {
			const [state, setState] = react.default.useState(null);
			const [tooltip, setTooltip] = react.default.useState(false);
			const [showModal, setShowModal] = react.default.useState(false);
			const [sessionRows, setSessionRows] = react.default.useState([]);
			const [sessionLoadError, setSessionLoadError] = react.default.useState(null);
			const [sessionLoading, setSessionLoading] = react.default.useState(false);
			const [expandedHours, setExpandedHours] = react.default.useState(() => /* @__PURE__ */ new Set());
			const [showAllSessions, setShowAllSessions] = react.default.useState(false);
			const [hourlyFilter, setHourlyFilter] = react.default.useState(EMPTY_HOURLY_FILTER);
			const tooltipTimerRef = react.default.useRef(null);
			react.default.useEffect(() => {
				const load = () => {
					if (typeof props.sessionId !== "string") return;
					props.costMeter.sessionCost(props.sessionId).then((response) => {
						if (response.ok && response.value && typeof response.value === "object") setState(response.value);
					}).catch(() => {});
				};
				load();
				return props.interval(load, 2e3);
			}, [props.sessionId]);
			react.default.useEffect(() => () => {
				if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
			}, []);
			const loadSessionCosts = (reuse) => {
				if (!reuse) {
					setSessionLoading(true);
					setSessionLoadError(null);
				}
				loadAllSessionCosts(props.costMeter, props.sessions).then((rows) => {
					setSessionRows(rows);
					setSessionLoadError(null);
				}).catch((error) => {
					if (!reuse || sessionRows.length === 0) setSessionLoadError(`会话费用加载失败：${remoteErrorText(error)}`);
				}).finally(() => {
					setSessionLoading(false);
				});
			};
			const openModal = () => {
				setShowModal(true);
				setShowAllSessions(false);
				setSessionLoadError(null);
				setTooltip(false);
			};
			const openAllSessions = () => {
				setShowAllSessions(true);
				loadSessionCosts(sessionRows.length > 0);
			};
			if (!state || !(state.cost > 0)) return null;
			const symbol = currencySymbol(state.currency);
			const parts = [
				`API费用 ≈${symbol}${money(state.cost)}`,
				`输入 ${symbol}${money(state.inputCost)}`,
				`缓存读 ${symbol}${money(state.cacheReadCost)}`,
				`缓存写 ${symbol}${money(state.cacheWriteCost)}`,
				`输出 ${symbol}${money(state.outputCost)}`
			];
			const showTooltip = () => {
				if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
				tooltipTimerRef.current = setTimeout(() => setTooltip(true), 300);
			};
			const hideTooltip = () => {
				if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
				tooltipTimerRef.current = setTimeout(() => setTooltip(false), 200);
			};
			const route = state.route ?? "未知模型";
			const pricingInfo = state.pricingPeriod ? `${state.pricingPeriod} · ${state.pricingSource === "model-period" ? "模型时段价" : state.pricingSource === "model" ? "模型基准价" : state.pricingSource === "default-period" ? "默认时段价" : "默认价格"}` : "默认价格";
			const cellBase = {
				fontSize: 12,
				padding: "4px 8px",
				textAlign: "right",
				whiteSpace: "nowrap"
			};
			const cellLeft = {
				...cellBase,
				textAlign: "left"
			};
			const headerStyle = {
				...cellBase,
				fontWeight: 600,
				background: "var(--dsw-alias-bg-layer-3, #f5f5f5)",
				borderBottom: "1px solid var(--dsw-alias-border-l2, #ddd)",
				position: "sticky",
				top: 0,
				zIndex: 1
			};
			const headerLeft = {
				...headerStyle,
				textAlign: "left"
			};
			const toggleExpanded = (store, id) => store((previous) => {
				const next = new Set(previous);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
			const toggleHour = (id) => toggleExpanded(setExpandedHours, id);
			const compactId = (value) => value ? value.length > 12 ? `${value.slice(0, 8)}…` : value : "-";
			const hourGroups = queryHourlyOverview(sessionRows, hourlyFilter);
			const dateOptions = [...new Set(sessionRows.flatMap((row) => (row.cost.hourly ?? []).map((entry) => entry.hour ? localDateOfHour(entry.hour) : "")).filter(Boolean))].sort();
			const hourOptions = [...new Set((hourlyFilter.date === "" ? sessionRows.flatMap((row) => row.cost.hourly ?? []) : sessionRows.flatMap((row) => row.cost.hourly ?? []).filter((entry) => entry.hour !== void 0 && localDateOfHour(entry.hour) === hourlyFilter.date)).map((entry) => entry.hourLabel ?? entry.hour).filter((value) => Boolean(value)))].sort();
			const originOptions = [...new Set(sessionRows.map((row) => row.origin).filter((value) => Boolean(value)))].sort();
			const routeOptions = [...new Set(sessionRows.flatMap((row) => sessionRoutes(row)))].sort();
			const overviewTotals = sumHourlySlices(hourGroups.flatMap((group) => group.sessions.map((item) => item.entry)));
			const hourlyDataCells = (row) => [
				react.default.createElement("td", { style: cellBase }, String(row.turns)),
				react.default.createElement("td", { style: cellBase }, String(row.steps)),
				react.default.createElement("td", { style: cellBase }, String(row.toolCalls)),
				react.default.createElement("td", { style: cellBase }, row.inputTokens.toLocaleString("zh-CN")),
				react.default.createElement("td", { style: cellBase }, `${symbol}${money(row.inputCost)}`),
				react.default.createElement("td", { style: cellBase }, (row.cacheReadTokens + row.cacheWriteTokens).toLocaleString("zh-CN")),
				react.default.createElement("td", { style: cellBase }, `${symbol}${money(row.cacheReadCost + row.cacheWriteCost)}`),
				react.default.createElement("td", { style: cellBase }, row.outputTokens.toLocaleString("zh-CN")),
				react.default.createElement("td", { style: cellBase }, `${symbol}${money(row.outputCost)}`),
				react.default.createElement("td", { style: cellBase }, `${(row.cacheRate * 100).toFixed(1)}%`),
				react.default.createElement("td", { style: {
					...cellBase,
					fontWeight: 600
				} }, `${symbol}${money(row.cost)}`)
			];
			const filterInput = (value, placeholder, onChange) => react.default.createElement("input", {
				style: {
					...inputStyle,
					height: 28,
					fontSize: 11
				},
				value,
				placeholder,
				onChange: (event) => onChange(event.target.value)
			});
			const filterSelect = (value, options, onChange) => react.default.createElement("select", {
				style: {
					...inputStyle,
					height: 28,
					fontSize: 11
				},
				value,
				onChange: (event) => onChange(event.target.value)
			}, react.default.createElement("option", { value: "" }, "全部"), ...options.map((option) => react.default.createElement("option", {
				key: option,
				value: option
			}, option)));
			return react.default.createElement(react.default.Fragment, null, react.default.createElement("div", {
				style: {
					position: "relative",
					overflow: "visible",
					padding: "2px calc(var(--dsh-composer-side-clearance) + 16px) 0",
					cursor: "pointer"
				},
				onMouseEnter: showTooltip,
				onMouseLeave: hideTooltip,
				onClick: openModal
			}, react.default.createElement("div", { style: {
				textAlign: "center",
				boxSizing: "border-box",
				color: "var(--dsw-alias-label-tertiary)",
				whiteSpace: "nowrap",
				textOverflow: "ellipsis",
				overflow: "hidden",
				fontSize: 12,
				lineHeight: "20px"
			} }, ...parts.map((part, index) => react.default.createElement(react.default.Fragment, { key: part }, index ? react.default.createElement("span", { style: {
				margin: "0 10px",
				color: "var(--dsw-alias-separator-primary)"
			} }, "|") : null, part))), tooltip ? react.default.createElement("div", { style: {
				position: "absolute",
				bottom: "calc(100% + 8px)",
				left: "50%",
				transform: "translateX(-50%)",
				background: "var(--dsw-alias-bg-layer-2, #1a1a2e)",
				border: "1px solid var(--dsw-alias-border-l2, #333)",
				borderRadius: 8,
				padding: "10px 14px",
				fontSize: 12,
				lineHeight: "1.6",
				zIndex: 1e3,
				display: "flex",
				flexDirection: "column",
				gap: 4,
				pointerEvents: "none"
			} }, react.default.createElement("div", { style: {
				fontWeight: 600,
				fontSize: 13,
				marginBottom: 4
			} }, "API 费用明细"), ...state.details && state.details.length > 0 ? state.details.flatMap((detail, di) => {
				const rateSymbol = (rate) => `${symbol}${rate}`;
				const sourceLabel = detail.source === "model-period" ? "模型时段价" : detail.source === "model" ? "模型基准价" : detail.source === "default-period" ? "默认时段价" : "默认价格";
				const ds = detail;
				return [
					di > 0 ? react.default.createElement("div", {
						key: `sep-${di}`,
						style: {
							borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
							margin: "2px 0"
						}
					}) : null,
					react.default.createElement("div", {
						key: `hdr-${di}`,
						style: {
							fontWeight: 600,
							fontSize: 12,
							marginTop: di > 0 ? 2 : 0
						}
					}, `${ds.provider ?? "?"}/${ds.model ?? "?"} · ${sourceLabel}${ds.periodName ? ` · ${ds.periodName}` : ""}${formatContextSurcharge(ds.contextAfterTokens, ds.contextMultiplier) ? ` · ${formatContextSurcharge(ds.contextAfterTokens, ds.contextMultiplier)}` : ""}`),
					react.default.createElement("div", {
						key: `rates-${di}`,
						style: {
							display: "grid",
							gridTemplateColumns: "auto auto auto auto",
							gap: "0 14px",
							fontSize: 11,
							color: "var(--dsw-alias-label-tertiary)"
						}
					}, react.default.createElement("span", {}, `输入 ${rateSymbol(ds.rates.input)}/M`), react.default.createElement("span", {}, `缓存读 ${rateSymbol(ds.rates.cacheRead)}/M`), react.default.createElement("span", {}, `缓存写 ${rateSymbol(ds.rates.cacheWrite)}/M`), react.default.createElement("span", {}, `输出 ${rateSymbol(ds.rates.output)}/M`)),
					react.default.createElement("div", {
						key: `grid-${di}`,
						style: {
							display: "grid",
							gridTemplateColumns: "auto 1fr auto",
							gap: "1px 16px"
						}
					}, react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, "输入"), react.default.createElement("span", { style: {
						textAlign: "right",
						fontWeight: 500
					} }, `${symbol}${money(ds.inputCost)}`), react.default.createElement("span", { style: {
						color: "var(--dsw-alias-label-tertiary)",
						fontSize: 11
					} }, `${ds.inputTokens.toLocaleString("zh-CN")} tokens`), react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, "缓存读"), react.default.createElement("span", { style: {
						textAlign: "right",
						fontWeight: 500
					} }, `${symbol}${money(ds.cacheReadCost)}`), react.default.createElement("span", { style: {
						color: "var(--dsw-alias-label-tertiary)",
						fontSize: 11
					} }, `${ds.cacheReadTokens.toLocaleString("zh-CN")} tokens`), react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, "缓存写"), react.default.createElement("span", { style: {
						textAlign: "right",
						fontWeight: 500
					} }, `${symbol}${money(ds.cacheWriteCost)}`), react.default.createElement("span", { style: {
						color: "var(--dsw-alias-label-tertiary)",
						fontSize: 11
					} }, `${ds.cacheWriteTokens.toLocaleString("zh-CN")} tokens`), react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, "输出"), react.default.createElement("span", { style: {
						textAlign: "right",
						fontWeight: 500
					} }, `${symbol}${money(ds.outputCost)}`), react.default.createElement("span", { style: {
						color: "var(--dsw-alias-label-tertiary)",
						fontSize: 11
					} }, `${ds.outputTokens.toLocaleString("zh-CN")} tokens`), react.default.createElement("span", { style: { fontWeight: 600 } }, "小计"), react.default.createElement("span", { style: {
						textAlign: "right",
						fontWeight: 600
					} }, `${symbol}${money(ds.cost)}`), react.default.createElement("span", {}))
				];
			}) : [react.default.createElement("div", {
				key: "ctx",
				style: {
					fontWeight: 500,
					fontSize: 12,
					marginBottom: 2
				}
			}, `${route} · ${pricingInfo}`), react.default.createElement("div", {
				key: "flat",
				style: {
					display: "grid",
					gridTemplateColumns: "auto 1fr auto",
					gap: "1px 16px"
				}
			}, react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, "输入"), react.default.createElement("span", { style: {
				textAlign: "right",
				fontWeight: 500
			} }, `${symbol}${money(state.inputCost)}`), react.default.createElement("span", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 11
			} }, `${state.inputTokens.toLocaleString("zh-CN")} tokens`), react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, "缓存读"), react.default.createElement("span", { style: {
				textAlign: "right",
				fontWeight: 500
			} }, `${symbol}${money(state.cacheReadCost)}`), react.default.createElement("span", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 11
			} }, `${state.cacheReadTokens.toLocaleString("zh-CN")} tokens`), react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, "缓存写"), react.default.createElement("span", { style: {
				textAlign: "right",
				fontWeight: 500
			} }, `${symbol}${money(state.cacheWriteCost)}`), react.default.createElement("span", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 11
			} }, `${state.cacheWriteTokens.toLocaleString("zh-CN")} tokens`), react.default.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, "输出"), react.default.createElement("span", { style: {
				textAlign: "right",
				fontWeight: 500
			} }, `${symbol}${money(state.outputCost)}`), react.default.createElement("span", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 11
			} }, `${state.outputTokens.toLocaleString("zh-CN")} tokens`))], react.default.createElement("div", {
				key: "total",
				style: {
					borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
					paddingTop: 4,
					marginTop: 4,
					display: "grid",
					gridTemplateColumns: "auto 1fr",
					gap: "1px 16px"
				}
			}, react.default.createElement("span", { style: { fontWeight: 600 } }, "合计"), react.default.createElement("span", { style: {
				textAlign: "right",
				fontWeight: 600
			} }, `${symbol}${money(state.cost)}`))) : null), showModal && state ? react.default.createElement("div", {
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
				onClick: () => setShowModal(false)
			}, react.default.createElement("div", {
				style: {
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					borderRadius: 12,
					padding: 24,
					maxWidth: "94vw",
					maxHeight: "86vh",
					overflow: "auto",
					boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
					display: "flex",
					flexDirection: "column",
					gap: 16
				},
				onClick: (e) => e.stopPropagation()
			}, react.default.createElement("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: 12
			} }, react.default.createElement("h2", { style: {
				margin: 0,
				fontSize: 18,
				fontWeight: 600
			} }, "API 费用统计明细"), react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8
			} }, showAllSessions ? react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				onClick: () => setShowAllSessions(false)
			}, "返回本会话") : react.default.createElement("button", {
				type: "button",
				style: buttonStyle,
				onClick: openAllSessions
			}, "查看全部会话"), react.default.createElement("button", {
				style: {
					background: "none",
					border: "none",
					color: "inherit",
					fontSize: 20,
					cursor: "pointer",
					padding: "4px 8px",
					borderRadius: 4
				},
				onClick: () => setShowModal(false)
			}, "✕"))), showAllSessions ? react.default.createElement("section", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("h3", { style: {
				margin: 0,
				fontSize: 13,
				fontWeight: 600
			} }, "全部会话按时段"), react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "repeat(5, minmax(110px, 1fr))",
				gap: 8
			} }, react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 4,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "日期", filterSelect(hourlyFilter.date, dateOptions, (value) => setHourlyFilter((current) => ({
				...current,
				date: value,
				hour: ""
			})))), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 4,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "时段", filterSelect(hourlyFilter.hour, hourOptions, (value) => setHourlyFilter((current) => ({
				...current,
				hour: value
			})))), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 4,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "会话 ID", filterInput(hourlyFilter.sessionId, "包含…", (value) => setHourlyFilter((current) => ({
				...current,
				sessionId: value
			})))), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 4,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "来源", filterSelect(hourlyFilter.origin, originOptions, (value) => setHourlyFilter((current) => ({
				...current,
				origin: value
			})))), react.default.createElement("label", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 4,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "模型/路由", filterSelect(hourlyFilter.route, routeOptions, (value) => setHourlyFilter((current) => ({
				...current,
				route: value
			}))))), sessionLoading ? react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "正在加载会话费用…") : null, sessionLoadError ? react.default.createElement("p", {
				role: "alert",
				style: {
					margin: 0,
					fontSize: 12,
					color: "var(--dsw-alias-label-error)"
				}
			}, sessionLoadError) : null, !sessionLoading && !sessionLoadError && hourGroups.length === 0 ? react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "暂无匹配的时段费用") : null, react.default.createElement("div", { style: {
				overflowX: "auto",
				fontSize: 12
			} }, react.default.createElement("table", { style: {
				width: "100%",
				borderCollapse: "collapse",
				whiteSpace: "nowrap"
			} }, react.default.createElement("thead", null, react.default.createElement("tr", null, react.default.createElement("th", { style: headerLeft }, "时间段"), react.default.createElement("th", { style: headerStyle }, "轮次"), react.default.createElement("th", { style: headerStyle }, "步骤"), react.default.createElement("th", { style: headerStyle }, "工具调用"), react.default.createElement("th", { style: headerStyle }, "输入 tokens"), react.default.createElement("th", { style: headerStyle }, "输入价格"), react.default.createElement("th", { style: headerStyle }, "缓存 tokens"), react.default.createElement("th", { style: headerStyle }, "缓存价格"), react.default.createElement("th", { style: headerStyle }, "输出 tokens"), react.default.createElement("th", { style: headerStyle }, "输出价格"), react.default.createElement("th", { style: headerStyle }, "缓存率"), react.default.createElement("th", { style: headerStyle }, "总价"), react.default.createElement("th", { style: headerStyle }, "上下文翻倍"), react.default.createElement("th", { style: headerStyle }, "时段名称"), react.default.createElement("th", { style: headerStyle }, "模型"))), react.default.createElement("tbody", null, ...hourGroups.flatMap((group) => {
				const timeKey = `all:time:${group.hour}`;
				const expanded = expandedHours.has(timeKey);
				const routes = [...new Set(group.sessions.map((item) => `${item.entry.provider ?? ""}/${item.entry.model ?? ""}`).filter((value) => value !== "/"))];
				const timeRow = react.default.createElement("tr", {
					key: timeKey,
					style: {
						borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)",
						fontWeight: 600
					}
				}, react.default.createElement("td", { style: cellLeft }, react.default.createElement("button", {
					type: "button",
					"aria-expanded": expanded,
					onClick: () => toggleHour(timeKey),
					style: {
						border: 0,
						background: "transparent",
						cursor: "pointer",
						padding: "0 6px 0 0",
						fontSize: 13,
						color: "inherit"
					}
				}, expanded ? "−" : "+"), `${localDateOfHour(group.hour)} ${group.hourLabel}`), ...hourlyDataCells(group.totals), react.default.createElement("td", { style: cellBase }, surchargeLabel(group.sessions.length === 1 ? group.sessions[0]?.entry.contextAfterTokens : null, group.sessions.length === 1 ? group.sessions[0]?.entry.contextMultiplier : void 0)), react.default.createElement("td", { style: cellBase }, `${group.sessions.length} 个会话`), react.default.createElement("td", { style: cellBase }, routes.length === 0 ? "-" : `${routes.length} 个模型`));
				if (!expanded) return [timeRow];
				return [timeRow, ...group.sessions.map((item) => react.default.createElement("tr", {
					key: `${timeKey}:${item.sessionId}:${item.entry.provider ?? ""}/${item.entry.model ?? ""}`,
					style: {
						borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)",
						background: "var(--dsw-alias-bg-layer-2, #fafafa)"
					}
				}, react.default.createElement("td", {
					style: {
						...cellLeft,
						paddingLeft: 28
					},
					title: item.sessionId
				}, `↳ ${compactId(item.sessionId)}${item.origin ? ` · ${item.origin}` : ""}`), ...hourlyDataCells(item.entry), react.default.createElement("td", { style: cellBase }, surchargeLabel(item.entry.contextAfterTokens, item.entry.contextMultiplier)), react.default.createElement("td", { style: cellBase }, item.entry.periodName ?? "-"), react.default.createElement("td", { style: cellBase }, item.entry.provider && item.entry.model ? `${item.entry.provider}/${item.entry.model}` : "-")))];
			}), hourGroups.length > 0 ? react.default.createElement("tr", { style: {
				fontWeight: 600,
				borderTop: "2px solid var(--dsw-alias-border-l1, #bbb)"
			} }, react.default.createElement("td", { style: {
				...cellLeft,
				fontWeight: 600
			} }, "合计"), ...hourlyDataCells(overviewTotals), react.default.createElement("td", { style: cellBase }), react.default.createElement("td", { style: cellBase }, `${hourGroups.reduce((total, group) => total + group.sessions.length, 0)} 条明细`), react.default.createElement("td", { style: cellBase }, `${(overviewTotals.inputTokens + overviewTotals.cacheReadTokens + overviewTotals.cacheWriteTokens + overviewTotals.outputTokens).toLocaleString("zh-CN")} tokens`)) : null)))) : react.default.createElement("section", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("h3", { style: {
				margin: 0,
				fontSize: 13,
				fontWeight: 600
			} }, "当前会话"), react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
			} }, (() => {
				const labels = [...new Set([...state.details ?? [], ...state.hourly ?? []].map((row) => formatContextSurcharge(row.contextAfterTokens, row.contextMultiplier)).filter((value) => Boolean(value)))];
				return labels.length === 0 ? "本会话没有触发上下文翻倍。" : `本会话命中：${labels.join("、")}`;
			})()), react.default.createElement("div", { style: {
				overflowX: "auto",
				fontSize: 12
			} }, react.default.createElement(HourlyTable, {
				sessionId: props.sessionId,
				hourly: state.hourly ?? [],
				subagents: state.subagents ?? [],
				expandedHours,
				toggleHour,
				symbol,
				cellBase,
				cellLeft,
				headerStyle,
				headerLeft
			}))))) : null);
		}
		async function apply(ctx) {
			const remote = ctx.get("remote");
			if (!remote) return;
			await remote.$mount({
				package: "dsh-cost-meter",
				descriptors: [{
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
				}, {
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
				}]
			});
			const slots = ctx.get("slots");
			const costMeter = ctx.get("remote.costMeter");
			const connection = ctx.get("connection");
			if (!slots || !costMeter || !connection) return;
			const pricing = new PricingRouteSource();
			pricing.load();
			const catalog = new CatalogSource(connection.api);
			catalog.load();
			const remoteEvents = ctx.get("remote");
			ctx.effect(() => remoteEvents.$on?.("llm/adapters-updated", () => {
				catalog.load();
			}) ?? (() => {}), "cost-meter catalog updates");
			slots.inject("conversation.composer.dock", () => slots.register({
				name: "conversation.composer.dock",
				id: "cost-meter",
				order: 100
			}, (props) => react.default.createElement(CostDock, {
				...props,
				costMeter,
				sessions: connection.api.sessions,
				interval: (callback, delay) => ctx.interval(callback, delay)
			})));
			slots.inject("settings.plugin.item", () => slots.register({
				name: "settings.plugin.item",
				key: "cost-meter",
				id: "cost-meter",
				order: 30,
				inject: () => ({
					hooks: {
						pricing,
						catalog
					},
					refreshCatalog: catalog.load,
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