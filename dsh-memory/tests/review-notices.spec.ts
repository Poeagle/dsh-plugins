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
  it('persists bounded review histories by session', async () => {
    const notices = new MemoryReviewNotices(dir)
    await notices.publish(first)
    await notices.publish(second)

    const sessionA = await notices.list('session-a')
    expect(sessionA).toHaveLength(1)
    expect(sessionA[0]).toMatchObject(first)
    expect(sessionA[0]?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect((await notices.list('session-b'))[0]).toMatchObject(second)
    expect(await notices.list('unknown')).toEqual([])

    const afterRefresh = new MemoryReviewNotices(dir)
    expect((await afterRefresh.list('session-a'))[0]).toMatchObject(first)
  })

  it('drops a disposed session receipt', async () => {
    const notices = new MemoryReviewNotices(dir)
    await notices.publish(first)
    await notices.discard('session-a')
    expect(await notices.list('session-a')).toEqual([])
  })
})
