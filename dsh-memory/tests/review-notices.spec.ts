import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryReviewNotices } from '../src/review-notices.ts'

let dir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-memory-notices-'))
})

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

const first = {
  sessionId: 'session-a',
  saved: 1,
  changes: [{ target: 'memory' as const, action: 'added' as const, content: 'Durable convention' }],
  reason: 'finished' as const,
}

const second = {
  sessionId: 'session-b',
  saved: 1,
  changes: [{ target: 'user' as const, action: 'removed' as const, content: 'Stale preference' }],
  reason: 'max-iterations' as const,
}

describe('MemoryReviewNotices', () => {
  it('persists and isolates receipts by session without consuming them on read', async () => {
    const notices = new MemoryReviewNotices(dir)
    await notices.publish(first)
    await notices.publish(second)

    expect(await notices.get('session-a')).toEqual(first)
    expect(await notices.get('session-a')).toEqual(first)
    expect(await notices.get('session-b')).toEqual(second)
    expect(await notices.get('unknown')).toBeUndefined()

    const afterRefresh = new MemoryReviewNotices(dir)
    expect(await afterRefresh.get('session-a')).toEqual(first)
  })

  it('drops a disposed session receipt', async () => {
    const notices = new MemoryReviewNotices(dir)
    await notices.publish(first)
    await notices.discard('session-a')
    expect(await notices.get('session-a')).toBeUndefined()
  })
})
