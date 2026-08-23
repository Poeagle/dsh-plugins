/** Durable review-cycle progress for the browser memory indicator. */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

const DIR_MODE = 0o700
const FILE_MODE = 0o600

/** Remaining completed user turns before the next background review. */
export interface MemoryReviewProgress {
  readonly remainingTurns: number
  readonly reviewEnabled: boolean
}

/** Persist the latest countdown for each session outside the official session log. */
export class MemoryReviewProgressStore {
  private readonly bySession = new Map<string, MemoryReviewProgress>()
  private readonly path: string

  /** @param dir - directory holding the progress receipt. */
  constructor(dir = dshHomePath('memories')) {
    this.path = join(dir, '.review-progress.json')
  }

  /** Store a countdown in memory and on disk. */
  async publish(sessionId: string, progress: MemoryReviewProgress): Promise<void> {
    this.bySession.set(sessionId, progress)
    const values = await this.read()
    values[sessionId] = progress
    await this.write(values)
  }

  /** Read the current or prior-process countdown. */
  async get(sessionId: string): Promise<MemoryReviewProgress | undefined> {
    return this.bySession.get(sessionId) ?? (await this.read())[sessionId]
  }

  /** Remove a disposed session's receipt. */
  async discard(sessionId: string): Promise<void> {
    this.bySession.delete(sessionId)
    const values = await this.read()
    if (values[sessionId] === undefined) return
    delete values[sessionId]
    await this.write(values)
  }

  private async read(): Promise<Record<string, MemoryReviewProgress>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, MemoryReviewProgress>
        : {}
    } catch {
      return {}
    }
  }

  private async write(values: Record<string, MemoryReviewProgress>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE })
    await writeFileAtomic(this.path, JSON.stringify(values), { mode: FILE_MODE, dirMode: DIR_MODE })
  }
}

/** Shared across the preset and host settings plugin in this DSH process. */
export const memoryReviewProgress = new MemoryReviewProgressStore()
