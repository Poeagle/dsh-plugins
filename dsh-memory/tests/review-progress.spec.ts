import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryReviewProgressStore } from '../src/review-progress.ts'

let dir: string | undefined

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dsh-memory-progress-')) })
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('MemoryReviewProgressStore', () => {
  it('restores a countdown after a process restart', async () => {
    const original = new MemoryReviewProgressStore(dir)
    await original.publish('session-a', { reviewEnabled: true, remainingTurns: 2 })
    await expect(new MemoryReviewProgressStore(dir).get('session-a'))
      .resolves.toEqual({ reviewEnabled: true, remainingTurns: 2 })
  })
})
