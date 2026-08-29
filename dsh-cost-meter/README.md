# dsh-cost-meter

Configurable session API cost estimator for DeepSeek Harness. The conversation composer shows cumulative input, cache-read, cache-write, and output cost; the Plugins settings page edits pricing groups and per-model multipliers.

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
  groups:
    - id: default
      name: 默认
      input: 1
      output: 2
      cacheReadMultiplier: 0.02
      cacheWriteMultiplier: 1
      periods: []
      contextSurcharges: []
    - id: grok
      name: Grok
      input: 0.24
      output: 0.72
      cacheReadMultiplier: 0.25
      cacheWriteMultiplier: 0.25
      periods:
        - id: off-peak
          name: 低峰
          start: "00:00"
          end: "08:00"
          multiplier: 0.5
      contextSurcharges:
        - afterTokens: 200000
          multiplier: 2
  models:
    grok/grok-4.6:
      groupId: grok
      discountMultiplier: 1
      modelMultiplier: 1
      reasoningExtra: true
    wz/gpt-5.6-terra:
      groupId: grok
      discountMultiplier: 0.8
      modelMultiplier: 1
```

A pricing group holds the shared base: uncached input, output, cache-read multiplier, cache-write multiplier, time-window multipliers, and context surcharges. Cache-read and cache-write prices are `input ×` those multipliers. Periods use the configured IANA time zone, may cross midnight, and must not overlap within one group; a matching period multiplies every group rate.

The settings card lists groups, not the full catalog. Add a group, then add models into that group and edit each model's `discountMultiplier` and `modelMultiplier` (blank or omitted means 1). A model belongs to at most one group; moving it into another group takes it out of the previous one. Unassigned models use the group whose id is `default`, or the first group if that id is absent.

Final per-token price:

`group rate after period × discountMultiplier × modelMultiplier`

`contextSurcharges` then apply to that request. A request whose prompt-side context (`input + cacheRead + cacheWrite`) is greater than `afterTokens` multiplies that request's entire cost, including output, by `multiplier`. Among matching tiers the highest threshold wins. An empty group list means that group never surcharges. Output tokens do not count toward the threshold. The composer tooltip and session-detail table show the matched rule as `超过 200K ×2`. An hour that mixes charged and uncharged requests keeps `-` on the hour total and splits the model rows so the doubled requests stay visible.

A previous `default` / per-model absolute-rate document is accepted on read and rewritten as groups on the next save.

## Accounting

The Host taps `fetch` for `/chat/completions` and `/responses` during `llm.stream`. It copies `completion_tokens_details.reasoning_tokens` onto the official usage chunk before the harness writes the session log. Upstream status, headers, and body bytes are unchanged; the adapter is not patched.

The Host folds the session log in sequence order. Each `request/header` selects the actual provider/model for later usage in that request epoch. `assistant/chunk` and `assistant/message` usage reports use last-writer-wins for the same turn/step, matching the Harness token projection and preventing duplicate accounting. After the resolved group rates and model multipliers, a matching `contextSurcharge` multiplies that request's entire cost. A parent session's total includes every descendant session whose durable header identifies it as a subagent; each child log is folded once, so nested delegation is included without replaying a child through multiple parents. The composer modal first shows the current session. An explicit control then loads every durable session through `sessionCosts()` when the host exports it; if that endpoint is unavailable, the overview falls back to `session.list` plus concurrent per-session `sessionCost()` calls. The all-session view groups those independent hourly buckets by local date and hour, so expanding a period lists every matching session without inheriting a parent session's merged subagent totals.

The Host keeps an in-process cache of each session's own fold, keyed by a pricing fingerprint and a log fingerprint. A later all-session load reuses an unchanged historical session without rereading or refolding it, refolds a live or rewritten log, and drops deleted ids. A pricing edit invalidates every cached fold so retained history is revalued. The cache does not survive a host restart and does not persist a parent session's merged subagent total.

Token usage fields are disjoint:

- `inputTokens` uses `input`.
- `cacheReadTokens` uses `cacheRead`.
- `cacheWriteTokens` uses `cacheWrite`.
- `outputTokens` uses visible / `completion_tokens` output.

Set `reasoningExtra: true` on a model plan when the gateway reports `reasoningTokens` (or `completion_tokens_details.reasoning_tokens`) **in addition to** `outputTokens`. Fold then bills that reasoning count at the output rate. Leave the flag unset to add reasoning only when it is larger than `outputTokens`; set `false` when reasoning is already a subset of `outputTokens` (OpenAI / DeepSeek). Historical session logs that never stored `reasoningTokens` cannot be reconstructed.

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
| `src/pricing.ts` | Shared config validation, group/model resolution, and rate selection |
| `src/session-table.ts` | Session overview filter and sort helpers |
| `src/session-fold-cache.ts` | In-process own-fold cache keyed by pricing and log fingerprints |
| `src/index.ts` | Host settings namespace, session fold, and Remote service |
| `src/typert.host.ts` | Host wire manifest |
| `src/client.ts` | Composer cost line, current-session modal, all-session overview, and Plugins settings card |
| `cordis.patch.yml` | Host bundle row |

## Known Limitations and Deferred Work

- The result is an estimate from provider usage fields and configured prices, not a provider invoice.
- Price edits revalue retained history because no per-request pricing snapshot is appended to the session log.
- Models absent from the current catalog remain visible only when they already belong to a group; new dormant routes cannot be added by hand from the picker.
- The own-fold cache is process-local. A historical session rewritten on disk while it is not live stays cached until the next pricing change or host restart.
