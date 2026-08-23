/** Durable background-review history outside the official session log. */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { MemoryReviewNotification } from './types.ts'

const DIR_MODE = 0o700
const FILE_MODE = 0o600
const MAX_HISTORY_PER_SESSION = 50

/** One sidecar-backed completed review record. */
export interface MemoryReviewRecord extends MemoryReviewNotification {
  /** ISO completion timestamp written by the plugin. */
  readonly completedAt: string
}

/**
 * Persists bounded review history per session. It is deliberately a plugin
 * sidecar rather than an official Session event, because external plugins lack
 * the public API required to safely append an ignorable unknown event.
 */
export class MemoryReviewNotices {
  private readonly path: string

  /** @param dir - directory holding the review-history file. */
  constructor(dir = dshHomePath('memories')) {
    this.path = join(dir, '.review-notices.json')
  }

  /** Append a completed review record for one source session. */
  async publish(notice: MemoryReviewNotification): Promise<void> {
    const history = await this.read()
    const records = history[notice.sessionId] ?? []
    history[notice.sessionId] = [...records, { ...notice, completedAt: new Date().toISOString() }]
      .slice(-MAX_HISTORY_PER_SESSION)
    await this.write(history)
  }

  /** Return the full persisted review history for one source session. */
  async list(sessionId: string): Promise<readonly MemoryReviewRecord[]> {
    return (await this.read())[sessionId] ?? []
  }

  /** Delete a disposed session's review history. */
  async discard(sessionId: string): Promise<void> {
    const history = await this.read()
    if (history[sessionId] === undefined) return
    delete history[sessionId]
    await this.write(history)
  }

  private async read(): Promise<Record<string, MemoryReviewRecord[]>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const records: Record<string, MemoryReviewRecord[]> = {}
      for (const [sessionId, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) records[sessionId] = value as MemoryReviewRecord[]
        // Upgrade the prior one-record sidecar layout on first write/read.
        else if (value !== null && typeof value === 'object') {
          records[sessionId] = [{ ...(value as MemoryReviewNotification), completedAt: '' }]
        }
      }
      return records
    } catch {
      return {}
    }
  }

  private async write(history: Record<string, MemoryReviewRecord[]>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE })
    await writeFileAtomic(this.path, JSON.stringify(history), { mode: FILE_MODE, dirMode: DIR_MODE })
  }
}

/** Shared review-history store for the memory preset and host HTTP route. */
export const memoryReviewNotices = new MemoryReviewNotices()
