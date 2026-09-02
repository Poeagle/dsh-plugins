/* dsh-cost-meter — host wire definitions.
 *
 * Hand-written in the official typert-loader manifest format (same shape as
 * the generated artifacts). The typert-loader registers this manifest into
 * the host typert registry on mount, so every DSH version recognizes the
 * costMeter endpoints. Do not edit without re-checking the loader validation
 * rules. */

import { z } from 'zod'

const PKG = 'dsh-cost-meter'

const zUnknown = z.unknown()
const zString = z.string()

const jsonResult = (method: string) => ({
  mode: 'strict' as const,
  typeSymbol: `${PKG}#${method}#result`,
  schema: zUnknown,
})

const strParam = (method: string, name: string) => ({
  name,
  wire: name,
  source: 'json' as const,
  codec: { mode: 'strict' as const, typeSymbol: `${PKG}#${method}#${name}`, schema: zString },
})

const inv = (method: string, parameters: ReturnType<typeof strParam>[]) => ({
  id: `${PKG}#costMeter/${method}`,
  service: 'costMeter',
  namespace: 'costMeter',
  method,
  invocation: { kind: 'direct' as const },
  parameters,
  result: jsonResult(method),
})

export const TYPERT = {
  package: PKG,
  face: 'host' as const,
  schemas: [],
  invocations: [
    inv('sessionCost', [strParam('sessionCost', 'sessionId')]),
    inv('sessionCosts', []),
    inv('providerBalances', []),
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}
