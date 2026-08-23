/** Process-local, one-time background-review notification storage. */

import type { MemoryReviewNotification } from './types.ts'

/**
 * Stores completed review receipts until the source session's browser reads one.
 * Entries live only in this process and are removed by {@link consume}.
 */
export class MemoryReviewNotices {
  private readonly bySession = new Map<string, MemoryReviewNotification>()

  /**
   * Publish a committed review receipt for its source session.
   * @param notice - The already-persisted review result.
   */
  publish(notice: MemoryReviewNotification): void {
    this.bySession.set(notice.sessionId, notice)
  }

  /**
   * Return and delete the pending receipt for one session.
   * @param sessionId - Source session that owns the receipt.
   * @returns The pending receipt, if one exists.
   */
  consume(sessionId: string): MemoryReviewNotification | undefined {
    const notice = this.bySession.get(sessionId)
    if (notice !== undefined) this.bySession.delete(sessionId)
    return notice
  }

  /**
   * Delete a disposed session's unread receipt.
   * @param sessionId - Session whose transient receipt should be discarded.
   */
  discard(sessionId: string): void {
    this.bySession.delete(sessionId)
  }
}

/**
 * The settings plugin and the memory agent preset run in different Cordis
 * realms. Module scope provides their process-local handoff without making a
 * preset publish a process-global Cordis service.
 */
export const memoryReviewNotices = new MemoryReviewNotices()
