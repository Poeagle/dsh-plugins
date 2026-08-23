# dsh-cost-meter

Configurable session API cost estimator for DeepSeek Harness. The conversation composer shows cumulative input, cache-read, cache-write, and output cost; the Plugins settings page edits default pricing and provider/model overrides.

## Install

```sh
dsh plugin --profile web add /path/to/this-directory
```

Restart `dsh` after installing or rebuilding the plugin. The browser loads `lib/client.js`, not `src/client.ts`.

## Configuration

The Host registers the live `cost-meter` settings namespace. Prices use `currency` per `unitTokens` tokens; the shipped base is CNY per one million tokens.

```yaml
cost-meter:
  currency: CNY
  unitTokens: 1000000
  timezone: Asia/Shanghai
  default:
    rates:
      input: 1
      cacheRead: 0.02
      cacheWrite: 1
      output: 2
    periods: []
    contextSurcharges: []
  models:
    deepseek-official/deepseek-v4-flash:
      rates:
        input: 0.8
        output: 1.8
      periods:
        - id: off-peak
          name: 低峰
          start: "00:00"
          end: "08:00"
          rates:
            input: 0.4
            output: 0.9
      contextSurcharges:
        - afterTokens: 200000
          multiplier: 2
```

The UI lists every model in the live `llm.models` catalog. A model without an override uses default pricing. Each rate resolves independently in this order: matching model period, model base rate, matching default period, default base rate. Periods use the configured IANA time zone, may cross midnight, and must not overlap within one plan.

`contextSurcharges` apply after the base rates. A request whose prompt-side context (`input + cacheRead + cacheWrite`) is greater than `afterTokens` multiplies that request's entire cost, including output, by `multiplier`. Among matching tiers the highest threshold wins. A model list, including an empty list, replaces the default list instead of merging with it. Output tokens do not count toward the threshold. The composer tooltip and session-detail table show the matched rule as `超过 200K ×2`.

## Accounting

The Host folds the session log in sequence order. Each `request/header` selects the actual provider/model for later usage in that request epoch. `assistant/chunk` and `assistant/message` usage reports use last-writer-wins for the same turn/step, matching the Harness token projection and preventing duplicate accounting. After the resolved rates, a matching `contextSurcharge` multiplies that request's entire cost. A parent session's total includes every descendant session whose durable header identifies it as a subagent; each child log is folded once, so nested delegation is included without replaying a child through multiple parents. The composer modal first shows the current session. An explicit control then loads every durable session through `sessionCosts()` when the host exports it; if that endpoint is unavailable, the overview falls back to `session.list` plus concurrent per-session `sessionCost()` calls. The all-session view groups those independent hourly buckets by local date and hour, so expanding a period lists every matching session without inheriting a parent session's merged subagent totals.

The Host keeps an in-process cache of each session's own fold, keyed by a pricing fingerprint and a log fingerprint. A later all-session load reuses an unchanged historical session without rereading or refolding it, refolds a live or rewritten log, and drops deleted ids. A pricing edit invalidates every cached fold so retained history is revalued. The cache does not survive a host restart and does not persist a parent session's merged subagent total.

Token usage fields are disjoint:

- `inputTokens` uses `input`.
- `cacheReadTokens` uses `cacheRead`.
- `cacheWriteTokens` uses `cacheWrite`.
- `outputTokens` uses `output`.

The estimate is recalculated from the current pricing configuration. Changing prices therefore changes the displayed estimate for retained historical usage; this plugin does not claim invoice reconciliation.

## Build and test

```sh
npm run build
npm test
```

`src/` is the source of truth and `lib/` is generated output.

## Layout

| Path | Role |
| --- | --- |
| `src/pricing.ts` | Shared config validation, time-window matching, and rate resolution |
| `src/session-table.ts` | Session overview filter and sort helpers |
| `src/session-fold-cache.ts` | In-process own-fold cache keyed by pricing and log fingerprints |
| `src/index.ts` | Host settings namespace, session fold, and Remote service |
| `src/typert.host.ts` | Host wire manifest |
| `src/client.ts` | Composer cost line, current-session modal, all-session overview, and Plugins settings card |
| `cordis.patch.yml` | Host bundle row |

## Known Limitations and Deferred Work

- The result is an estimate from provider usage fields and configured prices, not a provider invoice.
- Price edits revalue retained history because no per-request pricing snapshot is appended to the session log.
- Models absent from the current catalog remain editable only when they already have an override; new dormant routes cannot be added by hand in the settings card.
- The own-fold cache is process-local. A historical session rewritten on disk while it is not live stays cached until the next pricing change or host restart.
