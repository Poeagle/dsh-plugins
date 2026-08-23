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
		const formatTime = (iso) => {
			if (!iso) return "—";
			try {
				return new Date(iso).toLocaleString("zh-CN", { hour12: false });
			} catch {
				return iso;
			}
		};
		const reviewReasonLabel = (reason) => {
			switch (reason) {
				case "finished": return "正常完成";
				case "max-iterations": return "达到最大复核步数";
				case "aborted": return "已中止";
				case "failed": return "失败";
			}
		};
		const fetchReviewHistory = async (sessionId) => {
			try {
				const body = await (await fetch(`${MEMORY_ROUTE}/review-history?sessionId=${encodeURIComponent(sessionId)}`)).json();
				return body.ok ? body.value ?? [] : [];
			} catch {
				return [];
			}
		};
		const fetchReviewProgress = async (sessionId) => {
			try {
				const body = await (await fetch(`${MEMORY_ROUTE}/review-progress?sessionId=${encodeURIComponent(sessionId)}`)).json();
				return body.ok ? body.value ?? null : null;
			} catch {
				return null;
			}
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
		const fetchConfig = async () => {
			try {
				return await (await fetch(`${MEMORY_ROUTE}/config`)).json();
			} catch {
				return null;
			}
		};
		const saveConfig = async (patch) => {
			try {
				return (await (await fetch(`${MEMORY_ROUTE}/config`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(patch)
				})).json()).ok;
			} catch {
				return false;
			}
		};
		const deleteEntries = async (target, indices) => {
			try {
				return (await (await fetch(`${MEMORY_ROUTE}/delete-entries`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						target,
						indices
					})
				})).json()).ok;
			} catch {
				return false;
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
		const smallButtonStyle = {
			...buttonStyle,
			padding: "2px 6px",
			fontSize: 11
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
		function parseMemoryResultFromContent(content) {
			if (!Array.isArray(content)) return null;
			const textBlock = content.find((b) => b?.type === "text");
			if (!textBlock?.text) return null;
			try {
				return JSON.parse(textBlock.text);
			} catch {
				return null;
			}
		}
		function MemoryRow(props) {
			const isSettled = props.block.kind === "tool-result";
			const argsRaw = isSettled ? props.block.call?.argsRaw ?? "" : props.block.argsRaw ?? "";
			const result = isSettled ? parseMemoryResultFromContent(props.block.content) : null;
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
			const [open, setOpen] = react.default.useState(false);
			const [resetting, setResetting] = react.default.useState(null);
			const [toast, setToast] = react.default.useState(null);
			const [nudgeInterval, setNudgeInterval] = react.default.useState(10);
			const [reviewEnabled, setReviewEnabled] = react.default.useState(true);
			const [configLoading, setConfigLoading] = react.default.useState(false);
			const loadAll = react.default.useCallback(async () => {
				const [s, cfg] = await Promise.all([fetchStatus(), fetchConfig()]);
				if (s) setStatus(s);
				if (cfg?.ok && cfg.value) {
					setNudgeInterval(cfg.value.nudgeInterval);
					setReviewEnabled(cfg.value.reviewEnabled);
				}
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
			const handleSaveConfig = async () => {
				setConfigLoading(true);
				const ok = await saveConfig({
					nudgeInterval,
					reviewEnabled
				});
				setConfigLoading(false);
				setToast(ok ? "配置已保存" : "保存配置失败");
			};
			const sectionCardStyle = {
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				background: "var(--dsw-alias-bg-layer-2)",
				padding: 16
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
			} }, react.default.createElement("div", { style: sectionCardStyle }, react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginBottom: 4
			} }, "MEMORY.md"), react.default.createElement("div", { style: {
				fontSize: 18,
				fontWeight: 600
			} }, status ? formatBytes(status.memory.size) : "-"), react.default.createElement("div", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				marginTop: 4
			} }, status ? `${status.memory.entries} 条 · ${status.memory.usage}` : "")), react.default.createElement("div", { style: sectionCardStyle }, react.default.createElement("div", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginBottom: 4
			} }, "USER.md"), react.default.createElement("div", { style: {
				fontSize: 18,
				fontWeight: 600
			} }, status ? formatBytes(status.user.size) : "-"), react.default.createElement("div", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				marginTop: 4
			} }, status ? `${status.user.entries} 条 · ${status.user.usage}` : ""))), react.default.createElement("div", { style: sectionCardStyle }, react.default.createElement("div", { style: {
				fontSize: 14,
				fontWeight: 600,
				marginBottom: 12
			} }, "⚙️ 自动复盘设置"), react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 12
			} }, react.default.createElement("label", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 13,
				cursor: "pointer"
			} }, react.default.createElement("input", {
				type: "checkbox",
				checked: reviewEnabled,
				onChange: (e) => setReviewEnabled(e.target.checked),
				style: {
					width: 16,
					height: 16,
					cursor: "pointer"
				}
			}), "启用自动复盘", react.default.createElement("span", { style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				marginLeft: 4
			} }, "（对话结束后由 AI 自动判断是否写入记忆）")), react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8
			} }, react.default.createElement("label", { style: {
				fontSize: 13,
				color: "var(--dsw-alias-label-secondary)",
				whiteSpace: "nowrap"
			} }, "每"), react.default.createElement("input", {
				type: "number",
				min: 1,
				max: 100,
				value: nudgeInterval,
				disabled: !reviewEnabled,
				onChange: (e) => setNudgeInterval(Math.max(1, parseInt(e.target.value) || 1)),
				style: {
					width: 60,
					padding: "4px 8px",
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: 6,
					background: "transparent",
					color: "inherit",
					fontSize: 13,
					font: "inherit",
					textAlign: "center"
				}
			}), react.default.createElement("span", { style: {
				fontSize: 13,
				color: "var(--dsw-alias-label-secondary)"
			} }, "轮用户消息后自动复盘")), react.default.createElement("div", { style: {
				display: "flex",
				justifyContent: "flex-end",
				marginTop: 4
			} }, react.default.createElement("button", {
				type: "button",
				onClick: handleSaveConfig,
				disabled: configLoading,
				style: {
					border: "none",
					borderRadius: 6,
					padding: "7px 16px",
					background: "var(--dsw-alias-color-primary, #0066ff)",
					color: "#fff",
					fontSize: 13,
					cursor: "pointer",
					font: "inherit",
					fontWeight: 500,
					opacity: configLoading ? .6 : 1
				}
			}, configLoading ? "保存中…" : "保存配置")))), react.default.createElement("div", { style: {
				...sectionCardStyle,
				border: "1px solid var(--dsw-alias-color-error, #ef4444)"
			} }, react.default.createElement("div", { style: {
				fontSize: 14,
				fontWeight: 600,
				marginBottom: 12,
				color: "var(--dsw-alias-label-error)"
			} }, "⚠️ 危险操作"), react.default.createElement("div", { style: {
				display: "flex",
				gap: 8,
				flexWrap: "wrap"
			} }, react.default.createElement("button", {
				type: "button",
				style: {
					...dangerButtonStyle,
					padding: "7px 14px",
					fontSize: 13
				},
				disabled: resetting !== null,
				onClick: () => handleReset("memory")
			}, resetting === "memory" ? "重置中…" : "重置 MEMORY.md"), react.default.createElement("button", {
				type: "button",
				style: {
					...dangerButtonStyle,
					padding: "7px 14px",
					fontSize: 13
				},
				disabled: resetting !== null,
				onClick: () => handleReset("user")
			}, resetting === "user" ? "重置中…" : "重置 USER.md"), react.default.createElement("button", {
				type: "button",
				style: {
					...dangerButtonStyle,
					padding: "7px 14px",
					fontSize: 13,
					fontWeight: 600
				},
				disabled: resetting !== null,
				onClick: () => handleReset("all")
			}, resetting === "all" ? "重置中…" : "重置全部")))) : null);
		}
		function MemoryDock({ sessionId }) {
			const [status, setStatus] = react.default.useState(null);
			const [expandedReviews, setExpandedReviews] = react.default.useState(/* @__PURE__ */ new Set());
			const [reviewProgress, setReviewProgress] = react.default.useState(null);
			const [modalOpen, setModalOpen] = react.default.useState(false);
			const [entries, setEntries] = react.default.useState({
				memory: [],
				user: []
			});
			const [reviewHistory, setReviewHistory] = react.default.useState([]);
			const [tab, setTab] = react.default.useState("memory");
			const [selected, setSelected] = react.default.useState(/* @__PURE__ */ new Set());
			const [loading, setLoading] = react.default.useState(false);
			const [toast, setToast] = react.default.useState(null);
			react.default.useEffect(() => {
				const refresh = () => {
					fetchStatus().then(setStatus);
					fetchReviewProgress(sessionId).then(setReviewProgress);
				};
				refresh();
				const interval = setInterval(refresh, 2e3);
				return () => clearInterval(interval);
			}, [sessionId]);
			react.default.useEffect(() => {
				if (toast) {
					const timer = setTimeout(() => setToast(null), 2e3);
					return () => clearTimeout(timer);
				}
			}, [toast]);
			react.default.useEffect(() => {
				setSelected(/* @__PURE__ */ new Set());
			}, [tab]);
			const openModal = async () => {
				setModalOpen(true);
				setLoading(true);
				const [memEntries, userEntries, reviews] = await Promise.all([
					fetchEntries("memory"),
					fetchEntries("user"),
					fetchReviewHistory(sessionId)
				]);
				const memVal = memEntries?.ok === true && memEntries.value?.entries ? memEntries.value.entries : [];
				const userVal = userEntries?.ok === true && userEntries.value?.entries ? userEntries.value.entries : [];
				const newestFirst = (items) => [...items].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
				setEntries({
					memory: newestFirst(memVal),
					user: newestFirst(userVal)
				});
				setReviewHistory([...reviews].sort((a, b) => b.completedAt.localeCompare(a.completedAt)));
				setLoading(false);
			};
			const closeModal = () => {
				setModalOpen(false);
				setSelected(/* @__PURE__ */ new Set());
			};
			const reloadEntries = async () => {
				const [memEntries, userEntries] = await Promise.all([fetchEntries("memory"), fetchEntries("user")]);
				const memVal = memEntries?.ok === true && memEntries.value?.entries ? memEntries.value.entries : [];
				const userVal = userEntries?.ok === true && userEntries.value?.entries ? userEntries.value.entries : [];
				const newestFirst = (items) => [...items].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
				setEntries({
					memory: newestFirst(memVal),
					user: newestFirst(userVal)
				});
				const s = await fetchStatus();
				if (s) setStatus(s);
			};
			const handleDeleteSelected = async () => {
				const indices = currentEntries.filter((entry) => selected.has(entry.index)).map((entry) => entry.index).sort((a, b) => b - a);
				if (indices.length === 0) return;
				if (await deleteEntries(tab, indices)) {
					setToast(`已删除 ${indices.length} 条`);
					setSelected(/* @__PURE__ */ new Set());
					await reloadEntries();
				} else setToast("删除失败");
			};
			const handleDeleteSingle = async (index) => {
				if (await deleteEntries(tab, [index])) {
					setToast("已删除");
					await reloadEntries();
				} else setToast("删除失败");
			};
			const toggleReview = (key) => {
				setExpandedReviews((previous) => {
					const next = new Set(previous);
					if (next.has(key)) next.delete(key);
					else next.add(key);
					return next;
				});
			};
			const toggleSelected = (index) => {
				setSelected((prev) => {
					const next = new Set(prev);
					if (next.has(index)) next.delete(index);
					else next.add(index);
					return next;
				});
			};
			const currentEntries = tab === "reviews" ? [] : entries[tab];
			const cellStyle = {
				padding: "6px 8px",
				fontSize: 12,
				borderBottom: "1px solid var(--dsw-alias-border-l2)",
				color: "var(--dsw-alias-label-primary)",
				lineHeight: "1.5",
				wordBreak: "break-word",
				verticalAlign: "top"
			};
			if (!status) return null;
			return react.default.createElement("div", { style: { display: "contents" } }, react.default.createElement("div", {
				style: {
					textAlign: "center",
					color: "var(--dsw-alias-label-tertiary)",
					fontSize: 12,
					lineHeight: "20px",
					padding: "2px 16px 0",
					cursor: "pointer"
				},
				onClick: openModal,
				title: "点击查看记忆详情"
			}, `📝 MEMORY: ${status.memory.entries} 条 · USER: ${status.user.entries} 条${reviewProgress?.reviewEnabled ? `（距下次后台更新 ${reviewProgress.remainingTurns} 轮）` : ""}`), modalOpen ? react.default.createElement("div", {
				key: "memory-modal-overlay",
				style: {
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					background: "rgba(0,0,0,0.5)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 9999
				},
				onClick: (e) => {
					if (e.target === e.currentTarget) closeModal();
				}
			}, react.default.createElement("div", {
				style: {
					background: "var(--dsw-alias-bg-layer-1, #fff)",
					borderRadius: 12,
					width: "80vw",
					maxWidth: 800,
					maxHeight: "80vh",
					display: "flex",
					flexDirection: "column",
					boxShadow: "0 8px 32px rgba(0,0,0,0.2)"
				},
				onClick: (e) => e.stopPropagation()
			}, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "14px 16px",
				borderBottom: "1px solid var(--dsw-alias-border-l2)"
			} }, react.default.createElement("strong", { style: {
				fontSize: 15,
				fontWeight: 600
			} }, "持久记忆"), react.default.createElement("button", {
				type: "button",
				onClick: closeModal,
				style: {
					border: 0,
					background: "transparent",
					color: "inherit",
					fontSize: 18,
					cursor: "pointer",
					padding: "0 4px"
				}
			}, "✕")), toast ? react.default.createElement("div", { style: {
				margin: "8px 16px 0",
				padding: "6px 12px",
				borderRadius: 6,
				background: "var(--dsw-alias-color-success, #22c55e)",
				color: "#fff",
				fontSize: 12,
				textAlign: "center"
			} }, toast) : null, react.default.createElement("div", { style: {
				display: "flex",
				gap: 0,
				borderBottom: "1px solid var(--dsw-alias-border-l2)",
				padding: "0 16px"
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
			}, `MEMORY.md (${entries.memory.length} 条)`), react.default.createElement("button", {
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
			}, `USER.md (${entries.user.length} 条)`), react.default.createElement("button", {
				type: "button",
				onClick: () => setTab("reviews"),
				style: {
					flex: 1,
					border: 0,
					background: "transparent",
					color: "inherit",
					cursor: "pointer",
					padding: "8px 0",
					fontSize: 13,
					borderBottom: tab === "reviews" ? "2px solid var(--dsw-alias-label-primary)" : "2px solid transparent",
					fontWeight: tab === "reviews" ? 600 : 400
				}
			}, `后台更新记录 (${reviewHistory.length} 条)`)), selected.size > 0 ? react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12,
				padding: "8px 16px",
				background: "var(--dsw-alias-bg-layer-2)"
			} }, react.default.createElement("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, `已选 ${selected.size} 条`), react.default.createElement("button", {
				type: "button",
				onClick: handleDeleteSelected,
				style: dangerButtonStyle
			}, "删除选中"), react.default.createElement("button", {
				type: "button",
				onClick: () => setSelected(/* @__PURE__ */ new Set()),
				style: buttonStyle
			}, "取消选择")) : null, react.default.createElement("div", { style: {
				flex: 1,
				overflow: "auto",
				padding: "0 16px 16px"
			} }, loading ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)",
				padding: 8
			} }, "加载中…") : tab === "reviews" ? reviewHistory.length === 0 ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)",
				padding: 8
			} }, "（尚无后台更新记录）") : react.default.createElement("table", { style: {
				width: "100%",
				borderCollapse: "collapse",
				tableLayout: "fixed",
				marginTop: 8,
				fontSize: 12
			} }, react.default.createElement("thead", null, react.default.createElement("tr", null, react.default.createElement("th", { style: {
				...cellStyle,
				width: 172,
				fontWeight: 600
			} }, "更新时间"), react.default.createElement("th", { style: {
				...cellStyle,
				width: 112,
				fontWeight: 600
			} }, "结果"), react.default.createElement("th", { style: {
				...cellStyle,
				width: 120,
				fontWeight: 600
			} }, "结束状态"), react.default.createElement("th", { style: {
				...cellStyle,
				fontWeight: 600
			} }, "变更详情"))), react.default.createElement("tbody", null, reviewHistory.map((record, index) => {
				const key = `${record.completedAt}-${index}`;
				const expanded = expandedReviews.has(key);
				const summary = record.changes.length === 0 ? "无变更" : record.changes.map((change) => `${change.target === "user" ? "USER" : "MEMORY"} ${change.action === "added" ? "+" : "−"} 1 项`).join(" · ");
				return react.default.createElement("tr", { key }, react.default.createElement("td", { style: {
					...cellStyle,
					color: "var(--dsw-alias-label-tertiary)"
				} }, record.completedAt === "" ? "升级前未记录" : formatTime(record.completedAt)), react.default.createElement("td", { style: cellStyle }, record.changes.length > 0 ? `已保存 ${record.changes.length} 项` : "未修改记忆"), react.default.createElement("td", { style: {
					...cellStyle,
					color: "var(--dsw-alias-label-tertiary)"
				} }, reviewReasonLabel(record.reason)), react.default.createElement("td", { style: cellStyle }, react.default.createElement("button", {
					type: "button",
					onClick: () => toggleReview(key),
					"aria-expanded": expanded,
					style: {
						border: 0,
						padding: 0,
						background: "transparent",
						color: "var(--dsw-alias-state-business-primary)",
						cursor: "pointer",
						fontSize: 12,
						textAlign: "left"
					}
				}, `${expanded ? "−" : "+"} ${expanded ? "收起详情" : summary}`), expanded ? react.default.createElement("div", { style: {
					display: "grid",
					gap: 5,
					marginTop: 8,
					padding: 8,
					borderRadius: 4,
					background: "var(--dsw-alias-bg-layer-2)"
				} }, record.changes.length === 0 ? react.default.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)" } }, "现有记忆已覆盖本轮对话中的长期信息。") : record.changes.map((change, changeIndex) => react.default.createElement("div", {
					key: `${changeIndex}-${change.content}`,
					style: {
						display: "grid",
						gridTemplateColumns: "76px 18px 1fr",
						gap: 6,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word"
					}
				}, react.default.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, change.target === "user" ? "USER" : "MEMORY"), react.default.createElement("span", { style: { color: change.action === "added" ? "var(--dsw-alias-color-success, #22c55e)" : "var(--dsw-alias-label-error)" } }, change.action === "added" ? "+" : "−"), react.default.createElement("span", null, change.content)))) : null));
			}))) : currentEntries.length === 0 ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)",
				padding: 8
			} }, "（空）") : react.default.createElement("table", { style: {
				width: "100%",
				borderCollapse: "collapse",
				tableLayout: "fixed",
				marginTop: 8
			} }, react.default.createElement("thead", { style: {
				position: "sticky",
				top: 0,
				background: "var(--dsw-alias-bg-layer-1, #fff)",
				zIndex: 1
			} }, react.default.createElement("tr", null, react.default.createElement("th", { style: {
				...cellStyle,
				width: 32,
				textAlign: "center",
				fontWeight: 600
			} }, ""), react.default.createElement("th", { style: {
				...cellStyle,
				fontWeight: 600,
				width: 160
			} }, "时间"), react.default.createElement("th", { style: {
				...cellStyle,
				fontWeight: 600
			} }, "内容"), react.default.createElement("th", { style: {
				...cellStyle,
				width: 60,
				textAlign: "center",
				fontWeight: 600
			} }, "操作"))), react.default.createElement("tbody", null, currentEntries.map((entry) => react.default.createElement("tr", {
				key: entry.index,
				style: { background: selected.has(entry.index) ? "var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.05))" : void 0 }
			}, react.default.createElement("td", { style: {
				...cellStyle,
				textAlign: "center"
			} }, react.default.createElement("input", {
				type: "checkbox",
				checked: selected.has(entry.index),
				onChange: () => toggleSelected(entry.index)
			})), react.default.createElement("td", { style: {
				...cellStyle,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			} }, formatTime(entry.timestamp)), react.default.createElement("td", { style: cellStyle }, entry.content), react.default.createElement("td", { style: {
				...cellStyle,
				textAlign: "center"
			} }, react.default.createElement("button", {
				type: "button",
				onClick: () => handleDeleteSingle(entry.index),
				style: {
					...smallButtonStyle,
					color: "var(--dsw-alias-label-error)",
					borderColor: "var(--dsw-alias-label-error)"
				},
				title: "删除此条"
			}, "删除"))))))))) : null);
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