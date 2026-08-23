import { d as MemoryStore, l as memoryReviewProgress, t as Config, u as memoryReviewNotices } from "./src-Dh_pIN17.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
//#region src/settings.ts
/** Host settings registration and memory HTTP route for dsh-memory. */
const MEMORY_ROUTE = "/memory/api";
const SETTINGS_NS = "memory";
/** Same-origin loopback fence for the memory route. */
function isTrustedRequest(req) {
	const host = req.headers?.host;
	if (typeof host !== "string" || host === "") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (!isLoopbackHost(hostUrl.hostname)) return false;
	if (req.headers?.["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers?.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
function isLoopbackHost(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
const send = (res, status, body) => {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
};
const name = "memory-settings";
const inject = ["settings"];
/** Register the settings namespace and memory HTTP route for browser settings management. */
function apply(ctx) {
	const settings = ctx.get("settings");
	if (settings !== void 0) settings.register(SETTINGS_NS, Config, {
		base: {},
		validate: () => {}
	});
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = webCtx.webServer;
		const store = new MemoryStore({
			dir: MemoryStore.defaultDir(),
			memoryCharLimit: 2200,
			userCharLimit: 1375
		});
		webServer.register({
			name: "memory-api",
			kind: "prefix",
			path: MEMORY_ROUTE,
			handler: async (req, res) => {
				if (!isTrustedRequest(req)) {
					send(res, 403, {
						ok: false,
						error: "request refused: same-origin loopback only"
					});
					return;
				}
				const url = new URL(req.url, `http://${req.headers.host}`);
				const method = req.method;
				if (method === "GET" && url.pathname === "/memory/api/status") {
					await store.loadFromDisk();
					const memEntries = store.entriesFor("memory");
					const userEntries = store.entriesFor("user");
					const memDir = MemoryStore.defaultDir();
					let memSize = 0;
					let userSize = 0;
					try {
						const memStat = await readFile(join(memDir, "MEMORY.md")).then((b) => b.length).catch(() => 0);
						const userStat = await readFile(join(memDir, "USER.md")).then((b) => b.length).catch(() => 0);
						memSize = memStat;
						userSize = userStat;
					} catch {}
					send(res, 200, {
						ok: true,
						value: {
							memory: {
								size: memSize,
								entries: memEntries.length,
								usage: store.usageString("memory")
							},
							user: {
								size: userSize,
								entries: userEntries.length,
								usage: store.usageString("user")
							}
						}
					});
					return;
				}
				if (method === "GET" && url.pathname === "/memory/api/entries") {
					const target = url.searchParams.get("target") === "user" ? "user" : "memory";
					await store.loadFromDisk();
					const entries = store.entriesWithMeta(target);
					send(res, 200, {
						ok: true,
						value: {
							target,
							entries: entries.map((e) => ({
								content: e.content,
								timestamp: e.timestamp
							})),
							usage: store.usageString(target)
						}
					});
					return;
				}
				if (method === "GET" && url.pathname === "/memory/api/review-notice") {
					const sessionId = url.searchParams.get("sessionId");
					if (sessionId === null || sessionId === "") {
						send(res, 400, {
							ok: false,
							error: "sessionId is required."
						});
						return;
					}
					send(res, 200, {
						ok: true,
						value: await memoryReviewNotices.get(sessionId) ?? null
					});
					return;
				}
				if (method === "GET" && url.pathname === "/memory/api/review-progress") {
					const sessionId = url.searchParams.get("sessionId");
					if (sessionId === null || sessionId === "") {
						send(res, 400, {
							ok: false,
							error: "sessionId is required."
						});
						return;
					}
					send(res, 200, {
						ok: true,
						value: memoryReviewProgress.get(sessionId) ?? null
					});
					return;
				}
				if (method === "GET" && url.pathname === "/memory/api/config") {
					const settings = ctx.get("settings");
					let nudgeInterval = 10;
					let reviewEnabled = true;
					if (settings?.get) {
						const cfg = settings.get("memory");
						if (cfg) {
							nudgeInterval = cfg.nudgeInterval ?? 10;
							reviewEnabled = cfg.reviewEnabled ?? true;
						}
					}
					send(res, 200, {
						ok: true,
						value: {
							nudgeInterval,
							reviewEnabled
						}
					});
					return;
				}
				if (method === "POST" && url.pathname === "/memory/api/config") {
					let body = "";
					for await (const chunk of req) body += chunk;
					let parsed;
					try {
						parsed = JSON.parse(body);
					} catch {
						parsed = {};
					}
					const settings = ctx.get("settings");
					if (settings?.update) {
						const patch = {};
						if (parsed.nudgeInterval !== void 0) patch.nudgeInterval = parsed.nudgeInterval;
						if (parsed.reviewEnabled !== void 0) patch.reviewEnabled = parsed.reviewEnabled;
						await settings.update("memory", patch);
						send(res, 200, { ok: true });
					} else send(res, 200, {
						ok: true,
						note: "Settings service not available; values will be used for this session only."
					});
					return;
				}
				if (method === "POST" && url.pathname === "/memory/api/delete-entries") {
					let body = "";
					for await (const chunk of req) body += chunk;
					let parsed;
					try {
						parsed = JSON.parse(body);
					} catch {
						parsed = {};
					}
					const target = parsed.target === "user" ? "user" : "memory";
					const indices = Array.isArray(parsed.indices) ? parsed.indices : [];
					if (indices.length === 0) {
						send(res, 400, {
							ok: false,
							error: "No indices provided."
						});
						return;
					}
					const result = await store.removeByIndices(target, indices);
					send(res, result.success ? 200 : 400, {
						ok: result.success,
						value: result
					});
					return;
				}
				if (method === "POST" && url.pathname === "/memory/api/reset") {
					let body = "";
					for await (const chunk of req) body += chunk;
					let parsed;
					try {
						parsed = JSON.parse(body);
					} catch {
						parsed = {};
					}
					const target = parsed.target === "user" ? "user" : parsed.target === "all" ? "all" : "memory";
					const memDir = MemoryStore.defaultDir();
					const deleted = [];
					if (target === "memory" || target === "all") try {
						await writeFile(join(memDir, "MEMORY.md"), "", { mode: 384 });
						deleted.push("MEMORY.md");
					} catch {}
					if (target === "user" || target === "all") try {
						await writeFile(join(memDir, "USER.md"), "", { mode: 384 });
						deleted.push("USER.md");
					} catch {}
					send(res, 200, {
						ok: true,
						deleted
					});
					return;
				}
				send(res, 404, {
					ok: false,
					error: "not found"
				});
			}
		});
	});
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=settings.js.map