/**
 * Bounded curated memory with file persistence — the DSH port of the
 * upstream memory store. Two `§`-delimited files under `$DSH_HOME/memories/`
 * hold the entries; a frozen snapshot captured at load time feeds the system
 * prompt while live mutations go to disk immediately. Mid-session writes do
 * not change the prompt snapshot, preserving the request prefix for the
 * whole session; the snapshot refreshes on the next store load.
 * @module dsh-memory/store
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { firstThreatMessage, scanForThreats } from './threats.ts'
import type { MemoryAction, MemoryEntryMeta, MemoryOperation, MemoryTarget, MemoryToolResult } from './types.ts'

/** Entry delimiter — entries may be multiline, so the delimiter spans lines. */
export const ENTRY_DELIMITER = '\n§\n'

/** Stable header prefixes of the system-prompt blocks. */
export const MEMORY_BLOCK_HEADERS: Record<MemoryTarget, string> = {
  memory: 'MEMORY (your personal notes)',
  user: 'USER PROFILE (who the user is)',
}

/** Sentinel: the target file exists on disk but could not be read. */
const READ_FAILED: unique symbol = Symbol('read-failed')

/** Permission bits for memory files and their directory (owner-private). */
const FILE_MODE = 0o600
const DIR_MODE = 0o700

/**
 * After this many failed consolidation attempts (overflow / zero-match) in
 * one turn, stop instructing the model to retry and return a terminal result
 * so a fragile replace/add cannot loop the turn to budget exhaustion and
 * suppress the user's reply.
 */
const MAX_CONSOLIDATION_FAILURES_PER_TURN = 3

/** Options constructing a store. */
export interface MemoryStoreOptions {
  /** Absolute directory holding MEMORY.md and USER.md. */
  readonly dir: string
  /** Character budget for MEMORY.md. */
  readonly memoryCharLimit: number
  /** Character budget for USER.md. */
  readonly userCharLimit: number
}

/** Raw file read outcome: content plus the exists-but-unreadable distinction. */
type RawRead = { raw: string } | typeof READ_FAILED

/** Reload outcome: clean, drift backup path, or unreadable. */
type ReloadOutcome = { kind: 'clean' } | { kind: 'drift'; backup: string } | { kind: 'read-failed' }

/** Format a count with thousands separators, matching the upstream responses. */
function grouped(count: number): string {
  return count.toLocaleString('en-US')
}

/**
 * Bounded curated memory with file persistence. Maintains two parallel states:
 * a frozen snapshot captured at {@link loadFromDisk}, injected into the system
 * prompt and never mutated mid-session (request prefix stability), and the
 * live entry lists mutated by tool calls and persisted to disk (tool
 * responses always reflect live state).
 */
export class MemoryStore {
  private readonly dir: string
  private readonly memoryCharLimit: number
  private readonly userCharLimit: number
  private entries: Record<MemoryTarget, string[]> = { memory: [], user: [] }
  private snapshot: Record<MemoryTarget, string> = { memory: '', user: '' }
  private consolidationFailures = 0

  /**
   * Create an unloaded store. Call {@link loadFromDisk} before first use.
   * @param options - storage directory and per-target character limits.
   */
  constructor(options: MemoryStoreOptions) {
    this.dir = options.dir
    this.memoryCharLimit = options.memoryCharLimit
    this.userCharLimit = options.userCharLimit
  }

  /**
   * Default storage directory: `$DSH_HOME/memories`.
   * @returns the absolute memories directory path.
   */
  static defaultDir(): string {
    return dshHomePath('memories')
  }

  /** Reset the per-turn consolidation-failure counter (call at turn start). */
  resetConsolidationFailures(): void {
    this.consolidationFailures = 0
  }

  /**
   * Load entries from MEMORY.md and USER.md and capture the frozen snapshot.
   * Each entry is scanned with the strict threat scope at snapshot-build
   * time: a hit replaces the entry text in the snapshot with a `[BLOCKED: …]`
   * placeholder so a poisoned-on-disk file cannot inject into the system
   * prompt, while the live lists keep the raw text so the owner can still
   * see and remove the poisoned entry.
   */
  async loadFromDisk(): Promise<void> {
    this.entries = {
      memory: dedupe(await this.readFile(this.pathFor('memory'))),
      user: dedupe(await this.readFile(this.pathFor('user'))),
    }
    this.snapshot = {
      memory: this.renderBlock('memory', sanitizeForSnapshot(this.entries.memory, 'MEMORY.md')),
      user: this.renderBlock('user', sanitizeForSnapshot(this.entries.user, 'USER.md')),
    }
  }

  /**
   * The frozen snapshot block for system-prompt injection — the state
   * captured at load time, not live state.
   * @param target - which store's block to return.
   * @returns the rendered block, or `undefined` when the snapshot is empty.
   */
  formatForSystemPrompt(target: MemoryTarget): string | undefined {
    const block = this.snapshot[target]
    return block.length > 0 ? block : undefined
  }

  /**
   * Re-read the files from disk and rebuild the frozen snapshot. Call this
   * after a memory tool write to pick up the new state for the next step.
   */
  async refreshSnapshot(): Promise<void> {
    this.entries = {
      memory: dedupe(await this.readFile(this.pathFor('memory'))),
      user: dedupe(await this.readFile(this.pathFor('user'))),
    }
    this.snapshot = {
      memory: this.renderBlock('memory', sanitizeForSnapshot(this.entries.memory, 'MEMORY.md')),
      user: this.renderBlock('user', sanitizeForSnapshot(this.entries.user, 'USER.md')),
    }
  }

  /**
   * Render both stores as a single block for system-prompt section injection.
   * Returns an empty string when both stores are empty.
   * @returns the full block, or an empty string.
   */
  renderContextBlock(): string {
    const memory = this.snapshot.memory
    const user = this.snapshot.user
    const blocks = [memory, user].filter(b => b.length > 0)
    if (blocks.length === 0) return ''
    return blocks.join('\n\n')
  }

  /**
   * Live entries of one target (read-only view for diagnostics and tests).
   * Returns entries with timestamps included (the raw on-disk form).
   * @param target - which store to read.
   * @returns the live entry list.
   */
  entriesFor(target: MemoryTarget): readonly string[] {
    return this.entries[target]
  }

  /**
   * Live entries with metadata (timestamp) for one target. Each entry is
   * paired with its creation/update timestamp. Old entries without timestamps
   * (from before this feature) get the file's mtime as a fallback.
   * @param target - which store to read.
   * @returns the live entry list with metadata.
   */
  entriesWithMeta(target: MemoryTarget): MemoryEntryMeta[] {
    return this.entries[target].map(content => {
      const timestamp = extractTimestamp(content) ?? ''
      return { content: stripTimestamp(content), timestamp }
    })
  }

  /**
   * The grouped `current/limit` usage string, matching the error-path usage
   * fields (`"924/2,200"`).
   * @param target - which store to report.
   * @returns the usage string.
   */
  usageString(target: MemoryTarget): string {
    return `${grouped(this.charCount(target))}/${grouped(this.charLimit(target))}`
  }

  /**
   * Append one entry; overflow returns a consolidation error with live entries.
   * @param target - which store receives the entry.
   * @param content - the entry text; trimmed before storage.
   * @returns the write outcome.
   */
  async add(target: MemoryTarget, content: string): Promise<MemoryToolResult> {
    const trimmed = content.trim()
    if (trimmed.length === 0) return { success: false, error: 'Content cannot be empty.' }
    const scanError = firstThreatMessage(trimmed, 'strict')
    if (scanError !== undefined) return { success: false, error: scanError }

    // Prepend ISO timestamp to the entry.
    const timestamped = `[${new Date().toISOString()}] ${trimmed}`

    return this.withLock(target, async () => {
      // Re-read under lock to pick up other sessions' writes. add skips the
      // drift guard because appending never clobbers existing content — but
      // that reasoning only holds when the reload actually saw the file, so
      // an unreadable file still aborts.
      const reload = await this.reloadTarget(target, { skipDrift: true })
      if (reload.kind === 'read-failed') return readFailedError(this.pathFor(target))

      const entries = this.entries[target]
      if (entries.includes(timestamped)) {
        return this.successResponse(target, 'Entry already exists (no duplicate added).')
      }
      // Check budget against the stripped content length.
      const newTotal = [...entries, timestamped].join(ENTRY_DELIMITER).length
      if (newTotal > this.charLimit(target)) {
        const current = this.charCount(target)
        return this.consolidationFailure({
          success: false,
          error: (
            `Memory at ${grouped(current)}/${grouped(this.charLimit(target))} chars. `
            + `Adding this entry (${trimmed.length} chars) would exceed the limit. `
            + "Consolidate now: use 'replace' to merge overlapping entries into "
            + "shorter ones or 'remove' stale or less important entries (see "
            + 'current_entries below), then retry this add — all in this turn.'
          ),
          current_entries: this.entries[target].map(stripTimestamp),
          usage: `${grouped(current)}/${grouped(this.charLimit(target))}`,
        })
      }
      entries.push(timestamped)
      await this.saveToDisk(target)
      return this.successResponse(target, 'Entry added.')
    })
  }

  /**
   * Replace the entry containing `oldText` with `newContent`.
   * @param target - which store holds the entry.
   * @param oldText - substring identifying the entry to replace; must match exactly one.
   * @param newContent - replacement entry text; trimmed before storage.
   * @returns the write outcome.
   */
  async replace(target: MemoryTarget, oldText: string, newContent: string): Promise<MemoryToolResult> {
    const trimmedOld = oldText.trim()
    const trimmedNew = newContent.trim()
    if (trimmedOld.length === 0) return { success: false, error: 'old_text cannot be empty.' }
    if (trimmedNew.length === 0) {
      return { success: false, error: "new_content cannot be empty. Use 'remove' to delete entries." }
    }
    const scanError = firstThreatMessage(trimmedNew, 'strict')
    if (scanError !== undefined) return { success: false, error: scanError }

    // Prepend ISO timestamp to the replacement entry.
    const timestampedNew = `[${new Date().toISOString()}] ${trimmedNew}`

    return this.withLock(target, async () => {
      const refusal = await this.reloadGuarded(target)
      if (refusal !== undefined) return refusal

      const entries = this.entries[target]
      const match = this.matchOrError(entries, trimmedOld, 'replace')
      if (typeof match !== 'number') return match
      const testEntries = [...entries]
      testEntries[match] = timestampedNew
      const newTotal = testEntries.join(ENTRY_DELIMITER).length
      if (newTotal > this.charLimit(target)) {
        const current = this.charCount(target)
        return this.consolidationFailure({
          success: false,
          error: (
            `Replacement would put memory at ${grouped(newTotal)}/${grouped(this.charLimit(target))} chars. `
            + "Shorten the new content, or 'remove' other stale or less important "
            + 'entries to make room (see current_entries below), then retry — all '
            + 'in this turn.'
          ),
          current_entries: entries.map(stripTimestamp),
          usage: `${grouped(current)}/${grouped(this.charLimit(target))}`,
        })
      }
      entries[match] = timestampedNew
      await this.saveToDisk(target)
      return this.successResponse(target, 'Entry replaced.')
    })
  }

  /**
   * Remove the entry at the given index (0-based). Used for batch deletions
   * from the UI rather than from the memory tool.
   * @param target - which store holds the entry.
   * @param index - 0-based index of the entry to remove.
   * @returns the write outcome.
   */
  async removeByIndex(target: MemoryTarget, index: number): Promise<MemoryToolResult> {
    return this.withLock(target, async () => {
      const refusal = await this.reloadGuarded(target)
      if (refusal !== undefined) return refusal

      const entries = this.entries[target]
      if (index < 0 || index >= entries.length) {
        return { success: false, error: `Index ${index} out of range (0-${entries.length - 1}).` }
      }
      entries.splice(index, 1)
      await this.saveToDisk(target)
      return this.successResponse(target, 'Entry removed.')
    })
  }

  /**
   * Remove multiple entries by their indices. All-or-nothing.
   * @param target - which store holds the entries.
   * @param indices - sorted 0-based indices to remove.
   * @returns the write outcome.
   */
  async removeByIndices(target: MemoryTarget, indices: readonly number[]): Promise<MemoryToolResult> {
    if (indices.length === 0) return { success: false, error: 'No indices provided.' }

    return this.withLock(target, async () => {
      const refusal = await this.reloadGuarded(target)
      if (refusal !== undefined) return refusal

      const entries = this.entries[target]
      const sorted = [...indices].sort((a, b) => b - a) // descending for splice
      for (const index of sorted) {
        if (index < 0 || index >= entries.length) {
          return { success: false, error: `Index ${index} out of range (0-${entries.length - 1}). No changes applied.` }
        }
        entries.splice(index, 1)
      }
      await this.saveToDisk(target)
      return this.successResponse(target, `${indices.length} entry(s) removed.`)
    })
  }
  async remove(target: MemoryTarget, oldText: string): Promise<MemoryToolResult> {
    const trimmedOld = oldText.trim()
    if (trimmedOld.length === 0) return { success: false, error: 'old_text cannot be empty.' }

    return this.withLock(target, async () => {
      const refusal = await this.reloadGuarded(target)
      if (refusal !== undefined) return refusal

      const entries = this.entries[target]
      const match = this.matchOrError(entries, trimmedOld, 'remove')
      if (typeof match !== 'number') return match
      entries.splice(match, 1)
      await this.saveToDisk(target)
      return this.successResponse(target, 'Entry removed.')
    })
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
  async applyBatch(target: MemoryTarget, operations: readonly MemoryOperation[]): Promise<MemoryToolResult> {
    if (operations.length === 0) return { success: false, error: 'operations list is empty.' }

    // Scan every add/replace content before touching disk — one poisoned op
    // rejects the whole batch.
    for (const [i, op] of operations.entries()) {
      if ((op.action === 'add' || op.action === 'replace') && op.content !== undefined && op.content.length > 0) {
        const scanError = firstThreatMessage(op.content, 'strict')
        if (scanError !== undefined) return { success: false, error: `Operation ${i + 1}: ${scanError}` }
      }
    }

    return this.withLock(target, async () => {
      const refusal = await this.reloadGuarded(target)
      if (refusal !== undefined) return refusal

      // Work on a copy; commit only when the whole batch validates.
      const working = [...this.entries[target]]
      const appliedOperations = new Set<string>()
      for (const [i, op] of operations.entries()) {
        const content = (op.content ?? '').trim()
        const oldText = (op.old_text ?? '').trim()
        const pos = `Operation ${i + 1} (${op.action ?? 'unknown'})`

        if (op.action === 'add') {
          if (content.length === 0) return this.batchError(target, `${pos}: content is required.`)
          const timestamped = `[${new Date().toISOString()}] ${content}`
          if (working.includes(timestamped)) continue // idempotent duplicate skip
          working.push(timestamped)
        } else if (op.action === 'replace') {
          if (oldText.length === 0) return this.batchError(target, `${pos}: old_text is required.`)
          if (content.length === 0) {
            return this.batchError(target, `${pos}: content is required (use action='remove' to delete).`)
          }
          const match = findUniqueMatch(working, oldText)
          if (match === undefined) {
            const signature = `replace\u0000${oldText}\u0000${content}`
            // A repeated identical replacement is idempotent: an earlier
            // operation in this atomic batch may already have resolved all
            // matching entries.
            if (appliedOperations.has(signature)) continue
            return this.batchError(target, `${pos}: no entry matched '${oldText}'.`)
          }
          const timestamped = `[${new Date().toISOString()}] ${content}`
          if (match === 'ambiguous') {
            const matches = findAllMatches(working, oldText)
            for (const index of matches) working[index] = timestamped
          } else {
            working[match] = timestamped
          }
          appliedOperations.add(`replace\u0000${oldText}\u0000${content}`)
          working.splice(0, working.length, ...dedupeByContent(working))
        } else if (op.action === 'remove') {
          if (oldText.length === 0) return this.batchError(target, `${pos}: old_text is required.`)
          const match = findUniqueMatch(working, oldText)
          if (match === undefined) return this.batchError(target, `${pos}: no entry matched '${oldText}'.`)
          if (match === 'ambiguous') {
            return this.batchError(target, `${pos}: '${oldText}' matched multiple distinct entries -- be more specific.`)
          }
          working.splice(match, 1)
        } else {
          return this.batchError(target, `${pos}: unknown action. Use add, replace, or remove.`)
        }
      }

      // Budget check against the FINAL state only.
      const newTotal = working.length > 0 ? working.join(ENTRY_DELIMITER).length : 0
      if (newTotal > this.charLimit(target)) {
        const current = this.charCount(target)
        return this.consolidationFailure({
          success: false,
          error: (
            `After applying all ${operations.length} operations, memory would be at `
            + `${grouped(newTotal)}/${grouped(this.charLimit(target))} chars -- over the limit. Remove or shorten more `
            + 'entries in the same batch (see current_entries below), then retry.'
          ),
          current_entries: this.entries[target],
          usage: `${grouped(current)}/${grouped(this.charLimit(target))}`,
        })
      }

      this.entries[target] = working
      await this.saveToDisk(target)
      return this.successResponse(target, `Applied ${operations.length} operation(s).`)
    })
  }

  /** Absolute path of one target's file. */
  private pathFor(target: MemoryTarget): string {
    return join(this.dir, target === 'user' ? 'USER.md' : 'MEMORY.md')
  }

  private charLimit(target: MemoryTarget): number {
    return target === 'user' ? this.userCharLimit : this.memoryCharLimit
  }

  private charCount(target: MemoryTarget): number {
    const entries = this.entries[target]
    return entries.length === 0 ? 0 : entries.join(ENTRY_DELIMITER).length
  }

  /**
   * Count an at-capacity consolidation failure and degrade gracefully: under
   * the per-turn cap the response passes through unchanged (it tells the
   * model how to self-correct), at the cap a terminal result replaces it so
   * a failed memory side effect never blocks the turn's reply.
   */
  private consolidationFailure(response: MemoryToolResult): MemoryToolResult {
    this.consolidationFailures += 1
    if (this.consolidationFailures <= MAX_CONSOLIDATION_FAILURES_PER_TURN) return response
    return {
      success: false,
      done: true,
      error: (
        `Memory consolidation failed ${this.consolidationFailures} times `
        + 'this turn. Stop retrying memory calls — leave memory unchanged for '
        + 'now and continue with your reply to the user. The fact can be saved '
        + 'in a later turn.'
      ),
    }
  }

  /** Batch-abort error reporting live (uncommitted) state. */
  private batchError(target: MemoryTarget, message: string): MemoryToolResult {
    return this.consolidationFailure({
      success: false,
      error: `${message} No operations were applied (batch is all-or-nothing).`,
      current_entries: this.entries[target].map(stripTimestamp),
      usage: `${grouped(this.charCount(target))}/${grouped(this.charLimit(target))}`,
    })
  }

  /**
   * Reload one target under the lock with drift protection. A write
   * operation may not proceed on an unreadable or externally changed file;
   * the refusal result is returned to the caller in that case.
   * @param target - which store to re-read.
   * @returns the refusal result, or `undefined` when the reload is clean.
   */
  private async reloadGuarded(target: MemoryTarget): Promise<MemoryToolResult | undefined> {
    const reload = await this.reloadTarget(target)
    if (reload.kind === 'read-failed') return readFailedError(this.pathFor(target))
    if (reload.kind === 'drift') return driftError(this.pathFor(target), reload.backup)
    return undefined
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
  private matchOrError(entries: readonly string[], trimmedOld: string, verb: string): number | MemoryToolResult {
    const match = findUniqueMatch(entries, trimmedOld)
    if (match === undefined) {
      return this.consolidationFailure({
        success: false,
        error: `No entry matched '${trimmedOld}'. Check current_entries below and retry with the exact text of the entry you want to ${verb}.`,
        current_entries: entries.map(stripTimestamp),
      })
    }
    if (match === 'ambiguous') {
      return {
        success: false,
        error: `Multiple entries matched '${trimmedOld}'. Be more specific.`,
        matches: previews(entries.filter(entry => entry.includes(trimmedOld))),
      }
    }
    return match
  }

  /**
   * Success responses are intentionally TERMINAL: they confirm the write
   * landed and tell the model to stop, without echoing the entry list —
   * dumping it invites redundant re-issues. Entries only appear on the
   * error/over-budget paths where the model genuinely needs them.
   */
  private successResponse(target: MemoryTarget, message: string): MemoryToolResult {
    // A successful write means the consolidation loop made progress, so the
    // per-turn failure budget resets (the cap counts consecutive failures).
    this.consolidationFailures = 0
    const entries = this.entries[target]
    const current = this.charCount(target)
    const limit = this.charLimit(target)
    const pct = limit > 0 ? Math.min(100, Math.trunc((current / limit) * 100)) : 0
    return {
      success: true,
      done: true,
      target,
      usage: `${pct}% — ${grouped(current)}/${grouped(limit)} chars`,
      entry_count: entries.length,
      message,
      note: 'Write saved. This update is complete — do not repeat it.',
    }
  }

  /** Render a system-prompt block with header and usage indicator. */
  private renderBlock(target: MemoryTarget, entries: readonly string[]): string {
    if (entries.length === 0) return ''
    const limit = this.charLimit(target)
    // Strip timestamps for the model-visible snapshot.
    const cleanEntries = entries.map(stripTimestamp)
    const content = cleanEntries.join(ENTRY_DELIMITER)
    const current = content.length
    const pct = limit > 0 ? Math.min(100, Math.trunc((current / limit) * 100)) : 0
    const header = `${MEMORY_BLOCK_HEADERS[target]} [${pct}% — ${grouped(current)}/${grouped(limit)} chars]`
    const separator = '═'.repeat(46)
    return `${separator}\n${header}\n${separator}\n${content}`
  }

  /**
   * Read one memory file's raw text, distinguishing unreadable from empty:
   * an absent file is a clean empty read, an exists-but-unreadable file
   * (I/O error or invalid UTF-8) is `READ_FAILED`. Read-modify-write callers
   * must treat the latter as abort, not as an empty store — persisting over
   * it would wipe the on-disk memory.
   */
  private async readRawChecked(path: string): Promise<RawRead> {
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { raw: '' }
      return READ_FAILED
    }
    // Strip a leading UTF-8 BOM (the utf-8-sig parity): a BOM glued to the
    // first entry corrupts matching and dedupe for it forever.
    return { raw: raw.startsWith('\ufeff') ? raw.slice(1) : raw }
  }

  /** Split raw file text into stripped, non-empty entries. */
  private parseEntries(raw: string): string[] {
    if (raw.trim().length === 0) return []
    // Split on the full delimiter: splitting on "§" alone would break
    // entries containing "§" in their content.
    return raw.split(ENTRY_DELIMITER).map(entry => entry.trim()).filter(entry => entry.length > 0)
  }

  /** Read-only parse for {@link loadFromDisk}: a failed read degrades to []. */
  private async readFile(path: string): Promise<string[]> {
    const read = await this.readRawChecked(path)
    return read === READ_FAILED ? [] : this.parseEntries(read.raw)
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
  private async reloadTarget(
    target: MemoryTarget,
    options?: { skipDrift?: boolean },
  ): Promise<ReloadOutcome> {
    const path = this.pathFor(target)
    const read = await this.readRawChecked(path)
    if (read === READ_FAILED) return { kind: 'read-failed' }
    const backup = options?.skipDrift === true ? undefined : await this.detectExternalDrift(target, read.raw)
    this.entries[target] = dedupe(this.parseEntries(read.raw))
    return backup === undefined ? { kind: 'clean' } : { kind: 'drift', backup }
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
  private async detectExternalDrift(target: MemoryTarget, raw: string): Promise<string | undefined> {
    if (raw.trim().length === 0) return undefined
    const parsed = raw.split(ENTRY_DELIMITER).map(entry => entry.trim()).filter(entry => entry.length > 0)
    const roundtrip = parsed.join(ENTRY_DELIMITER)
    const maxEntryLength = parsed.reduce((max, entry) => Math.max(max, entry.length), 0)
    const drifted = raw.trim() !== roundtrip || maxEntryLength > this.charLimit(target)
    if (!drifted) return undefined

    const path = this.pathFor(target)
    const backupPath = `${path}.bak.${Math.trunc(Date.now() / 1000)}`
    try {
      await writeFile(backupPath, raw, { mode: FILE_MODE })
    } catch {
      // Backup failure must not hide the drift: report the intended path
      // marked as failed and refuse the mutation anyway.
      return `${backupPath} (BACKUP FAILED — file unchanged on disk)`
    }
    return backupPath
  }

  /** Persist live entries atomically (temp + rename, never truncate-before-lock). */
  private async saveToDisk(target: MemoryTarget): Promise<void> {
    const content = this.entries[target].length > 0 ? this.entries[target].join(ENTRY_DELIMITER) : ''
    await writeFileAtomic(this.pathFor(target), content, { mode: FILE_MODE, dirMode: DIR_MODE })
  }

  /** Serialize a read-modify-write cycle through the per-file lock. */
  private async withLock(
    target: MemoryTarget,
    operation: () => Promise<MemoryToolResult>,
  ): Promise<MemoryToolResult> {
    const path = this.pathFor(target)
    await mkdirp(dirname(path))
    return withFileLock(path, operation)
  }
}

/** `mkdir -p`: recursive mode is idempotent. */
async function mkdirp(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
}

/** Order-preserving dedupe keeping the first occurrence. */
function dedupe(entries: readonly string[]): string[] {
  return [...new Set(entries)]
}

/** Remove duplicate logical entries while retaining the newest timestamp. */
function dedupeByContent(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const content = stripTimestamp(entries[index] ?? '')
    if (seen.has(content)) continue
    seen.add(content)
    result.unshift(entries[index] ?? '')
  }
  return result
}

/** Truncated one-line previews of entries for ambiguity feedback. */
function previews(entries: readonly string[], width = 80): string[] {
  return entries.map(entry => (entry.length > width ? `${entry.slice(0, width)}...` : entry))
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
function findUniqueMatch(entries: readonly string[], oldText: string): number | 'ambiguous' | undefined {
  const matches = findAllMatches(entries, oldText)
  if (matches.length === 0) return undefined
  const distinct = new Set(matches.map(index => stripTimestamp(entries[index] ?? '')))
  if (distinct.size > 1) return 'ambiguous'
  return matches[0]
}

/** Return every entry index whose visible content contains `oldText`. */
function findAllMatches(entries: readonly string[], oldText: string): number[] {
  return entries.flatMap((entry, index) => stripTimestamp(entry).includes(oldText) ? [index] : [])
}

/** Drift-refusal result pointing the operator at the backup snapshot. */
function driftError(path: string, backup: string): MemoryToolResult {
  return {
    success: false,
    error: (
      `Refusing to write ${basename(path)}: file on disk has content that `
      + "wouldn't round-trip through the memory tool (likely added by "
      + 'the patch tool, a shell append, a manual edit, or a '
      + `concurrent session). A snapshot was saved to ${backup}. `
      + 'Resolve the drift first — either rewrite the file as a clean '
      + '§-delimited list of entries, or move the extra content out — '
      + 'then retry. This guard exists to prevent silent data loss.'
    ),
    drift_backup: backup,
    remediation: (
      'Open the .bak file, integrate the missing entries into the '
      + 'memory tool one at a time via memory(action=add, content=...), '
      + 'then remove or rewrite the original file to a clean state.'
    ),
  }
}

/** Refusal for an exists-but-unreadable file: never treat unreadable as empty. */
function readFailedError(path: string): MemoryToolResult {
  return {
    success: false,
    error: (
      `Refusing to write ${basename(path)}: the file exists on disk but could `
      + 'not be read right now (temporarily locked by another program, a '
      + 'permission change, invalid/corrupt text encoding, or a filesystem '
      + 'error). Treating an unreadable file as empty and saving would wipe '
      + 'existing memory, so the write is refused. Nothing was changed — '
      + 'retry in a moment.'
    ),
  }
}

/** Replace threat-matching entries with placeholders for the snapshot only. */
function sanitizeForSnapshot(entries: readonly string[], filename: string): string[] {
  return entries.map((entry) => {
    if (entry.length === 0 || entry.startsWith('[BLOCKED:')) return entry
    const findings = scanForThreats(entry, 'strict')
    if (findings.length === 0) return entry
    return (
      `[BLOCKED: ${filename} entry contained threat pattern(s): `
      + `${findings.join(', ')}. Removed from system prompt; `
      + 'use memory(action=remove) '
      + 'to delete the original.]'
    )
  })
}

/** Timestamp prefix regex: `[ISO-timestamp] ` at the start of an entry. */
const TIMESTAMP_RE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\s*/

/**
 * Extract the ISO timestamp from an entry's timestamp prefix, if present.
 * @param content - the raw entry content (may start with a timestamp).
 * @returns the ISO timestamp string, or undefined.
 */
function extractTimestamp(content: string): string | undefined {
  const match = content.match(TIMESTAMP_RE)
  return match?.[1]
}

/**
 * Strip the timestamp prefix from an entry, if present.
 * @param content - the raw entry content.
 * @returns the entry content without the timestamp prefix.
 */
function stripTimestamp(content: string): string {
  return content.replace(TIMESTAMP_RE, '')
}

/** Public vocabulary re-exported from the types module. */
export type { MemoryAction, MemoryEntryMeta, MemoryOperation, MemoryTarget, MemoryToolResult }
