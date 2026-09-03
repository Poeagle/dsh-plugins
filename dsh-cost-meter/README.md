# dsh-cost-meter

Configurable session API cost estimator for DeepSeek Harness. The composer dock under the input card is one line of text for this session, today, and all-time totals; each total opens a detail modal. This-session cost refreshes every 5s without overlapping in-flight RPCs; today/all-time refresh every 30s. Remaining balance sits in the session header as one card per gateway origin. Each card shows the host on the first line, remaining balance and refresh time on the second, and opens that origin. Failed probes and rows without an origin are omitted. Settings live as their own left-nav page.

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

A pricing group holds the shared base: uncached input, output, cache-read multiplier, cache-write multiplier, time-window multipliers, and context surcharges. Cache-read and cache-write prices are `input ×` those multipliers. Periods use the configured IANA time zone, may cross midnight, and must not overlap within one group; a matching period multiplies every group rate. Optional `days` is ISO weekdays `1–7` (Monday–Sunday); omit it for every day. `start === end` covers the whole selected days; `end: "24:00"` is allowed.

The settings card lists groups, not the full catalog. Add a group, then add models into that group and edit each model's `discountMultiplier` and `modelMultiplier` (blank or omitted means 1). A model belongs to at most one group; moving it into another group takes it out of the previous one. Unassigned models use the group whose id is `default`, or the first group if that id is absent.

Final per-token price:

`group rate after period × discountMultiplier × modelMultiplier`

`contextSurcharges` then apply to that request. A request whose prompt-side context (`input + cacheRead + cacheWrite`) is greater than `afterTokens` multiplies that request's entire cost, including output, by `multiplier`. Among matching tiers the highest threshold wins. An empty group list means that group never surcharges. Output tokens do not count toward the threshold. The composer tooltip and session-detail table show the matched rule as `超过 200K ×2`. An hour that mixes charged and uncharged requests keeps `-` on the hour total and splits the model rows so the doubled requests stay visible.

A previous `default` / per-model absolute-rate document is accepted on read and rewritten as groups on the next save.

## Accounting

The Host taps `fetch` for `/chat/completions` and `/responses` during `llm.stream` and during `preparedCall.stream` from `llm.prepareCall`. The agent loop dispatches the latter; wrapping only `llm.stream` leaves grok reasoning off the session log. It copies `completion_tokens_details.reasoning_tokens` onto the official usage chunk before the harness writes the session log. Upstream status, headers, and body bytes are unchanged; the adapter is not patched.

The Host folds the session log in sequence order. Each `request/header` selects the actual provider/model for later usage in that request epoch. `assistant/chunk` and `assistant/message` usage reports use last-writer-wins for the same turn/step, matching the Harness token projection and preventing duplicate accounting. After the resolved group rates and model multipliers, a matching `contextSurcharge` multiplies that request's entire cost. A parent session's total includes every descendant session whose durable header identifies it as a subagent; each child log is folded once, so nested delegation is included without replaying a child through multiple parents. The session header shows three chips: this session (own fold plus descendant subagents), today, and all-time. Under those chips the Host reads Sub2API-compatible `/v1/usage` once per gateway origin, trying each configured credential on that origin until one succeeds. Providers that share a host appear as one chip. A failed origin is omitted. Clicking a cost chip opens a centered table; clicking a balance chip opens that origin. Date view collapses one local date into a summary row; model view collapses one `provider/model`. Parent rows keep only group-level columns. Expanding a summary opens a nested detail table whose columns sort and filter independently. Input, cache, output, and a usage total each share one cell: token count, cost, and average unit price. Today and history load every durable session through `sessionCosts()` when the host exports it; if that endpoint is unavailable, the overview falls back to `session.list` plus concurrent per-session `sessionCost()` calls. Those views do not inherit a parent session's merged subagent totals.

The Host keeps an in-process cache of each session's own fold, keyed by a pricing fingerprint and a log fingerprint. Concurrent `sessionCost` and `sessionCosts` calls for the same work share one in-flight computation. A later all-session load reuses an unchanged historical session without rereading or refolding it, refolds a live or rewritten log, and drops deleted ids. A pricing edit invalidates every cached fold so retained history is revalued; updating `lastProbedAt` without a rate change does not. The cache does not survive a host restart and does not persist a parent session's merged subagent total.

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
| `src/provider-balance.ts` | Per-provider `/v1/usage` remaining-balance probe and `/v1/models` availability |
| `src/client.ts` | Session-header cost chips, live provider balances, session/today/history modals, and the Settings left-nav page |
| `cordis.patch.yml` | Host bundle row |

## Known Limitations and Deferred Work

- The result is an estimate from provider usage fields and configured prices, not a provider invoice.
- Automatic upstream billing discovery is opt-in. It reads the Sub2API-compatible `/v1/sub2api/billing` endpoint once per `llm-pi-ai` provider id, not once per model, using that provider's configured Base URL and credential reference, resolved on every run so a late-attaching credentials service is visible. Each successful probe overwrites `lastProbedAt`; the live `discountMultiplier` and its effective-time history change only when the observed value differs. Failed probes retry on the next minute instead of waiting out the success interval. The settings page shows that latest update time under the model. It never stores the probe-time `effective_rate_multiplier`; configured pricing periods remain responsible for peak windows.
- The same per-provider poll also GETs `/v1/models`. When that request is not successful and that credential's `/v1/usage` still reports a remaining balance greater than zero, the plugin unsets the provider from `llm-pi-ai.providers` and unsets every `cost-meter` model route owned by that provider id. A down API with a zero or unknown balance is left in place.
- Each usage event is valued with the multiplier history entry whose `effectiveAt` is at or before the event timestamp. A newly observed value can only apply from the observation time onward; the plugin cannot infer the upstream's earlier change time.
- Price edits revalue retained history because no per-request pricing snapshot is appended to the session log.
- Models absent from the current catalog remain visible only when they already belong to a group; new dormant routes cannot be added by hand from the picker.
- The own-fold cache is process-local. A historical session rewritten on disk while it is not live stays cached until the next pricing change or host restart.
