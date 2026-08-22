window.__ModuleLoader__.load({
	id: "dsh-memory",
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
		//#region src/client.ts
		const inject = ["slots", "connection"];
		const MEMORY_ROUTE = "/memory/api";
		const formatBytes = (bytes) => {
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1048576).toFixed(1)} MB`;
		};
		const fetchStatus = async () => {
			try {
				const body = await (await fetch(`${MEMORY_ROUTE}/status`)).json();
				return body.ok && body.value ? body.value : null;
			} catch {
				return null;
			}
		};
		const fetchEntries = async (target) => {
			try {
				return await (await fetch(`${MEMORY_ROUTE}/entries?target=${target}`)).json();
			} catch {
				return null;
			}
		};
		const resetMemory = async (target) => {
			try {
				return await (await fetch(`${MEMORY_ROUTE}/reset`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ target })
				})).json();
			} catch {
				return null;
			}
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
		const dangerButtonStyle = {
			...buttonStyle,
			color: "var(--dsw-alias-label-error)",
			borderColor: "var(--dsw-alias-label-error)"
		};
		function parseMemoryArgs(argsRaw) {
			try {
				const parsed = JSON.parse(argsRaw);
				if (typeof parsed !== "object" || parsed === null) return null;
				return parsed;
			} catch {
				return null;
			}
		}
		function summarizeMemoryCall(argsRaw, result) {
			const args = parseMemoryArgs(argsRaw);
			if (!args) return "Memory";
			const isBatch = Array.isArray(args.operations) && args.operations.length > 0;
			const target = args.target === "user" ? "USER" : "MEMORY";
			const ops = args.operations ?? [];
			if (result?.success === true) {
				const count = result.entry_count ?? 0;
				const usage = result.usage ?? "";
				if (isBatch) return `${target} · ${ops.length} 操作 · ${usage} · ${count} 条`;
				if (args.action === "add") return `${target} · 添加 · ${usage} · ${count} 条`;
				if (args.action === "replace") return `${target} · 替换 · ${usage} · ${count} 条`;
				if (args.action === "remove") return `${target} · 删除 · ${usage} · ${count} 条`;
				return `${target} · ${usage} · ${count} 条`;
			}
			if (result?.error) return `${target} · 失败: ${result.error.slice(0, 40)}`;
			if (isBatch) return `${target} · ${ops.length} 操作`;
			if (args.action === "add") return `${target} · 添加`;
			if (args.action === "replace") return `${target} · 替换`;
			if (args.action === "remove") return `${target} · 删除`;
			return `${target}`;
		}
		function MemoryRow(props) {
			const argsRaw = ("kind" in props.block ? props.block.call?.argsRaw : props.block.argsRaw) ?? "";
			const result = "kind" in props.block && props.block.kind === "settled" ? props.block.result : null;
			const summary = summarizeMemoryCall(argsRaw, result);
			const [expanded, setExpanded] = react.default.useState(false);
			const state = result?.success === true ? "ok" : result?.success === false ? "error" : "running";
			const expandable = argsRaw !== "" || result !== null;
			const formatArgs = () => {
				const args = parseMemoryArgs(argsRaw);
				if (!args) return argsRaw;
				return JSON.stringify(args, null, 2);
			};
			const formatResult = () => {
				if (!result) return "";
				return JSON.stringify(result, null, 2);
			};
			const toggleExpand = () => {
				if (expandable) setExpanded((v) => !v);
			};
			const rowCardStyle = {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "6px 0",
				fontSize: 13,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-primary)",
				cursor: expandable ? "pointer" : void 0,
				userSelect: "none"
			};
			return react.default.createElement("div", { style: {
				borderBottom: "1px solid var(--dsw-alias-border-l2)",
				marginBottom: 4
			} }, react.default.createElement("div", {
				style: rowCardStyle,
				role: expandable ? "button" : void 0,
				tabIndex: expandable ? 0 : void 0,
				"aria-expanded": expandable ? expanded : void 0,
				onClick: toggleExpand,
				onKeyDown: (e) => {
					if (expandable && (e.key === "Enter" || e.key === " ")) {
						e.preventDefault();
						toggleExpand();
					}
				}
			}, react.default.createElement("span", { style: {
				width: 8,
				height: 8,
				borderRadius: "50%",
				flexShrink: 0,
				background: state === "ok" ? "var(--dsw-alias-color-success, #22c55e)" : state === "error" ? "var(--dsw-alias-color-error, #ef4444)" : "var(--dsw-alias-label-tertiary)"
			} }), react.default.createElement("span", { style: {
				fontSize: 10,
				color: "var(--dsw-alias-label-tertiary)",
				transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
				transition: "transform 0.15s",
				flexShrink: 0
			} }, expandable ? expanded ? "▾" : "▸" : ""), react.default.createElement("span", { style: {
				fontSize: 12,
				flexShrink: 0,
				marginRight: 2
			} }, "📝"), react.default.createElement("span", { style: {
				fontWeight: 500,
				flexShrink: 0
			} }, "记忆"), react.default.createElement("span", { style: {
				flex: 1,
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 12
			} }, summary), props.inspect && result?.error ? react.default.createElement("button", {
				style: {
					...buttonStyle,
					padding: "2px 6px",
					fontSize: 11
				},
				onClick: (e) => {
					e.stopPropagation();
					props.inspect?.();
				}
			}, "查看详情") : null), expanded ? react.default.createElement("div", { style: {
				margin: "0 0 8px 16px",
				padding: 8,
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				background: "var(--dsw-alias-bg-layer-2)",
				fontSize: 12,
				lineHeight: "1.5"
			} }, argsRaw ? react.default.createElement("div", { style: { marginBottom: 8 } }, react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginBottom: 4,
				fontWeight: 600
			} }, "IN"), react.default.createElement("pre", { style: {
				margin: 0,
				padding: "6px 8px",
				background: "var(--dsw-alias-bg-layer-3)",
				borderRadius: 4,
				overflow: "auto",
				fontSize: 11,
				color: "var(--dsw-alias-label-primary)",
				maxHeight: 200
			} }, formatArgs())) : null, result ? react.default.createElement("div", null, react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginBottom: 4,
				fontWeight: 600
			} }, "OUT"), react.default.createElement("pre", { style: {
				margin: 0,
				padding: "6px 8px",
				background: "var(--dsw-alias-bg-layer-3)",
				borderRadius: 4,
				overflow: "auto",
				fontSize: 11,
				color: result?.success === false ? "var(--dsw-alias-label-error)" : "var(--dsw-alias-label-primary)",
				maxHeight: 200
			} }, formatResult())) : null) : null);
		}
		function MemorySettingsCard(_props) {
			const [status, setStatus] = react.default.useState(null);
			const [entries, setEntries] = react.default.useState({
				memory: [],
				user: []
			});
			const [open, setOpen] = react.default.useState(false);
			const [tab, setTab] = react.default.useState("memory");
			const [resetting, setResetting] = react.default.useState(null);
			const [toast, setToast] = react.default.useState(null);
			const [loading, setLoading] = react.default.useState(true);
			const loadAll = react.default.useCallback(async () => {
				setLoading(true);
				const [s, memEntries, userEntries] = await Promise.all([
					fetchStatus(),
					fetchEntries("memory"),
					fetchEntries("user")
				]);
				if (s) setStatus(s);
				const memVal = memEntries?.ok === true && memEntries.value?.entries ? memEntries.value.entries : [];
				const userVal = userEntries?.ok === true && userEntries.value?.entries ? userEntries.value.entries : [];
				setEntries({
					memory: memVal,
					user: userVal
				});
				setLoading(false);
			}, []);
			react.default.useEffect(() => {
				loadAll();
			}, [loadAll]);
			react.default.useEffect(() => {
				if (toast) {
					const timer = setTimeout(() => setToast(null), 2e3);
					return () => clearTimeout(timer);
				}
			}, [toast]);
			const handleReset = async (target) => {
				setResetting(target);
				const result = await resetMemory(target);
				setResetting(null);
				if (result?.ok) {
					setToast(`已重置 ${target === "all" ? "全部" : target === "user" ? "USER.md" : "MEMORY.md"}`);
					await loadAll();
				} else setToast("重置失败");
			};
			const currentEntries = entries[tab];
			const cellStyle = {
				padding: "8px 12px",
				fontSize: 12,
				borderBottom: "1px solid var(--dsw-alias-border-l2)",
				color: "var(--dsw-alias-label-primary)",
				lineHeight: "1.5",
				wordBreak: "break-word"
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
			} }, "持久记忆"), react.default.createElement("span", { style: {
				fontSize: 13,
				color: "var(--dsw-alias-label-tertiary)"
			} }, status ? `MEMORY.md ${status.memory.usage} · USER.md ${status.user.usage}` : "加载中…")), react.default.createElement("span", {
				"aria-hidden": true,
				style: { transform: open ? "rotate(180deg)" : void 0 }
			}, "⌄")), open ? react.default.createElement("div", { style: {
				margin: "0 16px",
				padding: "14px 0 10px",
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				display: "flex",
				flexDirection: "column",
				gap: 16
			} }, toast ? react.default.createElement("div", { style: {
				padding: "6px 12px",
				borderRadius: 6,
				background: "var(--dsw-alias-color-success, #22c55e)",
				color: "#fff",
				fontSize: 12,
				textAlign: "center"
			} }, toast) : null, react.default.createElement("div", { style: {
				display: "grid",
				gridTemplateColumns: "1fr 1fr",
				gap: 12
			} }, react.default.createElement("div", { style: {
				padding: 10,
				borderRadius: 6,
				border: "1px solid var(--dsw-alias-border-l2)",
				display: "flex",
				flexDirection: "column",
				gap: 4
			} }, react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "MEMORY.md"), react.default.createElement("div", { style: {
				fontSize: 14,
				fontWeight: 600
			} }, status ? formatBytes(status.memory.size) : "-"), react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, status ? `${status.memory.entries} 条 · ${status.memory.usage}` : "")), react.default.createElement("div", { style: {
				padding: 10,
				borderRadius: 6,
				border: "1px solid var(--dsw-alias-border-l2)",
				display: "flex",
				flexDirection: "column",
				gap: 4
			} }, react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, "USER.md"), react.default.createElement("div", { style: {
				fontSize: 14,
				fontWeight: 600
			} }, status ? formatBytes(status.user.size) : "-"), react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, status ? `${status.user.entries} 条 · ${status.user.usage}` : ""))), react.default.createElement("div", { style: {
				display: "flex",
				gap: 0,
				borderBottom: "1px solid var(--dsw-alias-border-l2)"
			} }, react.default.createElement("button", {
				type: "button",
				onClick: () => setTab("memory"),
				style: {
					flex: 1,
					border: 0,
					background: "transparent",
					color: "inherit",
					cursor: "pointer",
					padding: "8px 0",
					fontSize: 13,
					borderBottom: tab === "memory" ? "2px solid var(--dsw-alias-label-primary)" : "2px solid transparent",
					fontWeight: tab === "memory" ? 600 : 400
				}
			}, "MEMORY.md"), react.default.createElement("button", {
				type: "button",
				onClick: () => setTab("user"),
				style: {
					flex: 1,
					border: 0,
					background: "transparent",
					color: "inherit",
					cursor: "pointer",
					padding: "8px 0",
					fontSize: 13,
					borderBottom: tab === "user" ? "2px solid var(--dsw-alias-label-primary)" : "2px solid transparent",
					fontWeight: tab === "user" ? 600 : 400
				}
			}, "USER.md")), loading ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)",
				padding: 8
			} }, "加载中…") : currentEntries.length === 0 ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)",
				padding: 8
			} }, "（空）") : react.default.createElement("div", { style: {
				maxHeight: 300,
				overflow: "auto",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6
			} }, currentEntries.map((entry, i) => react.default.createElement("div", {
				key: i,
				style: cellStyle
			}, react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginBottom: 2
			} }, `#${i + 1}`), entry))), react.default.createElement("div", { style: {
				display: "flex",
				gap: 8,
				justifyContent: "flex-end",
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				paddingTop: 12
			} }, react.default.createElement("button", {
				type: "button",
				style: dangerButtonStyle,
				disabled: resetting !== null,
				onClick: () => handleReset("memory")
			}, resetting === "memory" ? "重置中…" : "重置 MEMORY.md"), react.default.createElement("button", {
				type: "button",
				style: dangerButtonStyle,
				disabled: resetting !== null,
				onClick: () => handleReset("user")
			}, resetting === "user" ? "重置中…" : "重置 USER.md"), react.default.createElement("button", {
				type: "button",
				style: {
					...dangerButtonStyle,
					fontWeight: 600
				},
				disabled: resetting !== null,
				onClick: () => handleReset("all")
			}, resetting === "all" ? "重置中…" : "重置全部"))) : null);
		}
		function MemoryDock(_props) {
			const [status, setStatus] = react.default.useState(null);
			react.default.useEffect(() => {
				fetchStatus().then(setStatus);
				const interval = setInterval(() => {
					fetchStatus().then(setStatus);
				}, 1e4);
				return () => clearInterval(interval);
			}, []);
			if (!status) return null;
			return react.default.createElement("div", { style: {
				textAlign: "center",
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 12,
				lineHeight: "20px",
				padding: "2px 16px 0"
			} }, react.default.createElement("span", null, `📝 ${status.memory.entries + status.user.entries} 条记忆 · ${status.memory.usage}`));
		}
		async function apply(ctx) {
			const slots = ctx.get("slots");
			if (!slots) return;
			slots.inject("tool.call.toolview", () => slots.register({
				name: "tool.call.toolview",
				key: "memory"
			}, MemoryRow));
			slots.inject("settings.plugin.item", () => slots.register({
				name: "settings.plugin.item",
				key: "memory",
				id: "memory",
				order: 40
			}, MemorySettingsCard));
			slots.inject("conversation.composer.dock", () => slots.register({
				name: "conversation.composer.dock",
				id: "memory-indicator",
				order: 200
			}, (props) => react.default.createElement(MemoryDock, { ...props })));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map