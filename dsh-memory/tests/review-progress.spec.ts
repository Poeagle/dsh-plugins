import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryReviewProgressStore, remainingTurnsUntilReview } from '../src/review-progress.ts'

let dir: string | undefined

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dsh-memory-progress-')) })
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('remainingTurnsUntilReview', () => {
  it('returns the rest of the cycle, or 0 when reviews are off', () => {
    expect(remainingTurnsUntilReview(0, 5, true)).toBe(5)
    expect(remainingTurnsUntilReview(1, 5, true)).toBe(4)
    expect(remainingTurnsUntilReview(5, 5, true)).toBe(5)
    expect(remainingTurnsUntilReview(0, 5, false)).toBe(0)
    expect(remainingTurnsUntilReview(3, 0, true)).toBe(0)
  })
})

describe('MemoryReviewProgressStore', () => {
  it('restores a countdown after a process restart', async () => {
    const original = new MemoryReviewProgressStore(dir)
    await original.publish('session-a', { reviewEnabled: true, remainingTurns: 2 })
    await expect(new MemoryReviewProgressStore(dir).get('session-a'))
      .resolves.toEqual({ reviewEnabled: true, remainingTurns: 2 })
  })
})
