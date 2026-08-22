import { c as validatePricing, t as Config } from "./src-C2JITb6y.js";
//#region src/settings.ts
const SETTINGS_NS = "cost-meter";
const ROUTE_PATH = "/cost-meter/pricing";
/** Same-origin loopback fence for the pricing route (mirrors dsh's /api trust model). */
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
const name = "cost-meter-settings";
const inject = ["settings"];
/** Register the live pricing namespace and the browser settings-card route. */
function apply(ctx, config) {
	const settings = ctx.get("settings");
	if (settings === void 0) return;
	const scope = settings.register(SETTINGS_NS, Config, {
		base: config,
		validate: validatePricing
	});
	ctx.inject(["webServer"], (webCtx) => {
		webCtx.webServer.register({
			name: "cost-meter-pricing",
			kind: "exact",
			path: ROUTE_PATH,
			handler: async (req, res) => {
				const send = (status, body) => {
					res.writeHead(status, { "content-type": "application/json" });
					res.end(JSON.stringify(body));
				};
				if (!isTrustedRequest(req)) {
					send(403, {
						ok: false,
						error: "request refused: this route answers same-origin loopback only"
					});
					return;
				}
				if (req.method === "GET") {
					try {
						send(200, {
							ok: true,
							value: scope.get()
						});
					} catch (error) {
						send(409, {
							ok: false,
							error: String(error instanceof Error ? error.message : error)
						});
					}
					return;
				}
				if (req.method !== "POST") {
					res.writeHead(405).end();
					return;
				}
				try {
					const chunks = [];
					let total = 0;
					for await (const chunk of req) {
						total += chunk.length;
						if (total > 262144) {
							send(413, {
								ok: false,
								error: "pricing payload too large"
							});
							req.destroy();
							return;
						}
						chunks.push(chunk);
					}
					const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					validatePricing(body);
					await settings.replace(SETTINGS_NS, body);
					send(200, {
						ok: true,
						value: scope.get()
					});
				} catch (error) {
					send(400, {
						ok: false,
						error: String(error instanceof Error ? error.message : error)
					});
				}
			}
		});
	});
}
//#endregion
export { apply, inject, name };
