# dsh-memory

English | [中文](README.zh.md)

Bounded curated memory: two character-capped stores persisted as `MEMORY.md` / `USER.md`, a frozen snapshot injected into the system prompt, threat-scanned writes, and a background review fork that may consolidate entries after completed turns.

This is a standalone profile plugin (same pattern as `dsh-cost-meter`), not an official repository package.

## Install and wire-up

The source lives outside the harness repo and is linked into a dsh profile with a `link:` dependency:

```json
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-memory": "link:/Users/ymchen/.dsh/profiles/plugins/dsh-memory"
  }
}
```

Then add one row to the preset composition that should carry memory:

```yaml
- id: memory
  name: 'dsh-memory'
```

Build and test locally:

```sh
npm install        # peers resolve from the profile at runtime; devDeps for build/test
npm run build      # tsc --noEmit && tsdown -> lib/index.js
npm test           # vitest unit tests
```

## Stores and persistence

The plugin mounts one shared `MemoryStore` at `MemoryStore.defaultDir()` — `$DSH_HOME/memories/` (falling back to `~/.dsh/memories`). The two targets map to files:

| Target | File | Default char limit |
|---|---|---|
| `memory` | `MEMORY.md` | 2200 |
| `user` | `USER.md` | 1375 |

Entries are delimited by `\n§\n` (`ENTRY_DELIMITER`), may be multiline, and are deduplicated at load and on every reload. All writes go through the atomic-write service under a lock; before a write the store reloads the file and refuses the operation when the file is unreadable (`read_failed`) or drifted from the in-memory state since the last read. A drifted file is backed up to `<file>.bak.<epoch>` instead of being overwritten.

Every entry is threat-scanned with the strict scope (prompt-injection markers, exfiltration URLs, suspicious commands) at snapshot-build time and on write; a hit refuses the write, and a poisoned-on-disk entry is replaced with a `[BLOCKED: …]` placeholder in the snapshot while the live entry list keeps the raw text.

## The memory tool

`dispatchMemoryTool` / `toMemoryToolArgs` (schema.ts) validate the model-facing arguments and route to the store:

- `add` — append one entry; exact duplicates succeed with `Entry already exists (no duplicate added).`
- `replace` — swap the uniquely matched entry; ambiguity is refused with previews of the matches.
- `remove` — delete the uniquely matched entry.
- `operations` — an all-or-nothing batch (`add` / `replace` / `remove` items); the char limit is checked only on the final state, so one call can free room and add in the same step.

Overflow and zero-match failures count toward a per-turn consolidation budget. The first three failures pass through with the self-correction guidance; the fourth returns the terminal result `{ success: false, done: true, error: "Memory consolidation failed …" }` so a stuck loop stops. Any success resets the counter, and every successful write ends with the note `Write saved. This update is complete — do not repeat it.`

## Frozen snapshot

`formatForSystemPrompt` returns the block captured at `loadFromDisk()` time, never live state. Mid-session writes hit disk but never the prompt; the new entries become visible on the next process/preset load. The section registers at `memory:snapshot` with `order: -50` so it precedes later prompt sections.

## Background review

On every user-source `user/message` (delegations excluded) a per-session counter increments; reaching `nudgeInterval` arms a pending review. Resumed sessions hydrate the counter from the prior user-turn count (`prior % interval`) at their first live user message. The armed review spawns when the next `turn/end` completes normally: `runMemoryReview` replays the whole session through the session's last routed request route, appends the review directive as one final user message, and loops with the memory-only tool until the model stops calling it or `reviewMaxIterations` is reached. One review per session runs at a time; session disposal aborts the fork and clears its state.

Config fields (validated, all overridable from cordis.yml):

| Field | Default | Bounds | Meaning |
|---|---|---|---|
| `memoryCharLimit` | 2200 | min 1 | `MEMORY.md` budget |
| `userCharLimit` | 1375 | min 1 | `USER.md` budget |
| `nudgeInterval` | 10 | min 0 | user turns between armed reviews; 0 disables reviews |
| `reviewMaxIterations` | 16 | min 1 | max model steps per review fork |
| `reviewEnabled` | true | — | master switch for the background review |

## Model Experience

### Frozen snapshot block

#### What the model sees

Each request whose preset mounts the plugin carries the load-time snapshot in the system prompt, one block per non-empty target. The header reports the frozen usage; entries are `§`-separated. An empty target renders nothing.

##### Memory snapshot block layout

```markdown
══════════════════════════════════════════════
MEMORY (your personal notes) [<pct>% — <current>/<limit> chars]
══════════════════════════════════════════════
<entry>
§
<entry>
```

#### Token effect

Fixed per-request cost bounded by the char limits (2200 + 1375 chars by default); usage strings inside the headers grow with the stores. Writes during a session do not change the block until the next load.

#### KV Cache effect

Stable repeated prefix within one process lifetime. A restart with different on-disk entries changes the block text and invalidates reuse from that system-prompt position onward; everything before it stays reusable.

### Memory tool result

#### What the model sees

Success ends with `note: "Write saved. This update is complete — do not repeat it."` and a `usage` string shaped `<pct>% — <current>/<limit> chars`. Duplicate adds return `Entry already exists (no duplicate added).` Consolidation failures carry the live `current_entries` for self-correction; the fourth consecutive failure in a turn returns `Memory consolidation failed <n> times this turn. Stop retrying memory calls — …`. Batch errors are prefixed `Operation <i> (<action>): …` and state that nothing was applied.

#### Token effect

Append-only; each call contributes its arguments plus a small result. Failure results embed the full current entry list, which is bounded by the store limits.

#### KV Cache effect

Append-only; new tool turns follow the reusable request prefix.

### Background review fork

#### What the model sees

An independent model request on the session's last route: the session replayed via `deriveMessages` with the review directive appended as one final user message, and only the memory tool offered. The fork's transcript never returns to the originating session's model context.

##### Memory review directive (final user message)

```markdown
Review the conversation above and consider saving to memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — their persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?

Before every write, inspect the current entries and consolidate them. Do not add duplicate or semantically overlapping facts when an existing entry should be merged, replaced, shortened, or removed. Keep only stable reusable facts and conventions; remove obsolete, redundant, and timeline-style details when one compact entry preserves the useful fact. If nothing is worth saving, just say 'Nothing to save.' and stop.

You can only call the memory tool. Other tools will be denied at runtime — do not attempt them.
```

#### Token effect

Does not grow the originating session; cost lands entirely in the fork request, capped by `reviewMaxIterations` model steps. When the review atomically saves entries, the browser can consume one transient, collapsed notice for the source session with the committed entry additions and removals. The process-local notice is deleted when read and is not logged, replayed, restored after reconnect, or injected into any model request; the frozen snapshot remains unchanged until a new session or context rebuild loads it.

#### KV Cache effect

Independent model request; it shares no cache position with the session it reviews.

## Known Limitations and Deferred Work

- **No write approval gate** — the upstream write-confirmation flow is deliberately not ported; memory writes from the review fork and live tool calls land without human review.
- **The snapshot is frozen until reload** — mid-session writes are durable but invisible to subsequent requests in the same process; nothing refreshes the prompt blocks on write.
- **Reviews run only after completed turns** — aborted or error-terminated turns never arm a review, and a session without a resolvable model route skips silently.
- **One shared store per DSH_HOME** — every session and preset under the same home reads and writes the same two files; there is no per-workspace or per-agent partitioning.
- **No sync or retention** — files are plain local text; the only backup is the drift `.bak.<epoch>` copy, and nothing ever prunes old backups.
- **Model-facing text is pinned in English** — tool description, result notes, and the review directive are part of the behavior contract and are not localized.
