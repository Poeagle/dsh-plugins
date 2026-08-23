/** Durable background-review notification storage. */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { MemoryReviewNotification } from './types.ts'

/** Owner-only directory mode for persisted review receipts. */
const DIR_MODE = 0o700
/** Owner-only file mode for persisted review receipts. */
const FILE_MODE = 0o600

/**
 * Stores the latest completed review receipt per source session on disk.
 * Reading a receipt never deletes it, so a browser refresh or reconnect retains
 * the visible background-update result until a newer review supersedes it.
 */
export class MemoryReviewNotices {
  private readonly path: string

  /** @param dir - directory holding the receipt file. */
  constructor(dir = dshHomePath('memories')) {
    this.path = join(dir, '.review-notices.json')
  }

  /** Persist a committed review receipt for its source session. */
  async publish(notice: MemoryReviewNotification): Promise<void> {
    const notices = await this.read()
    notices[notice.sessionId] = notice
    await this.write(notices)
  }

  /** Return the latest persisted receipt for one source session without consuming it. */
  async get(sessionId: string): Promise<MemoryReviewNotification | undefined> {
    return (await this.read())[sessionId]
  }

  /** Delete a disposed session's persisted receipt. */
  async discard(sessionId: string): Promise<void> {
    const notices = await this.read()
    if (notices[sessionId] === undefined) return
    delete notices[sessionId]
    await this.write(notices)
  }

  private async read(): Promise<Record<string, MemoryReviewNotification>> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, MemoryReviewNotification>
        : {}
    } catch {
      return {}
    }
  }

  private async write(notices: Record<string, MemoryReviewNotification>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE })
    await writeFileAtomic(this.path, JSON.stringify(notices), { mode: FILE_MODE, dirMode: DIR_MODE })
  }
}

/** Shared receipt store for the memory preset and host HTTP route. */
export const memoryReviewNotices = new MemoryReviewNotices()
