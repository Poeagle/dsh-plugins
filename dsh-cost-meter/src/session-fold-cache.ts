/** In-process cache of each session's own fold, keyed by pricing and log fingerprints. */

import { foldSession, type CostEvent, type CostFold, type PricingConfig } from './pricing.js'

export interface SessionFoldCacheStats {
  hits: number
  misses: number
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter(key => key !== 'lastProbedAt')
        .map(key => [key, stableValue((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/** Deterministic fingerprint of the live pricing used to value a fold. Probe timestamps do not change billed rates. */
export function pricingFingerprint(config: PricingConfig): string {
  return JSON.stringify(stableValue(config))
}

function usageMix(event: CostEvent): number {
  const usage = event.data.usage ?? (event.data.chunk?.type === 'usage' ? event.data.chunk.usage : undefined)
  if (usage === undefined) return 0
  let mix = 0
  for (const value of Object.values(usage)) {
    if (typeof value === 'number' && Number.isFinite(value)) mix = Math.imul(mix, 33) + (value | 0) >>> 0
  }
  return mix
}

/**
 * Cheap identity of one session log. Length, a rolling mix of type/time/usage,
 * and the last event distinguish appends and last-writer-wins usage
 * replacements without hashing the whole payload.
 */
export function logFingerprint(events: readonly CostEvent[]): string {
  let mix = events.length >>> 0
  for (const event of events) {
    mix = Math.imul(mix, 33) + event.type.length >>> 0
    mix = Math.imul(mix, 33) + (event.time | 0) >>> 0
    const turn = event.data.turn
    const step = event.data.step
    if (typeof turn === 'number') mix = Math.imul(mix, 33) + (turn | 0) >>> 0
    if (typeof step === 'number') mix = Math.imul(mix, 33) + (step | 0) >>> 0
    mix = Math.imul(mix, 33) + usageMix(event) >>> 0
  }
  const last = events[events.length - 1]
  return `${events.length}:${mix}:${last?.type ?? ''}:${last?.time ?? 0}:${last?.data.turn ?? ''}:${last?.data.step ?? ''}:${usageMix(last ?? { type: '', time: 0, data: {} })}`
}

interface CacheEntry {
  pricing: string
  log: string
  cost: CostFold
}

/**
 * Reuse a session's own fold when the pricing config and log fingerprint match.
 * A pricing change drops every entry. Deleted ids are dropped by `retain()`.
 */
export class SessionFoldCache {
  private readonly entries = new Map<string, CacheEntry>()
  private pricing = ''
  readonly stats: SessionFoldCacheStats = { hits: 0, misses: 0 }

  constructor(private readonly compute: (events: readonly CostEvent[], config: PricingConfig) => CostFold = foldSession) {}

  get size(): number {
    return this.entries.size
  }

  private alignPricing(config: PricingConfig): string {
    const pricing = pricingFingerprint(config)
    if (this.pricing !== '' && this.pricing !== pricing) this.entries.clear()
    this.pricing = pricing
    return pricing
  }

  /**
   * Return a previously stored own-fold when the live pricing still matches.
   * Callers that already know the session is not live may skip a durable reread.
   * @param sessionId Durable session id.
   * @param config Live pricing. A different fingerprint clears the cache first.
   * @returns The cached own-fold, or undefined on a miss.
   */
  peek(sessionId: string, config: PricingConfig): CostFold | undefined {
    const pricing = this.alignPricing(config)
    const hit = this.entries.get(sessionId)
    if (hit === undefined || hit.pricing !== pricing) return undefined
    this.stats.hits += 1
    return hit.cost
  }

  /**
   * Return the cached own-fold or compute and store a new one.
   * @param sessionId Durable session id.
   * @param events Complete log used for the fingerprint and, on a miss, the fold.
   * @param config Live pricing. A different fingerprint clears the cache first.
   * @returns The session's own fold, never a parent-merged total.
   */
  fold(sessionId: string, events: readonly CostEvent[], config: PricingConfig): CostFold {
    const pricing = this.alignPricing(config)
    const log = logFingerprint(events)
    const hit = this.entries.get(sessionId)
    if (hit !== undefined && hit.pricing === pricing && hit.log === log) {
      this.stats.hits += 1
      return hit.cost
    }
    this.stats.misses += 1
    const cost = this.compute(events, config)
    this.entries.set(sessionId, { pricing, log, cost })
    return cost
  }

  /** Drop entries whose session is no longer in the listed corpus. */
  retain(sessionIds: Iterable<string>): void {
    const keep = new Set(sessionIds)
    for (const id of this.entries.keys()) {
      if (!keep.has(id)) this.entries.delete(id)
    }
  }
}
