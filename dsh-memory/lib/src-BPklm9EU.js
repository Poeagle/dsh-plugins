import z from "@deepseek-ai/schemastery";
import { defineTool, parameterSchemaSpecToJsonSchema } from "@deepseek-ai/dsh-tools";
import { BlockAssembler, createAssistantMessage, createToolResultMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
//#region src/threats.ts
/**
* Prompt-injection and exfiltration pattern scanner for memory content.
*
* Pattern philosophy mirrors the upstream library: patterns anchor on
* C2-specific vocabulary or unambiguous attack behavior, not on bossy
* English. Scopes control which scanners apply: `all` (classic injection and
* exfiltration, minimal false positives), `context` (adds promptware / C2 /
* role-hijack detection), `strict` (adds persistence, SSH-backdoor, and
* exfil-URL patterns appropriate for user-curated memory writes). Memory
* stores scan at the `strict` scope because a poisoned entry persists in the
* frozen system-prompt snapshot for whole sessions.
* @module dsh-memory/threats
*/
/**
* Hard cap on text scanned with regexes. Memory entries are bounded by the
* store limits anyway; the cap keeps worst-case scan time predictable if a
* caller hands the scanner a longer string.
*/
const MAX_SCAN_CHARS = 65536;
/**
* Bounded filler between key attack words — enough for the intended
* obfuscation bypasses ("ignore all prior instructions") without unbounded
* regex backtracking.
*/
const FILLER = String.raw`(?:\w+\s+){0,8}`;
/**
* The pattern table. `scope` names where a pattern originates: `all` patterns
* land in every set, `context` patterns land in context + strict, `strict`
* patterns land in strict only.
*/
const PATTERNS = [
	[
		String.raw`ignore\s+${FILLER}(previous|all|above|prior)\s+${FILLER}instructions`,
		"prompt_injection",
		"all"
	],
	[
		String.raw`system\s+prompt\s+override`,
		"sys_prompt_override",
		"all"
	],
	[
		String.raw`disregard\s+${FILLER}(your|all|any)\s+${FILLER}(instructions|rules|guidelines)`,
		"disregard_rules",
		"all"
	],
	[
		String.raw`act\s+as\s+(if|though)\s+${FILLER}you\s+${FILLER}(have\s+no|don't\s+have)\s+${FILLER}(restrictions|limits|rules)`,
		"bypass_restrictions",
		"all"
	],
	[
		String.raw`<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->`,
		"html_comment_injection",
		"all"
	],
	[
		String.raw`<\s*div\s+style\s*=\s*["'][^>]{0,2048}display\s*:\s*none`,
		"hidden_div",
		"all"
	],
	[
		String.raw`translate\s+[^\n]{0,512}\s+into\s+[^\n]{0,512}\s+and\s+(execute|run|eval)`,
		"translate_execute",
		"all"
	],
	[
		String.raw`do\s+not\s+${FILLER}tell\s+${FILLER}the\s+user`,
		"deception_hide",
		"all"
	],
	[
		String.raw`you\s+are\s+${FILLER}now\s+(?:a|an|the)\s+`,
		"role_hijack",
		"context"
	],
	[
		String.raw`pretend\s+${FILLER}(you\s+are|to\s+be)\s+`,
		"role_pretend",
		"context"
	],
	[
		String.raw`output\s+${FILLER}(system|initial)\s+prompt`,
		"leak_system_prompt",
		"context"
	],
	[
		String.raw`(respond|answer|reply)\s+without\s+${FILLER}(restrictions|limitations|filters|safety)`,
		"remove_filters",
		"context"
	],
	[
		String.raw`you\s+have\s+been\s+${FILLER}(updated|upgraded|patched)\s+to`,
		"fake_update",
		"context"
	],
	[
		String.raw`\bname\s+yourself\s+\w+`,
		"identity_override",
		"context"
	],
	[
		String.raw`register\s+(as\s+)?a?\s*node`,
		"c2_node_registration",
		"context"
	],
	[
		String.raw`(heartbeat|beacon|check[\s-]?in)\s+(to|with)\s+`,
		"c2_heartbeat",
		"context"
	],
	[
		String.raw`pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b`,
		"c2_task_pull",
		"context"
	],
	[
		String.raw`connect\s+to\s+the\s+network\b`,
		"c2_network_connect",
		"context"
	],
	[
		String.raw`you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b`,
		"forced_action",
		"context"
	],
	[
		String.raw`only\s+use\s+one[\s-]?liners?\b`,
		"anti_forensic_oneliner",
		"context"
	],
	[
		String.raw`never\s+${FILLER}(?:create|write)\s+${FILLER}(?:script|file)\s+${FILLER}disk`,
		"anti_forensic_disk",
		"context"
	],
	[
		String.raw`unset\s+\w*(?:CLAUDE|CODEX|HERMES|DSH|AGENT|OPENAI|ANTHROPIC)\w*`,
		"env_var_unset_agent",
		"context"
	],
	[
		String.raw`\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b`,
		"known_c2_framework",
		"context"
	],
	[
		String.raw`\bc2\s+(?:server|channel|infrastructure|beacon)\b`,
		"c2_explicit",
		"context"
	],
	[
		String.raw`\bcommand\s+and\s+control\b`,
		"c2_explicit_long",
		"context"
	],
	[
		String.raw`curl\s+[^\n]{0,2048}\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`,
		"exfil_curl",
		"all"
	],
	[
		String.raw`wget\s+[^\n]{0,2048}\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`,
		"exfil_wget",
		"all"
	],
	[
		String.raw`cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`,
		"read_secrets",
		"all"
	],
	[
		String.raw`(send|post|upload|transmit)\s+[^\n]{0,2048}\s+(to|at)\s+https?://`,
		"send_to_url",
		"strict"
	],
	[
		String.raw`(include|output|print|share)\s+${FILLER}(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)`,
		"context_exfil",
		"strict"
	],
	[
		String.raw`authorized_keys`,
		"ssh_backdoor",
		"strict"
	],
	[
		String.raw`\$HOME/\.ssh|~/\.ssh`,
		"ssh_access",
		"strict"
	],
	[
		String.raw`\$HOME/\.dsh/\.env|~/\.dsh/\.env`,
		"dsh_env",
		"strict"
	],
	[
		String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)`,
		"agent_config_mod",
		"strict"
	],
	[
		String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}\.dsh/(config\.yaml|SOUL\.md)`,
		"dsh_config_mod",
		"strict"
	],
	[
		String.raw`(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}`,
		"hardcoded_secret",
		"strict"
	]
];
/**
* Invisible / bidirectional unicode characters used in injection attacks —
* zero-width joiners, directional overrides, and invisible math operators.
*/
const INVISIBLE_CHARS = /* @__PURE__ */ new Set([
	"​",
	"‌",
	"‍",
	"⁠",
	"⁢",
	"⁣",
	"⁤",
	"﻿",
	"‪",
	"‫",
	"‬",
	"‭",
	"‮",
	"⁦",
	"⁧",
	"⁨",
	"⁩"
]);
/** Compiled scope sets, indexed by scope name. */
const COMPILED = {
	all: [],
	context: [],
	strict: []
};
for (const [source, pid, scope] of PATTERNS) {
	const entry = {
		pattern: new RegExp(source, "i"),
		pid
	};
	if (scope === "all") {
		COMPILED.all.push(entry);
		COMPILED.context.push(entry);
		COMPILED.strict.push(entry);
	} else if (scope === "context") {
		COMPILED.context.push(entry);
		COMPILED.strict.push(entry);
	} else COMPILED.strict.push(entry);
}
/**
* Scan content for threat patterns at one scope.
* @param content - the text to scan; empty strings produce no findings.
* @param scope - which pattern set to apply (`all` narrow, `context` default
* breadth, `strict` broadest).
* @returns matched pattern ids; invisible unicode hits report as
* `invisible_unicode_U+XXXX`.
*/
function scanForThreats(content, scope) {
	if (content.length === 0) return [];
	const findings = [];
	const bounded = content.slice(0, MAX_SCAN_CHARS);
	const distinct = new Set(bounded);
	for (const char of distinct) {
		if (!INVISIBLE_CHARS.has(char)) continue;
		const code = char.charCodeAt(0);
		findings.push(`invisible_unicode_U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
	}
	const normalized = bounded.normalize("NFKC");
	for (const { pattern, pid } of COMPILED[scope]) if (pattern.test(normalized)) findings.push(pid);
	return findings;
}
/**
* Human-readable error for the first threat found, or `undefined` when clean.
* @param content - the text to scan.
* @param scope - which pattern set to apply.
* @returns the blocking message, or `undefined` for clean content.
*/
function firstThreatMessage(content, scope) {
	const pid = scanForThreats(content, scope)[0];
	if (pid === void 0) return void 0;
	if (pid.startsWith("invisible_unicode_")) return `Blocked: content contains invisible unicode character ${pid.slice(18)} (possible injection).`;
	return `Blocked: content matches threat pattern '${pid}'. Content is injected into the system prompt and must not contain injection or exfiltration payloads.`;
}
//#endregion
//#region src/store.ts
/**
* Bounded curated memory with file persistence — the DSH port of the
* upstream memory store. Two `§`-delimited files under `$DSH_HOME/memories/`
* hold the entries; a frozen snapshot captured at load time feeds the system
* prompt while live mutations go to disk immediately. Mid-session writes do
* not change the prompt snapshot, preserving the request prefix for the
* whole session; the snapshot refreshes on the next store load.
* @module dsh-memory/store
*/
/** Entry delimiter — entries may be multiline, so the delimiter spans lines. */
const ENTRY_DELIMITER = "\n§\n";
/** Stable header prefixes of the system-prompt blocks. */
const MEMORY_BLOCK_HEADERS = {
	memory: "MEMORY (your personal notes)",
	user: "USER PROFILE (who the user is)"
};
/** Sentinel: the target file exists on disk but could not be read. */
const READ_FAILED = Symbol("read-failed");
/** Permission bits for memory files and their directory (owner-private). */
const FILE_MODE$2 = 384;
const DIR_MODE$2 = 448;
/**
* After this many failed consolidation attempts (overflow / zero-match) in
* one turn, stop instructing the model to retry and return a terminal result
* so a fragile replace/add cannot loop the turn to budget exhaustion and
* suppress the user's reply.
*/
const MAX_CONSOLIDATION_FAILURES_PER_TURN = 3;
/** Format a count with thousands separators, matching the upstream responses. */
function grouped(count) {
	return count.toLocaleString("en-US");
}
/**
* Bounded curated memory with file persistence. Maintains two parallel states:
* a frozen snapshot captured at {@link loadFromDisk}, injected into the system
* prompt and never mutated mid-session (request prefix stability), and the
* live entry lists mutated by tool calls and persisted to disk (tool
* responses always reflect live state).
*/
var MemoryStore = class {
	dir;
	memoryCharLimit;
	userCharLimit;
	entries = {
		memory: [],
		user: []
	};
	timestamps = {
		memory: /* @__PURE__ */ new Map(),
		user: /* @__PURE__ */ new Map()
	};
	snapshot = {
		memory: "",
		user: ""
	};
	consolidationFailures = 0;
	/**
	* Create an unloaded store. Call {@link loadFromDisk} before first use.
	* @param options - storage directory and per-target character limits.
	*/
	constructor(options) {
		this.dir = options.dir;
		this.memoryCharLimit = options.memoryCharLimit;
		this.userCharLimit = options.userCharLimit;
	}
	/**
	* Default storage directory: `$DSH_HOME/memories`.
	* @returns the absolute memories directory path.
	*/
	static defaultDir() {
		return dshHomePath("memories");
	}
	/** Reset the per-turn consolidation-failure counter (call at turn start). */
	resetConsolidationFailures() {
		this.consolidationFailures = 0;
	}
	/**
	* Load entries from MEMORY.md and USER.md and capture the frozen snapshot.
	* Each entry is scanned with the strict threat scope at snapshot-build
	* time: a hit replaces the entry text in the snapshot with a `[BLOCKED: …]`
	* placeholder so a poisoned-on-disk file cannot inject into the system
	* prompt, while the live lists keep the raw text so the owner can still
	* see and remove the poisoned entry.
	*/
	async loadFromDisk() {
		this.entries = {
			memory: dedupe(await this.readFile(this.pathFor("memory"))),
			user: dedupe(await this.readFile(this.pathFor("user")))
		};
		await this.loadMetadata("memory");
		await this.loadMetadata("user");
		this.snapshot = {
			memory: this.renderBlock("memory", sanitizeForSnapshot(this.entries.memory, "MEMORY.md")),
			user: this.renderBlock("user", sanitizeForSnapshot(this.entries.user, "USER.md"))
		};
	}
	/**
	* The frozen snapshot block for system-prompt injection — the state
	* captured at load time, not live state.
	* @param target - which store's block to return.
	* @returns the rendered block, or `undefined` when the snapshot is empty.
	*/
	formatForSystemPrompt(target) {
		const block = this.snapshot[target];
		return block.length > 0 ? block : void 0;
	}
	/**
	* Re-read the files from disk and rebuild the frozen snapshot. Call this
	* after a memory tool write to pick up the new state for the next step.
	*/
	async refreshSnapshot() {
		this.entries = {
			memory: dedupe(await this.readFile(this.pathFor("memory"))),
			user: dedupe(await this.readFile(this.pathFor("user")))
		};
		await this.loadMetadata("memory");
		await this.loadMetadata("user");
		this.snapshot = {
			memory: this.renderBlock("memory", sanitizeForSnapshot(this.entries.memory, "MEMORY.md")),
			user: this.renderBlock("user", sanitizeForSnapshot(this.entries.user, "USER.md"))
		};
	}
	/**
	* Render both stores as a single block for system-prompt section injection.
	* Returns an empty string when both stores are empty.
	* @returns the full block, or an empty string.
	*/
	renderContextBlock() {
		const blocks = [this.snapshot.memory, this.snapshot.user].filter((b) => b.length > 0);
		if (blocks.length === 0) return "";
		return blocks.join("\n\n");
	}
	/**
	* Live entries of one target (read-only view for diagnostics and tests).
	* Store-private timestamps never leave this public view.
	* @param target - which store to read.
	* @returns the live entry list without metadata.
	*/
	entriesFor(target) {
		return this.entries[target].map(stripTimestamp$1);
	}
	/**
	* Live entries with metadata (timestamp) for one target. Each entry is
	* paired with its creation/update timestamp. Old entries without timestamps
	* (from before this feature) get the file's mtime as a fallback.
	* @param target - which store to read.
	* @returns the live entry list with metadata.
	*/
	entriesWithMeta(target) {
		return this.entries[target].map((content) => ({
			content: stripTimestamp$1(content),
			timestamp: this.timestamps[target].get(stripTimestamp$1(content)) ?? extractTimestamp(content) ?? ""
		}));
	}
	/**
	* The grouped `current/limit` usage string, matching the error-path usage
	* fields (`"924/2,200"`).
	* @param target - which store to report.
	* @returns the usage string.
	*/
	usageString(target) {
		return `${grouped(this.charCount(target))}/${grouped(this.charLimit(target))}`;
	}
	/**
	* Append one entry; overflow returns a consolidation error with live entries.
	* @param target - which store receives the entry.
	* @param content - the entry text; trimmed before storage.
	* @returns the write outcome.
	*/
	async add(target, content) {
		const trimmed = content.trim();
		if (trimmed.length === 0) return {
			success: false,
			error: "Content cannot be empty."
		};
		const scanError = firstThreatMessage(trimmed, "strict");
		if (scanError !== void 0) return {
			success: false,
			error: scanError
		};
		return this.withLock(target, async () => {
			if ((await this.reloadTarget(target, { skipDrift: true })).kind === "read-failed") return readFailedError(this.pathFor(target));
			const entries = this.entries[target];
			if (entries.some((entry) => stripTimestamp$1(entry) === trimmed)) return this.successResponse(target, "Entry already exists (no duplicate added).");
			if (findSemanticOverlap(entries, trimmed) !== void 0) return {
				success: false,
				error: "Entry semantically overlaps an existing memory. Use replace to merge or update it instead of adding a duplicate.",
				current_entries: entries.map(stripTimestamp$1),
				usage: this.usageString(target)
			};
			if ([...entries, trimmed].join("\n§\n").length > this.charLimit(target)) {
				const current = this.charCount(target);
				return this.consolidationFailure({
					success: false,
					error: `Memory at ${grouped(current)}/${grouped(this.charLimit(target))} chars. Adding this entry (${trimmed.length} chars) would exceed the limit. Consolidate now: use 'replace' to merge overlapping entries into shorter ones or 'remove' stale or less important entries (see current_entries below), then retry this add — all in this turn.`,
					current_entries: this.entries[target].map(stripTimestamp$1),
					usage: `${grouped(current)}/${grouped(this.charLimit(target))}`
				});
			}
			entries.push(trimmed);
			this.timestamps[target].set(trimmed, (/* @__PURE__ */ new Date()).toISOString());
			await this.saveToDisk(target);
			return this.successResponse(target, "Entry added.");
		});
	}
	/**
	* Replace the entry containing `oldText` with `newContent`.
	* @param target - which store holds the entry.
	* @param oldText - substring identifying the entry to replace; must match exactly one.
	* @param newContent - replacement entry text; trimmed before storage.
	* @returns the write outcome.
	*/
	async replace(target, oldText, newContent) {
		const trimmedOld = oldText.trim();
		const trimmedNew = newContent.trim();
		if (trimmedOld.length === 0) return {
			success: false,
			error: "old_text cannot be empty."
		};
		if (trimmedNew.length === 0) return {
			success: false,
			error: "new_content cannot be empty. Use 'remove' to delete entries."
		};
		const scanError = firstThreatMessage(trimmedNew, "strict");
		if (scanError !== void 0) return {
			success: false,
			error: scanError
		};
		return this.withLock(target, async () => {
			const refusal = await this.reloadGuarded(target);
			if (refusal !== void 0) return refusal;
			const entries = this.entries[target];
			const match = this.matchOrError(entries, trimmedOld, "replace");
			if (typeof match !== "number") return match;
			const testEntries = [...entries];
			testEntries[match] = trimmedNew;
			const newTotal = testEntries.join(ENTRY_DELIMITER).length;
			if (newTotal > this.charLimit(target)) {
				const current = this.charCount(target);
				return this.consolidationFailure({
					success: false,
					error: `Replacement would put memory at ${grouped(newTotal)}/${grouped(this.charLimit(target))} chars. Shorten the new content, or 'remove' other stale or less important entries to make room (see current_entries below), then retry — all in this turn.`,
					current_entries: entries.map(stripTimestamp$1),
					usage: `${grouped(current)}/${grouped(this.charLimit(target))}`
				});
			}
			const previous = stripTimestamp$1(entries[match]);
			entries[match] = trimmedNew;
			this.timestamps[target].delete(previous);
			this.timestamps[target].set(trimmedNew, (/* @__PURE__ */ new Date()).toISOString());
			await this.saveToDisk(target);
			return this.successResponse(target, "Entry replaced.");
		});
	}
	/**
	* Remove the entry at the given index (0-based). Used for batch deletions
	* from the UI rather than from the memory tool.
	* @param target - which store holds the entry.
	* @param index - 0-based index of the entry to remove.
	* @returns the write outcome.
	*/
	async removeByIndex(target, index) {
		return this.withLock(target, async () => {
			const refusal = await this.reloadGuarded(target);
			if (refusal !== void 0) return refusal;
			const entries = this.entries[target];
			if (index < 0 || index >= entries.length) return {
				success: false,
				error: `Index ${index} out of range (0-${entries.length - 1}).`
			};
			const [removed] = entries.splice(index, 1);
			this.timestamps[target].delete(stripTimestamp$1(removed));
			await this.saveToDisk(target);
			return this.successResponse(target, "Entry removed.");
		});
	}
	/**
	* Remove multiple entries by their indices. All-or-nothing.
	* @param target - which store holds the entries.
	* @param indices - sorted 0-based indices to remove.
	* @returns the write outcome.
	*/
	async removeByIndices(target, indices) {
		if (indices.length === 0) return {
			success: false,
			error: "No indices provided."
		};
		return this.withLock(target, async () => {
			const refusal = await this.reloadGuarded(target);
			if (refusal !== void 0) return refusal;
			const entries = this.entries[target];
			const sorted = [...indices].sort((a, b) => b - a);
			for (const index of sorted) {
				if (index < 0 || index >= entries.length) return {
					success: false,
					error: `Index ${index} out of range (0-${entries.length - 1}). No changes applied.`
				};
				const [removed] = entries.splice(index, 1);
				this.timestamps[target].delete(stripTimestamp$1(removed));
			}
			await this.saveToDisk(target);
			return this.successResponse(target, `${indices.length} entry(s) removed.`);
		});
	}
	async remove(target, oldText) {
		const trimmedOld = oldText.trim();
		if (trimmedOld.length === 0) return {
			success: false,
			error: "old_text cannot be empty."
		};
		return this.withLock(target, async () => {
			const refusal = await this.reloadGuarded(target);
			if (refusal !== void 0) return refusal;
			const entries = this.entries[target];
			const match = this.matchOrError(entries, trimmedOld, "remove");
			if (typeof match !== "number") return match;
			const [removed] = entries.splice(match, 1);
			this.timestamps[target].delete(stripTimestamp$1(removed));
			await this.saveToDisk(target);
			return this.successResponse(target, "Entry removed.");
		});
	}
	/**
	* Apply add/replace/remove operations to one target atomically. All
	* operations validate against the FINAL budget — intermediate overflow is
	* irrelevant — so one call can free space and add new entries together.
	* All-or-nothing: a malformed op, a non-matching op, or an over-budget
	* final state writes nothing and reports live state.
	* @param target - which store the batch acts on.
	* @param operations - the ordered batch.
	* @returns the batch result.
	*/
	async applyBatch(target, operations) {
		if (operations.length === 0) return {
			success: false,
			error: "operations list is empty."
		};
		for (const [i, op] of operations.entries()) if ((op.action === "add" || op.action === "replace") && op.content !== void 0 && op.content.length > 0) {
			const scanError = firstThreatMessage(op.content, "strict");
			if (scanError !== void 0) return {
				success: false,
				error: `Operation ${i + 1}: ${scanError}`
			};
		}
		return this.withLock(target, async () => {
			const refusal = await this.reloadGuarded(target);
			if (refusal !== void 0) return refusal;
			const working = [...this.entries[target]];
			const appliedOperations = /* @__PURE__ */ new Set();
			for (const [i, op] of operations.entries()) {
				const content = (op.content ?? "").trim();
				const oldText = (op.old_text ?? "").trim();
				const pos = `Operation ${i + 1} (${op.action ?? "unknown"})`;
				if (op.action === "add") {
					if (content.length === 0) return this.batchError(target, `${pos}: content is required.`);
					if (working.some((entry) => stripTimestamp$1(entry) === content)) continue;
					if (findSemanticOverlap(working, content) !== void 0) return this.batchError(target, `${pos}: content semantically overlaps an existing memory; use replace to merge or update it.`);
					working.push(content);
				} else if (op.action === "replace") {
					if (oldText.length === 0) return this.batchError(target, `${pos}: old_text is required.`);
					if (content.length === 0) return this.batchError(target, `${pos}: content is required (use action='remove' to delete).`);
					const match = findUniqueMatch(working, oldText);
					if (match === void 0) {
						const signature = `replace\u0000${oldText}\u0000${content}`;
						if (appliedOperations.has(signature)) continue;
						return this.batchError(target, `${pos}: no entry matched '${oldText}'.`);
					}
					if (match === "ambiguous") return this.batchError(target, `${pos}: '${oldText}' matched multiple distinct entries -- be more specific.`);
					working[match] = content;
					appliedOperations.add(`replace\u0000${oldText}\u0000${content}`);
				} else if (op.action === "remove") {
					if (oldText.length === 0) return this.batchError(target, `${pos}: old_text is required.`);
					const match = findUniqueMatch(working, oldText);
					if (match === void 0) return this.batchError(target, `${pos}: no entry matched '${oldText}'.`);
					if (match === "ambiguous") return this.batchError(target, `${pos}: '${oldText}' matched multiple distinct entries -- be more specific.`);
					working.splice(match, 1);
				} else return this.batchError(target, `${pos}: unknown action. Use add, replace, or remove.`);
			}
			const newTotal = working.length > 0 ? working.join(ENTRY_DELIMITER).length : 0;
			if (newTotal > this.charLimit(target)) {
				const current = this.charCount(target);
				return this.consolidationFailure({
					success: false,
					error: `After applying all ${operations.length} operations, memory would be at ${grouped(newTotal)}/${grouped(this.charLimit(target))} chars -- over the limit. Remove or shorten more entries in the same batch (see current_entries below), then retry.`,
					current_entries: this.entries[target],
					usage: `${grouped(current)}/${grouped(this.charLimit(target))}`
				});
			}
			const previousTimestamps = this.timestamps[target];
			const now = (/* @__PURE__ */ new Date()).toISOString();
			this.entries[target] = working;
			this.timestamps[target] = new Map(working.map((entry) => {
				const content = stripTimestamp$1(entry);
				return [content, previousTimestamps.get(content) ?? now];
			}));
			await this.saveToDisk(target);
			return this.successResponse(target, `Applied ${operations.length} operation(s).`);
		});
	}
	/** Absolute path of one target's plaintext entry file. */
	pathFor(target) {
		return join(this.dir, target === "user" ? "USER.md" : "MEMORY.md");
	}
	/** Absolute path of one target's private timestamp sidecar. */
	metadataPathFor(target) {
		return join(this.dir, target === "user" ? ".USER.meta.json" : ".MEMORY.meta.json");
	}
	/** Load valid sidecar timestamps and fall back to the plaintext file mtime for legacy entries. */
	async loadMetadata(target) {
		new Set(this.entries[target].map(stripTimestamp$1));
		const timestamps = /* @__PURE__ */ new Map();
		try {
			const raw = await readFile(this.metadataPathFor(target), "utf8");
			const parsed = JSON.parse(raw);
			if (parsed.version === 1 && Array.isArray(parsed.entries) && parsed.entries.length === this.entries[target].length) {
				const metadata = parsed.entries;
				if (metadata.every((entry, index) => {
					const timestamp = entry.timestamp;
					return entry.content === stripTimestamp$1(this.entries[target][index]) && typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp));
				})) for (const entry of metadata) timestamps.set(entry.content, entry.timestamp);
			}
		} catch {}
		let fallback = "";
		try {
			fallback = (await stat(this.pathFor(target))).mtime.toISOString();
		} catch {}
		for (const entry of this.entries[target]) {
			const content = stripTimestamp$1(entry);
			if (!timestamps.has(content)) timestamps.set(content, extractTimestamp(entry) ?? fallback);
		}
		this.timestamps[target] = timestamps;
	}
	charLimit(target) {
		return target === "user" ? this.userCharLimit : this.memoryCharLimit;
	}
	charCount(target) {
		const entries = this.entries[target];
		return entries.length === 0 ? 0 : entries.join(ENTRY_DELIMITER).length;
	}
	/**
	* Count an at-capacity consolidation failure and degrade gracefully: under
	* the per-turn cap the response passes through unchanged (it tells the
	* model how to self-correct), at the cap a terminal result replaces it so
	* a failed memory side effect never blocks the turn's reply.
	*/
	consolidationFailure(response) {
		this.consolidationFailures += 1;
		if (this.consolidationFailures <= MAX_CONSOLIDATION_FAILURES_PER_TURN) return response;
		return {
			success: false,
			done: true,
			error: `Memory consolidation failed ${this.consolidationFailures} times this turn. Stop retrying memory calls — leave memory unchanged for now and continue with your reply to the user. The fact can be saved in a later turn.`
		};
	}
	/** Batch-abort error reporting live (uncommitted) state. */
	batchError(target, message) {
		return this.consolidationFailure({
			success: false,
			error: `${message} No operations were applied (batch is all-or-nothing).`,
			current_entries: this.entries[target].map(stripTimestamp$1),
			usage: `${grouped(this.charCount(target))}/${grouped(this.charLimit(target))}`
		});
	}
	/**
	* Reload one target under the lock with drift protection. A write
	* operation may not proceed on an unreadable or externally changed file;
	* the refusal result is returned to the caller in that case.
	* @param target - which store to re-read.
	* @returns the refusal result, or `undefined` when the reload is clean.
	*/
	async reloadGuarded(target) {
		const reload = await this.reloadTarget(target);
		if (reload.kind === "read-failed") return readFailedError(this.pathFor(target));
		if (reload.kind === "drift") return driftError(this.pathFor(target), reload.backup);
	}
	/**
	* Resolve `oldText` against the live entries: a unique match returns its
	* index; a missing or ambiguous match returns the operator-facing error
	* (missing matches count toward the per-turn consolidation budget).
	* @param entries - the live entry list to search.
	* @param trimmedOld - the trimmed substring identifying the entry.
	* @param verb - the action word for the no-match retry guidance.
	* @returns the matched index, or the refusal result.
	*/
	matchOrError(entries, trimmedOld, verb) {
		const match = findUniqueMatch(entries, trimmedOld);
		if (match === void 0) return this.consolidationFailure({
			success: false,
			error: `No entry matched '${trimmedOld}'. Check current_entries below and retry with the exact text of the entry you want to ${verb}.`,
			current_entries: entries.map(stripTimestamp$1)
		});
		if (match === "ambiguous") return {
			success: false,
			error: `Multiple entries matched '${trimmedOld}'. Be more specific.`,
			matches: previews(entries.filter((entry) => entry.includes(trimmedOld)))
		};
		return match;
	}
	/**
	* Success responses are intentionally TERMINAL: they confirm the write
	* landed and tell the model to stop, without echoing the entry list —
	* dumping it invites redundant re-issues. Entries only appear on the
	* error/over-budget paths where the model genuinely needs them.
	*/
	successResponse(target, message) {
		this.consolidationFailures = 0;
		const entries = this.entries[target];
		const current = this.charCount(target);
		const limit = this.charLimit(target);
		return {
			success: true,
			done: true,
			target,
			usage: `${limit > 0 ? Math.min(100, Math.trunc(current / limit * 100)) : 0}% — ${grouped(current)}/${grouped(limit)} chars`,
			entry_count: entries.length,
			message,
			note: "Write saved. This update is complete — do not repeat it."
		};
	}
	/** Render a system-prompt block with header and usage indicator. */
	renderBlock(target, entries) {
		if (entries.length === 0) return "";
		const limit = this.charLimit(target);
		const content = entries.map(stripTimestamp$1).join(ENTRY_DELIMITER);
		const current = content.length;
		const pct = limit > 0 ? Math.min(100, Math.trunc(current / limit * 100)) : 0;
		const header = `${MEMORY_BLOCK_HEADERS[target]} [${pct}% — ${grouped(current)}/${grouped(limit)} chars]`;
		const separator = "═".repeat(46);
		return `${separator}\n${header}\n${separator}\n${content}`;
	}
	/**
	* Read one memory file's raw text, distinguishing unreadable from empty:
	* an absent file is a clean empty read, an exists-but-unreadable file
	* (I/O error or invalid UTF-8) is `READ_FAILED`. Read-modify-write callers
	* must treat the latter as abort, not as an empty store — persisting over
	* it would wipe the on-disk memory.
	*/
	async readRawChecked(path) {
		let raw;
		try {
			raw = await readFile(path, "utf-8");
		} catch (error) {
			if (error.code === "ENOENT") return { raw: "" };
			return READ_FAILED;
		}
		return { raw: raw.startsWith("﻿") ? raw.slice(1) : raw };
	}
	/** Split raw file text into stripped, non-empty entries. */
	parseEntries(raw) {
		if (raw.trim().length === 0) return [];
		return raw.split(ENTRY_DELIMITER).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
	}
	/** Read-only parse for {@link loadFromDisk}: a failed read degrades to []. */
	async readFile(path) {
		const read = await this.readRawChecked(path);
		return read === READ_FAILED ? [] : this.parseEntries(read.raw);
	}
	/**
	* Re-read entries from disk into live state under the file lock. Drift
	* detection and entry parsing operate on the SAME raw snapshot so a
	* read failure between the two cannot let a mutation proceed from a stale
	* view.
	* @param target - which store to reload.
	* @param options - `skipDrift` bypasses the round-trip / entry-size check;
	* used by append-only callers where existing content is never clobbered.
	* @returns clean, drift (with backup path), or read-failed.
	*/
	async reloadTarget(target, options) {
		const path = this.pathFor(target);
		const read = await this.readRawChecked(path);
		if (read === READ_FAILED) return { kind: "read-failed" };
		const backup = options?.skipDrift === true ? void 0 : await this.detectExternalDrift(target, read.raw);
		this.entries[target] = dedupe(this.parseEntries(read.raw));
		await this.loadMetadata(target);
		return backup === void 0 ? { kind: "clean" } : {
			kind: "drift",
			backup
		};
	}
	/**
	* Detect external drift on the raw snapshot and back the file up when
	* found. Drift is either a round-trip mismatch (re-parse + re-serialize
	* reproduces different text) or an entry larger than the whole-file limit
	* (no tool-written entry can exceed the store's budget, so one signals a
	* free-form external append that flushing would discard).
	* @param target - which store's file to check.
	* @param raw - the file content already read by the caller's checked read.
	* @returns the backup path (or backup-failure marker), `undefined` when clean.
	*/
	async detectExternalDrift(target, raw) {
		if (raw.trim().length === 0) return void 0;
		const parsed = raw.split(ENTRY_DELIMITER).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
		const roundtrip = parsed.join(ENTRY_DELIMITER);
		const maxEntryLength = parsed.reduce((max, entry) => Math.max(max, entry.length), 0);
		if (!(raw.trim() !== roundtrip || maxEntryLength > this.charLimit(target))) return void 0;
		const backupPath = `${this.pathFor(target)}.bak.${Math.trunc(Date.now() / 1e3)}`;
		try {
			await writeFile(backupPath, raw, { mode: FILE_MODE$2 });
		} catch {
			return `${backupPath} (BACKUP FAILED — file unchanged on disk)`;
		}
		return backupPath;
	}
	/** Persist plaintext entries, then their recoverable private timestamp sidecar. */
	async saveToDisk(target) {
		const entries = this.entries[target].map(stripTimestamp$1);
		const content = entries.length > 0 ? entries.join(ENTRY_DELIMITER) : "";
		await writeFileAtomic(this.pathFor(target), content, {
			mode: FILE_MODE$2,
			dirMode: DIR_MODE$2
		});
		const metadata = {
			version: 1,
			entries: entries.map((entry) => ({
				content: entry,
				timestamp: this.timestamps[target].get(entry) ?? (/* @__PURE__ */ new Date()).toISOString()
			}))
		};
		await writeFileAtomic(this.metadataPathFor(target), `${JSON.stringify(metadata)}\n`, {
			mode: FILE_MODE$2,
			dirMode: DIR_MODE$2
		});
	}
	/** Serialize a read-modify-write cycle through the per-file lock. */
	async withLock(target, operation) {
		const path = this.pathFor(target);
		await mkdirp(dirname(path));
		return withFileLock(path, operation);
	}
};
/** `mkdir -p`: recursive mode is idempotent. */
async function mkdirp(dir) {
	await mkdir(dir, {
		recursive: true,
		mode: DIR_MODE$2
	});
}
/** Order-preserving dedupe keeping the first occurrence. */
function dedupe(entries) {
	return [...new Set(entries)];
}
/** Truncated one-line previews of entries for ambiguity feedback. */
function previews(entries, width = 80) {
	return entries.map((entry) => entry.length > width ? `${entry.slice(0, width)}...` : entry);
}
/**
* Locate the unique entry index containing `oldText`; identical duplicates
* collapse to the first match, distinct matches are ambiguous.
* Matches against the stripped content (without timestamp prefix) so the
* model can refer to entries by their visible text.
* @param entries - the live entry list (may include timestamp prefixes).
* @param oldText - the substring to match.
* @returns the unique index, `'ambiguous'`, or `undefined` for no match.
*/
function findUniqueMatch(entries, oldText) {
	const matches = findAllMatches(entries, oldText);
	if (matches.length === 0) return void 0;
	if (new Set(matches.map((index) => stripTimestamp$1(entries[index] ?? ""))).size > 1) return "ambiguous";
	return matches[0];
}
/** Return every entry index whose visible content contains `oldText`. */
function findAllMatches(entries, oldText) {
	return entries.flatMap((entry, index) => stripTimestamp$1(entry).includes(oldText) ? [index] : []);
}
/** Drift-refusal result pointing the operator at the backup snapshot. */
function driftError(path, backup) {
	return {
		success: false,
		error: `Refusing to write ${basename(path)}: file on disk has content that wouldn't round-trip through the memory tool (likely added by the patch tool, a shell append, a manual edit, or a concurrent session). A snapshot was saved to ${backup}. Resolve the drift first — either rewrite the file as a clean §-delimited list of entries, or move the extra content out — then retry. This guard exists to prevent silent data loss.`,
		drift_backup: backup,
		remediation: "Open the .bak file, integrate the missing entries into the memory tool one at a time via memory(action=add, content=...), then remove or rewrite the original file to a clean state."
	};
}
/** Refusal for an exists-but-unreadable file: never treat unreadable as empty. */
function readFailedError(path) {
	return {
		success: false,
		error: `Refusing to write ${basename(path)}: the file exists on disk but could not be read right now (temporarily locked by another program, a permission change, invalid/corrupt text encoding, or a filesystem error). Treating an unreadable file as empty and saving would wipe existing memory, so the write is refused. Nothing was changed — retry in a moment.`
	};
}
/**
* Identify a near-duplicate entry before it becomes separately persisted memory.
* Exact duplicate detection remains separate; this conservative lexical check
* catches rewrites that preserve most meaningful Chinese or Latin word fragments.
*/
function findSemanticOverlap(entries, candidate) {
	const candidateFragments = semanticFragments(candidate);
	if (candidateFragments.size < 3) return void 0;
	for (const entry of entries) {
		const existing = stripTimestamp$1(entry);
		const existingFragments = semanticFragments(existing);
		const shared = [...candidateFragments].filter((fragment) => existingFragments.has(fragment)).length;
		const similarity = shared / Math.min(candidateFragments.size, existingFragments.size);
		if (shared >= 5 && similarity >= .55) return existing;
	}
}
/** Build normalized CJK bigrams and Latin words for near-duplicate matching. */
function semanticFragments(value) {
	const normalized = value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
	const fragments = /* @__PURE__ */ new Set();
	for (let i = 0; i < normalized.length - 1; i += 1) {
		const pair = normalized.slice(i, i + 2);
		if (/^[\p{Script=Han}]{2}$/u.test(pair)) fragments.add(pair);
	}
	for (const word of value.toLowerCase().matchAll(/[a-z0-9]{3,}/g)) fragments.add(word[0]);
	return fragments;
}
/** Replace threat-matching entries with placeholders for the snapshot only. */
function sanitizeForSnapshot(entries, filename) {
	return entries.map((entry) => {
		if (entry.length === 0 || entry.startsWith("[BLOCKED:")) return entry;
		const findings = scanForThreats(entry, "strict");
		if (findings.length === 0) return entry;
		return `[BLOCKED: ${filename} entry contained threat pattern(s): ${findings.join(", ")}. Removed from system prompt; use memory(action=remove) to delete the original.]`;
	});
}
/** Timestamp prefix regex: `[ISO-timestamp] ` at the start of an entry. */
const TIMESTAMP_RE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\s*/;
/**
* Extract the ISO timestamp from an entry's timestamp prefix, if present.
* @param content - the raw entry content (may start with a timestamp).
* @returns the ISO timestamp string, or undefined.
*/
function extractTimestamp(content) {
	return content.match(TIMESTAMP_RE)?.[1];
}
/**
* Strip the timestamp prefix from an entry, if present.
* @param content - the raw entry content.
* @returns the entry content without the timestamp prefix.
*/
function stripTimestamp$1(content) {
	return content.replace(TIMESTAMP_RE, "");
}
//#endregion
//#region src/review-notices.ts
/** Durable background-review history outside the official session log. */
const DIR_MODE$1 = 448;
const FILE_MODE$1 = 384;
/**
* Persists bounded review history per session. It is deliberately a plugin
* sidecar rather than an official Session event, because external plugins lack
* the public API required to safely append an ignorable unknown event.
*/
var MemoryReviewNotices = class {
	path;
	/** @param dir - directory holding the review-history file. */
	constructor(dir = dshHomePath("memories")) {
		this.path = join(dir, ".review-notices.json");
	}
	/** Append a completed review record for one source session. */
	async publish(notice) {
		const history = await this.read();
		const records = history[notice.sessionId] ?? [];
		history[notice.sessionId] = [...records, {
			...notice,
			completedAt: (/* @__PURE__ */ new Date()).toISOString()
		}].slice(-50);
		await this.write(history);
	}
	/** Return the full persisted review history for one source session. */
	async list(sessionId) {
		return (await this.read())[sessionId] ?? [];
	}
	/** Delete a disposed session's review history. */
	async discard(sessionId) {
		const history = await this.read();
		if (history[sessionId] === void 0) return;
		delete history[sessionId];
		await this.write(history);
	}
	async read() {
		try {
			const parsed = JSON.parse(await readFile(this.path, "utf8"));
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
			const records = {};
			for (const [sessionId, value] of Object.entries(parsed)) if (Array.isArray(value)) records[sessionId] = value;
			else if (value !== null && typeof value === "object") records[sessionId] = [{
				...value,
				completedAt: ""
			}];
			return records;
		} catch {
			return {};
		}
	}
	async write(history) {
		await mkdir(dirname(this.path), {
			recursive: true,
			mode: DIR_MODE$1
		});
		await writeFileAtomic(this.path, JSON.stringify(history), {
			mode: FILE_MODE$1,
			dirMode: DIR_MODE$1
		});
	}
};
/** Shared review-history store for the memory preset and host HTTP route. */
const memoryReviewNotices = new MemoryReviewNotices();
//#endregion
//#region src/review-progress.ts
/** Durable review-cycle progress for the browser memory indicator. */
const DIR_MODE = 448;
const FILE_MODE = 384;
/**
* Turns still needed before the next armed review, given how many completed
* user turns already count toward the current cycle.
* @param countedTurns - completed user turns already folded into this cycle.
* @param nudgeInterval - configured cycle length; 0 disables reviews.
* @param reviewEnabled - master switch for the background review.
* @returns remaining turns, or 0 when reviews are off.
*/
function remainingTurnsUntilReview(countedTurns, nudgeInterval, reviewEnabled) {
	if (!reviewEnabled || nudgeInterval <= 0) return 0;
	return nudgeInterval - countedTurns % nudgeInterval;
}
/** Persist the latest countdown for each session outside the official session log. */
var MemoryReviewProgressStore = class {
	bySession = /* @__PURE__ */ new Map();
	path;
	/** @param dir - directory holding the progress receipt. */
	constructor(dir = dshHomePath("memories")) {
		this.path = join(dir, ".review-progress.json");
	}
	/** Store a countdown in memory and on disk. */
	async publish(sessionId, progress) {
		this.bySession.set(sessionId, progress);
		const values = await this.read();
		values[sessionId] = progress;
		await this.write(values);
	}
	/** Read the current or prior-process countdown. */
	async get(sessionId) {
		return this.bySession.get(sessionId) ?? (await this.read())[sessionId];
	}
	/** Remove a disposed session's receipt. */
	async discard(sessionId) {
		this.bySession.delete(sessionId);
		const values = await this.read();
		if (values[sessionId] === void 0) return;
		delete values[sessionId];
		await this.write(values);
	}
	async read() {
		try {
			const parsed = JSON.parse(await readFile(this.path, "utf8"));
			return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}
	async write(values) {
		await mkdir(dirname(this.path), {
			recursive: true,
			mode: DIR_MODE
		});
		await writeFileAtomic(this.path, JSON.stringify(values), {
			mode: FILE_MODE,
			dirMode: DIR_MODE
		});
	}
};
/** Shared across the preset and host settings plugin in this DSH process. */
const memoryReviewProgress = new MemoryReviewProgressStore();
//#endregion
//#region src/schema.ts
/** Model-facing description of the memory tool (single source for both the
* registry registration and the review fork's tool schema). */
const MEMORY_TOOL_DESCRIPTION = "Save durable facts to persistent memory that survive across sessions. Memory is injected into every future turn, so keep entries compact and high-signal.\n\nHOW: make ALL your changes in ONE call via an 'operations' array (each item: {action, content?, old_text?}). The batch applies atomically and the char limit is checked only on the FINAL result — so a single call can remove/replace stale entries to free room AND add new ones, even when an add alone would overflow. The response reports current/limit chars and confirms completion; one batch call finishes the update, so don't repeat it. Use the bare action/content/old_text fields only for a single lone change.\n\nIMPORTANT: To UPDATE an existing entry, use action=\"replace\" with old_text and content in the SAME call. old_text must be a unique substring of exactly one current entry; use the distinctive full entry text shown in current_entries, never text spanning the § separator. Do NOT use remove+add as two separate calls — replace does both atomically. Do not use filesystem, shell, or edit tools to modify MEMORY.md or USER.md; all memory writes MUST go through this memory tool.\n\nWHEN: save proactively when the user states a preference, correction, or personal detail, or you learn a stable fact about their environment, conventions, or workflow. Priority: user preferences & corrections > environment facts > procedures. The best memory stops the user repeating themselves.\n\nIF FULL: an add is rejected with the current entries shown. Reissue as ONE batch that removes or shortens enough stale entries and adds the new one together.\n\nTARGETS: 'user' stores stable personal facts; choose the target by the fact type. Use target=\"user\" ONLY for stable personal facts about the user: name, location, age, identity, education, employer, role, personal preferences, or communication style. Use target=\"memory\" for project and environment facts: repositories, code conventions, product details, workflows, tool behavior, technical rules, and instructions about how this project should be operated. Never put project rules or API debugging facts in USER.md. Never put a personal profile fact in MEMORY.md.\n\nSKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task progress, completed-work logs, temporary TODO state. Reusable procedures belong in a skill, not memory.";
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
const MEMORY_REVIEW_PROMPT = "Review the conversation above and consider saving a durable fact if appropriate.\n\nClassify every candidate before writing it:\n1. Use target=\"user\" ONLY for stable facts about the person: name, location, age, identity, education, employer, role, personal preferences, or communication style.\n2. Use target=\"memory\" for project and environment facts: repositories, code conventions, product details, workflows, tool behavior, technical rules, and instructions about how the project should be operated.\n3. Project/API debugging facts and implementation requirements MUST use target=\"memory\"; they do not belong in USER.md. Personal profile facts MUST use target=\"user\".\n\nBefore every write, inspect the current entries and consolidate them: do not add a fact that is duplicated, semantically overlapping, or better represented by replacing, merging, shortening, or removing existing entries. Keep only stable, reusable facts and conventions; remove obsolete, redundant, and timeline-style details when a single compact entry preserves the useful fact. If nothing is worth saving after this review, just say 'Nothing to save.' and stop.\n\nYou can only call the memory tool. Other tools will be denied at runtime — do not attempt them.";
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
	const changes = [];
	for (let iteration = 1; iteration <= maxIterations; iteration++) {
		if (signal.aborted) return {
			iterations: iteration - 1,
			saved,
			changes,
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
				changes,
				reason: "failed"
			};
		}
		const finish = assembler.finish;
		if (finish.kind === "aborted" || finish.kind === "error") return {
			iterations: iteration,
			saved,
			changes,
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
			changes,
			reason: "finished"
		};
		for (const call of toolCalls) {
			const result = await executeReviewToolCall(store, call.id, call.name, call.arguments);
			if (result.saved) {
				saved += 1;
				changes.push(...result.changes);
			}
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
		changes,
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
		saved: false,
		changes: []
	};
	let args;
	try {
		args = JSON.parse(rawArguments);
	} catch {
		return {
			text: "Invalid tool arguments: not valid JSON.",
			isError: true,
			saved: false,
			changes: []
		};
	}
	if (args === null || typeof args !== "object" || Array.isArray(args)) return {
		text: "Invalid tool arguments: expected an object.",
		isError: true,
		saved: false,
		changes: []
	};
	const parsed = toMemoryToolArgs(args);
	const before = [...store.entriesFor(parsed.target)];
	const result = await dispatchMemoryTool(store, parsed);
	const after = store.entriesFor(parsed.target);
	const changes = result.success ? committedChanges(parsed.target, before, after) : [];
	return {
		text: JSON.stringify(result),
		isError: !result.success,
		saved: changes.length > 0,
		changes
	};
}
/** Internal timestamps distinguish revisions but never belong in user-visible receipts. */
const TIMESTAMP_PREFIX = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]\s*/;
/** Compare two committed store states without exposing model-proposed arguments. */
function committedChanges(target, before, after) {
	const beforeByContent = new Map(before.map((entry) => [stripTimestamp(entry), entry]));
	const afterByContent = new Map(after.map((entry) => [stripTimestamp(entry), entry]));
	return [...[...beforeByContent.keys()].filter((content) => !afterByContent.has(content)).map((content) => ({
		target,
		action: "removed",
		content
	})), ...[...afterByContent.keys()].filter((content) => !beforeByContent.has(content)).map((content) => ({
		target,
		action: "added",
		content
	}))];
}
/** Remove store-private timestamp metadata from a committed entry receipt. */
function stripTimestamp(entry) {
	return entry.replace(TIMESTAMP_PREFIX, "");
}
//#endregion
//#region src/index.ts
/** Cordis plugin name. */
const name = "memory";
/** Services required before activation. */
const inject = [
	"tools",
	"llm",
	"agents",
	"systemPrompt"
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
function isCountedUserMessage(event) {
	return event.type === "user/message" && event.data.source.kind === "user";
}
/** Count completed main-session user turns already present in a restored log. */
function priorCompletedUserTurns(session) {
	let pendingUserTurn = false;
	let count = 0;
	for (const event of session.events) {
		if (isCountedUserMessage(event)) pendingUserTurn = true;
		if (event.type !== "turn/end") continue;
		if (pendingUserTurn && event.data.reason.kind === "completed") count += 1;
		pendingUserTurn = false;
	}
	return count;
}
/** True when a counted user message is still waiting for its `turn/end`. */
function hasPendingCountedUserTurn(session) {
	let pendingUserTurn = false;
	for (const event of session.events) {
		if (isCountedUserMessage(event)) pendingUserTurn = true;
		if (event.type === "turn/end") pendingUserTurn = false;
	}
	return pendingUserTurn;
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
	ctx.systemPrompt.section({
		name: "memory:snapshot",
		order: -50,
		text: () => store.renderContextBlock()
	});
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
	ctx.on("session/created", (session) => {
		store.refreshSnapshot();
		seedReviewProgress(session);
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
			if (agent.session.surface.nodes.some((seq) => {
				const event = agent.session.events[seq];
				if (event?.type !== "user/message") return false;
				const message = event.data;
				return message.source?.kind === "plugin" && message.source?.plugin === "memory";
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
				pendingUserTurn: false,
				reviewPending: false
			};
			states.set(id, state);
		}
		return state;
	}
	/** Publish the current countdown for the browser-only memory indicator. */
	function publishReviewProgress(sessionId, state, nudgeInterval, reviewEnabled) {
		memoryReviewProgress.publish(String(sessionId), {
			reviewEnabled,
			remainingTurns: remainingTurnsUntilReview(state.turnsSinceMemory, nudgeInterval, reviewEnabled)
		});
	}
	/**
	* Seed the durable countdown as soon as a session is live so a browser
	* refresh during the first unfinished turn still has a value to show.
	* @param session - live session to publish for.
	*/
	function seedReviewProgress(session) {
		if ((session.header.delegationDepth ?? 0) > 0) return;
		const { nudgeInterval, reviewEnabled } = effectiveSettings();
		const state = stateFor(session.id);
		if (!state.hydrated) {
			const completed = priorCompletedUserTurns(session);
			state.turnsSinceMemory = nudgeInterval > 0 && completed > 0 ? completed % nudgeInterval : 0;
			state.pendingUserTurn = hasPendingCountedUserTurn(session);
			state.hydrated = true;
		}
		publishReviewProgress(session.id, state, nudgeInterval, reviewEnabled);
	}
	const sessions = ctx.get("sessions");
	if (sessions !== void 0) for (const session of sessions.list()) seedReviewProgress(session);
	/** Count only completed main-session user turns and arm review on the configured interval. */
	ctx.on("session/event", (session, event) => {
		if ((session.header.delegationDepth ?? 0) > 0) return;
		if (event.type === "turn/start") {
			store.resetConsolidationFailures();
			return;
		}
		if (isCountedUserMessage(event)) {
			const state = stateFor(session.id);
			state.pendingUserTurn = true;
			return;
		}
		if (event.type !== "turn/end") return;
		const state = states.get(session.id);
		if (state === void 0 || !state.pendingUserTurn) return;
		state.pendingUserTurn = false;
		if (event.data.reason.kind !== "completed") return;
		const { nudgeInterval, reviewEnabled } = effectiveSettings();
		if (!state.hydrated) {
			state.hydrated = true;
			const prior = priorCompletedUserTurns(session) - 1;
			state.turnsSinceMemory = nudgeInterval > 0 && prior > 0 ? prior % nudgeInterval : 0;
		}
		if (!reviewEnabled || nudgeInterval === 0) {
			publishReviewProgress(session.id, state, nudgeInterval, reviewEnabled);
			return;
		}
		state.turnsSinceMemory += 1;
		if (state.turnsSinceMemory < nudgeInterval) {
			publishReviewProgress(session.id, state, nudgeInterval, reviewEnabled);
			return;
		}
		state.turnsSinceMemory = 0;
		state.reviewPending = true;
		publishReviewProgress(session.id, state, nudgeInterval, reviewEnabled);
		if (!state.reviewPending) return;
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
		}).then((outcome) => {
			const update = {
				sessionId: String(session.id),
				saved: outcome.saved,
				changes: outcome.changes,
				reason: outcome.reason
			};
			return memoryReviewNotices.publish(update);
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
		memoryReviewNotices.discard(String(session.id));
		memoryReviewProgress.discard(String(session.id));
	});
}
//#endregion
export { DEFAULT_USER_CHAR_LIMIT as a, name as c, memoryReviewNotices as d, MemoryStore as f, DEFAULT_REVIEW_MAX_ITERATIONS as i, memoryReviewProgress as l, DEFAULT_MEMORY_CHAR_LIMIT as n, apply as o, DEFAULT_NUDGE_INTERVAL as r, inject as s, Config as t, remainingTurnsUntilReview as u };

//# sourceMappingURL=src-BPklm9EU.js.map