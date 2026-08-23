import { describe, expect, it } from 'vitest'
import { MemoryReviewNotices } from '../src/review-notices.ts'

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
  it('isolates receipts by session and consumes each receipt only once', () => {
    const notices = new MemoryReviewNotices()
    notices.publish(first)
    notices.publish(second)

    expect(notices.consume('session-a')).toEqual(first)
    expect(notices.consume('session-a')).toBeUndefined()
    expect(notices.consume('session-b')).toEqual(second)
    expect(notices.consume('unknown')).toBeUndefined()
  })

  it('drops unread receipts when their source session disposes', () => {
    const notices = new MemoryReviewNotices()
    notices.publish(first)
    notices.discard('session-a')
    expect(notices.consume('session-a')).toBeUndefined()
  })
})
