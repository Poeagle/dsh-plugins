import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const FILE_MODE = 384;
const DIR_MODE = 448;
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
	* @param target - which store to read.
	* @returns the live entry list.
	*/
	entriesFor(target) {
		return this.entries[target];
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
			if (entries.includes(trimmed)) return this.successResponse(target, "Entry already exists (no duplicate added).");
			if ([...entries, trimmed].join("\n§\n").length > this.charLimit(target)) {
				const current = this.charCount(target);
				return this.consolidationFailure({
					success: false,
					error: `Memory at ${grouped(current)}/${grouped(this.charLimit(target))} chars. Adding this entry (${trimmed.length} chars) would exceed the limit. Consolidate now: use 'replace' to merge overlapping entries into shorter ones or 'remove' stale or less important entries (see current_entries below), then retry this add — all in this turn.`,
					current_entries: entries,
					usage: `${grouped(current)}/${grouped(this.charLimit(target))}`
				});
			}
			entries.push(trimmed);
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
					current_entries: entries,
					usage: `${grouped(current)}/${grouped(this.charLimit(target))}`
				});
			}
			entries[match] = trimmedNew;
			await this.saveToDisk(target);
			return this.successResponse(target, "Entry replaced.");
		});
	}
	/**
	* Remove the entry containing `oldText`.
	* @param target - which store holds the entry.
	* @param oldText - substring identifying the entry to remove; must match exactly one.
	* @returns the write outcome.
	*/
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
			entries.splice(match, 1);
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
			for (const [i, op] of operations.entries()) {
				const content = (op.content ?? "").trim();
				const oldText = (op.old_text ?? "").trim();
				const pos = `Operation ${i + 1} (${op.action ?? "unknown"})`;
				if (op.action === "add") {
					if (content.length === 0) return this.batchError(target, `${pos}: content is required.`);
					if (working.includes(content)) continue;
					working.push(content);
				} else if (op.action === "replace") {
					if (oldText.length === 0) return this.batchError(target, `${pos}: old_text is required.`);
					if (content.length === 0) return this.batchError(target, `${pos}: content is required (use action='remove' to delete).`);
					const match = findUniqueMatch(working, oldText);
					if (match === void 0) return this.batchError(target, `${pos}: no entry matched '${oldText}'.`);
					if (match === "ambiguous") return this.batchError(target, `${pos}: '${oldText}' matched multiple distinct entries -- be more specific.`);
					working[match] = content;
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
			this.entries[target] = working;
			await this.saveToDisk(target);
			return this.successResponse(target, `Applied ${operations.length} operation(s).`);
		});
	}
	/** Absolute path of one target's file. */
	pathFor(target) {
		return join(this.dir, target === "user" ? "USER.md" : "MEMORY.md");
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
			current_entries: this.entries[target],
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
			current_entries: entries
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
		const content = entries.join(ENTRY_DELIMITER);
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
			await writeFile(backupPath, raw, { mode: FILE_MODE });
		} catch {
			return `${backupPath} (BACKUP FAILED — file unchanged on disk)`;
		}
		return backupPath;
	}
	/** Persist live entries atomically (temp + rename, never truncate-before-lock). */
	async saveToDisk(target) {
		const content = this.entries[target].length > 0 ? this.entries[target].join(ENTRY_DELIMITER) : "";
		await writeFileAtomic(this.pathFor(target), content, {
			mode: FILE_MODE,
			dirMode: DIR_MODE
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
		mode: DIR_MODE
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
* @param entries - the live entry list.
* @param oldText - the substring to match.
* @returns the unique index, `'ambiguous'`, or `undefined` for no match.
*/
function findUniqueMatch(entries, oldText) {
	const matches = entries.map((entry, index) => ({
		entry,
		index
	})).filter(({ entry }) => entry.includes(oldText));
	if (matches.length === 0) return void 0;
	if (matches.length > 1 && new Set(matches.map(({ entry }) => entry)).size > 1) return "ambiguous";
	return matches[0]?.index;
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
/** Replace threat-matching entries with placeholders for the snapshot only. */
function sanitizeForSnapshot(entries, filename) {
	return entries.map((entry) => {
		if (entry.length === 0 || entry.startsWith("[BLOCKED:")) return entry;
		const findings = scanForThreats(entry, "strict");
		if (findings.length === 0) return entry;
		return `[BLOCKED: ${filename} entry contained threat pattern(s): ${findings.join(", ")}. Removed from system prompt; use memory(action=remove) to delete the original.]`;
	});
}
//#endregion
export { MemoryStore as t };

//# sourceMappingURL=store-CW83JWIg.js.map