/** Process-local review-cycle progress for the browser memory indicator. */

/** Remaining completed user turns before the next background review. */
export interface MemoryReviewProgress {
  readonly remainingTurns: number
  readonly reviewEnabled: boolean
}

/**
 * Holds the current source-session review countdown without writing session data.
 * Values disappear when the owning session disposes or the process restarts.
 */
export class MemoryReviewProgressStore {
  private readonly bySession = new Map<string, MemoryReviewProgress>()

  /** Publish one session's current countdown. */
  publish(sessionId: string, progress: MemoryReviewProgress): void {
    this.bySession.set(sessionId, progress)
  }

  /** Read one session's current countdown without consuming it. */
  get(sessionId: string): MemoryReviewProgress | undefined {
    return this.bySession.get(sessionId)
  }

  /** Forget a disposed session's countdown. */
  discard(sessionId: string): void {
    this.bySession.delete(sessionId)
  }
}

/** Shared across the preset and host settings plugin in this DSH process. */
export const memoryReviewProgress = new MemoryReviewProgressStore()
