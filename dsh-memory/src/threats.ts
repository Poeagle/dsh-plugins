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
export const MAX_SCAN_CHARS = 65_536

/**
 * Bounded filler between key attack words — enough for the intended
 * obfuscation bypasses ("ignore all prior instructions") without unbounded
 * regex backtracking.
 */
const FILLER = String.raw`(?:\w+\s+){0,8}`

/** Which pattern set one scan applies. */
export type ThreatScope = 'all' | 'context' | 'strict'

/** One table row: source regex, stable pattern id, originating scope. */
type PatternSpec = [pattern: string, pid: string, scope: ThreatScope]

/**
 * The pattern table. `scope` names where a pattern originates: `all` patterns
 * land in every set, `context` patterns land in context + strict, `strict`
 * patterns land in strict only.
 */
const PATTERNS: readonly PatternSpec[] = [
  // Classic prompt injection (applies everywhere).
  [String.raw`ignore\s+${FILLER}(previous|all|above|prior)\s+${FILLER}instructions`, 'prompt_injection', 'all'],
  [String.raw`system\s+prompt\s+override`, 'sys_prompt_override', 'all'],
  [String.raw`disregard\s+${FILLER}(your|all|any)\s+${FILLER}(instructions|rules|guidelines)`, 'disregard_rules', 'all'],
  [String.raw`act\s+as\s+(if|though)\s+${FILLER}you\s+${FILLER}(have\s+no|don't\s+have)\s+${FILLER}(restrictions|limits|rules)`, 'bypass_restrictions', 'all'],
  [String.raw`<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->`, 'html_comment_injection', 'all'],
  [String.raw`<\s*div\s+style\s*=\s*["'][^>]{0,2048}display\s*:\s*none`, 'hidden_div', 'all'],
  [String.raw`translate\s+[^\n]{0,512}\s+into\s+[^\n]{0,512}\s+and\s+(execute|run|eval)`, 'translate_execute', 'all'],
  [String.raw`do\s+not\s+${FILLER}tell\s+${FILLER}the\s+user`, 'deception_hide', 'all'],
  // Role-play / identity hijack (context + strict).
  [String.raw`you\s+are\s+${FILLER}now\s+(?:a|an|the)\s+`, 'role_hijack', 'context'],
  [String.raw`pretend\s+${FILLER}(you\s+are|to\s+be)\s+`, 'role_pretend', 'context'],
  [String.raw`output\s+${FILLER}(system|initial)\s+prompt`, 'leak_system_prompt', 'context'],
  [String.raw`(respond|answer|reply)\s+without\s+${FILLER}(restrictions|limitations|filters|safety)`, 'remove_filters', 'context'],
  [String.raw`you\s+have\s+been\s+${FILLER}(updated|upgraded|patched)\s+to`, 'fake_update', 'context'],
  [String.raw`\bname\s+yourself\s+\w+`, 'identity_override', 'context'],
  // C2 / promptware vocabulary.
  [String.raw`register\s+(as\s+)?a?\s*node`, 'c2_node_registration', 'context'],
  [String.raw`(heartbeat|beacon|check[\s-]?in)\s+(to|with)\s+`, 'c2_heartbeat', 'context'],
  [String.raw`pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b`, 'c2_task_pull', 'context'],
  [String.raw`connect\s+to\s+the\s+network\b`, 'c2_network_connect', 'context'],
  [String.raw`you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b`, 'forced_action', 'context'],
  [String.raw`only\s+use\s+one[\s-]?liners?\b`, 'anti_forensic_oneliner', 'context'],
  [String.raw`never\s+${FILLER}(?:create|write)\s+${FILLER}(?:script|file)\s+${FILLER}disk`, 'anti_forensic_disk', 'context'],
  [String.raw`unset\s+\w*(?:CLAUDE|CODEX|HERMES|DSH|AGENT|OPENAI|ANTHROPIC)\w*`, 'env_var_unset_agent', 'context'],
  // Known C2 / red-team framework brands.
  [String.raw`\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b`, 'known_c2_framework', 'context'],
  [String.raw`\bc2\s+(?:server|channel|infrastructure|beacon)\b`, 'c2_explicit', 'context'],
  [String.raw`\bcommand\s+and\s+control\b`, 'c2_explicit_long', 'context'],
  // Exfiltration via curl/wget/cat with secrets (applies everywhere).
  [String.raw`curl\s+[^\n]{0,2048}\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`, 'exfil_curl', 'all'],
  [String.raw`wget\s+[^\n]{0,2048}\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`, 'exfil_wget', 'all'],
  [String.raw`cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`, 'read_secrets', 'all'],
  // URL exfiltration and context dump (strict).
  [String.raw`(send|post|upload|transmit)\s+[^\n]{0,2048}\s+(to|at)\s+https?://`, 'send_to_url', 'strict'],
  [String.raw`(include|output|print|share)\s+${FILLER}(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)`, 'context_exfil', 'strict'],
  // Persistence / backdoor (strict).
  [String.raw`authorized_keys`, 'ssh_backdoor', 'strict'],
  [String.raw`\$HOME/\.ssh|~/\.ssh`, 'ssh_access', 'strict'],
  [String.raw`\$HOME/\.dsh/\.env|~/\.dsh/\.env`, 'dsh_env', 'strict'],
  [String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)`, 'agent_config_mod', 'strict'],
  [String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}\.dsh/(config\.yaml|SOUL\.md)`, 'dsh_config_mod', 'strict'],
  // Hardcoded secrets.
  [String.raw`(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}`, 'hardcoded_secret', 'strict'],
]

/**
 * Invisible / bidirectional unicode characters used in injection attacks —
 * zero-width joiners, directional overrides, and invisible math operators.
 */
export const INVISIBLE_CHARS: ReadonlySet<string> = new Set([
  '\u200b', // zero-width space
  '\u200c', // zero-width non-joiner
  '\u200d', // zero-width joiner
  '\u2060', // word joiner
  '\u2062', // invisible times
  '\u2063', // invisible separator
  '\u2064', // invisible plus
  '\ufeff', // zero-width no-break space (BOM)
  '\u202a', // left-to-right embedding
  '\u202b', // right-to-left embedding
  '\u202c', // pop directional formatting
  '\u202d', // left-to-right override
  '\u202e', // right-to-left override
  '\u2066', // left-to-right isolate
  '\u2067', // right-to-left isolate
  '\u2068', // first strong isolate
  '\u2069', // pop directional isolate
])

/** Compiled scope sets, indexed by scope name. */
const COMPILED: Record<ThreatScope, { pattern: RegExp; pid: string }[]> = {
  all: [],
  context: [],
  strict: [],
}

// Compile once at module load. Scope semantics: `all` patterns land in every
// set, `context` in context + strict, `strict` in strict only.
for (const [source, pid, scope] of PATTERNS) {
  const entry = { pattern: new RegExp(source, 'i'), pid }
  if (scope === 'all') {
    COMPILED.all.push(entry)
    COMPILED.context.push(entry)
    COMPILED.strict.push(entry)
  } else if (scope === 'context') {
    COMPILED.context.push(entry)
    COMPILED.strict.push(entry)
  } else {
    COMPILED.strict.push(entry)
  }
}

/**
 * Scan content for threat patterns at one scope.
 * @param content - the text to scan; empty strings produce no findings.
 * @param scope - which pattern set to apply (`all` narrow, `context` default
 * breadth, `strict` broadest).
 * @returns matched pattern ids; invisible unicode hits report as
 * `invisible_unicode_U+XXXX`.
 */
export function scanForThreats(content: string, scope: ThreatScope): string[] {
  if (content.length === 0) return []
  const findings: string[] = []
  const bounded = content.slice(0, MAX_SCAN_CHARS)
  // Invisible unicode — one pass over the distinct characters, on the RAW
  // content before normalization, which can strip some of these codepoints.
  const distinct = new Set(bounded)
  for (const char of distinct) {
    if (!INVISIBLE_CHARS.has(char)) continue
    const code = char.charCodeAt(0)
    findings.push(`invisible_unicode_U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
  }
  // NFKC folds full-width / compatibility variants to ASCII so homograph
  // substitution cannot bypass keyword checks. Cross-script confusables
  // (e.g. Cyrillic а) are not folded and remain out of scope.
  const normalized = bounded.normalize('NFKC')
  for (const { pattern, pid } of COMPILED[scope]) {
    if (pattern.test(normalized)) findings.push(pid)
  }
  return findings
}

/**
 * Human-readable error for the first threat found, or `undefined` when clean.
 * @param content - the text to scan.
 * @param scope - which pattern set to apply.
 * @returns the blocking message, or `undefined` for clean content.
 */
export function firstThreatMessage(content: string, scope: ThreatScope): string | undefined {
  const findings = scanForThreats(content, scope)
  const pid = findings[0]
  if (pid === undefined) return undefined
  if (pid.startsWith('invisible_unicode_')) {
    const codepoint = pid.slice('invisible_unicode_'.length)
    return `Blocked: content contains invisible unicode character ${codepoint} (possible injection).`
  }
  return (
    `Blocked: content matches threat pattern '${pid}'. `
    + 'Content is injected into the system prompt and must not contain '
    + 'injection or exfiltration payloads.'
  )
}
