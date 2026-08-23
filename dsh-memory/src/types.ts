/**
 * Shared vocabulary of the bounded curated memory stores. Field names mirror
 * the model-visible JSON exactly, so tool-result text references like
 * `current_entries below` match the keys the model actually sees.
 * @module dsh-memory/types
 */

/** Which bounded store an entry lives in. */
export type MemoryTarget = 'memory' | 'user'

/** One mutating operation accepted by the `memory` tool. */
export type MemoryAction = 'add' | 'replace' | 'remove'

/**
 * One item of the batch wire shape: `add` needs `content`, `replace` needs
 * both `old_text` and `content`, `remove` needs `old_text`. `action` is an
 * open string at this boundary — the tool schema pins the enum for model
 * calls, but the store also serves direct programmatic callers and must
 * reject unknown actions itself.
 */
export interface MemoryOperation {
  /** The operation kind; anything outside add/replace/remove is rejected. */
  readonly action?: string
  /** Entry content for `add` and `replace`. */
  readonly content?: string
  /** Unique substring identifying the entry for `replace` and `remove`. */
  readonly old_text?: string
}

/**
 * The result dict every store mutation returns; tool responses are its JSON
 * serialization. `current_entries` and `matches` only ride the error paths
 * that need them for self-correction.
 */
export interface MemoryToolResult {
  /** Whether the mutation landed. */
  success: boolean
  /** Terminal marker: do not re-issue this update. */
  done?: boolean
  /** The store acted on. */
  target?: MemoryTarget
  /** Human-readable capacity, e.g. `42% — 924/2,200 chars`. */
  usage?: string
  /** Entry count after the mutation. */
  entry_count?: number
  /** Outcome description on success paths. */
  message?: string
  /** Stop instruction appended to every success response. */
  note?: string
  /** Failure description on error paths. */
  error?: string
  /** Live entries shown on consolidation errors so the model can self-correct. */
  current_entries?: readonly string[]
  /** 80-char previews of ambiguous matches. */
  matches?: readonly string[]
  /** Absolute backup path when external drift was detected. */
  drift_backup?: string
  /** Operator instruction paired with a drift backup. */
  remediation?: string
}

/** One entry with its creation/update metadata. */
export interface MemoryEntryMeta {
  /** The entry content text. */
  readonly content: string
  /** ISO-format timestamp of creation or last update. */
  readonly timestamp: string
}

/** One persisted entry change produced by a completed background review. */
export interface MemoryReviewChange {
  /** Store whose committed entry changed. */
  readonly target: MemoryTarget
  /** The persisted operation observed after the write committed. */
  readonly action: 'added' | 'removed'
  /** Entry content after an addition, or before a removal. */
  readonly content: string
}

/** Transient, source-session-only summary of one completed background review. */
export interface MemoryReviewNotification {
  /** Session whose completed turn triggered the review. */
  readonly sessionId: string
  /** Number of review tool calls that committed at least one store change. */
  readonly saved: number
  /** All committed entry-level additions and removals, in execution order. */
  readonly changes: readonly MemoryReviewChange[]
  /** Terminal state of the review after the committed changes. */
  readonly reason: 'finished' | 'max-iterations' | 'aborted' | 'failed'
}

/** Configurable memory settings exposed to the settings UI. */
export interface MemorySettings {
  /** Completed user turns between background memory reviews; 0 disables reviews. */
  nudgeInterval: number
  /** Run background memory reviews after gated completed turns. */
  reviewEnabled: boolean
}
