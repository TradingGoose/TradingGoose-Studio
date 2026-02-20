# Indicator Trigger API (TODO)

## Goal
Define indicator script trigger API:
`trigger('event_name', options)`.

This must integrate with existing workflow trigger infrastructure and be directly usable as implementation instructions.

## Verified Current Constraints
1. `trigger(...)` is not available in the current `pinets` package/runtime.
- indicator execution currently only runs `new Indicator(code, inputs)`:
  - `apps/tradinggoose/lib/indicators/run-pinets.ts`
  - `apps/tradinggoose/lib/indicators/execution/e2b-script-builder.ts`
- current runtime paths have no trigger bridge wiring yet:
  - no `trigger(...)` interception/bootstrap in `runPineTS` path before `pine.run(...)`
  - local VM executor does not inject realm sentinel `globalThis.trigger` before evaluating indicator function
  - E2B script builder does not inject trigger bridge bootstrap/sentinel setup before indicator evaluation
- `trigger(...)` support must be implemented as a TradingGoose-Studio runtime extension (local + E2B), not as an upstream PineTS dependency.
2. Indicator normalized output currently includes `series`, `markers`, `signals`, `unsupported`, `indicator` only.
- `apps/tradinggoose/lib/indicators/types.ts`
- `apps/tradinggoose/lib/indicators/normalize-context.ts`
3. Category trigger blocks resolve trigger identity from block type in current stores/hooks.
- `apps/tradinggoose/stores/workflows/subblock/store.ts`
- `apps/tradinggoose/hooks/use-webhook-management.ts`
- `apps/tradinggoose/hooks/use-trigger-config-aggregation.ts`
4. Tag dropdown path generation for category trigger blocks uses block output paths (not trigger-mode resolution).
- `apps/tradinggoose/components/ui/tag-dropdown.tsx`
- `apps/tradinggoose/lib/workflows/block-outputs.ts`
5. Runtime throws in indicator execution are converted to failed compile output.
- `apps/tradinggoose/lib/indicators/custom/compile.ts`
6. Editor typings/docs currently expose `indicator(...)` but not `trigger(...)`.
- `scripts/generate-pine-cheat-sheet.cjs`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet.ts`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-typings.ts`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-members.ts`
7. `pinets` package is consumed from different package roots:
- runtime path depends on `apps/tradinggoose/package.json`
- cheat-sheet generator reads root `node_modules/pinets` via `scripts/generate-pine-cheat-sheet.cjs`
- root and app `pinets` versions must stay aligned to avoid runtime/editor drift
- current branch status: aligned (`package.json` + `apps/tradinggoose/package.json` are `^0.8.8`, lock resolves `pinets@0.8.8`)
8. Existing Logs page already provides the target split-panel interaction model.
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/logs.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/logs-list/logs-list.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/log-details/log-details.tsx`
9. Logs Monitors surface is not present yet in current stack:
- logs filter store view mode is still `logs|dashboard` (no `monitors`)
- logs filter store still initializes/syncs 2-state view handling (`logs|dashboard`)
- logs page header/view handling is still 2-state
- dashboard controls view handling is still 2-state (`logs|dashboard`)
- `/api/logs` does not expose monitor filter params
- `/api/logs/export` does not expose monitor filter params
- `/api/v1/logs` filter parser has no monitor filter support
- logs query parser has no monitor filter fields for monitor metadata
- logs query hook does not serialize monitor filter query params
- `apps/tradinggoose/stores/logs/filters/types.ts`
- `apps/tradinggoose/stores/logs/filters/store.ts`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/logs.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/dashboard/components/controls.tsx`
- `apps/tradinggoose/app/api/logs/route.ts`
- `apps/tradinggoose/app/api/logs/export/route.ts`
- `apps/tradinggoose/app/api/v1/logs/route.ts`
- `apps/tradinggoose/app/api/v1/logs/filters.ts`
- `apps/tradinggoose/lib/logs/query-parser.ts`
- `apps/tradinggoose/hooks/queries/logs.ts`
10. Existing webhook table already supports monitor config storage (`providerConfig` + `isActive` + unique `path`).
- `packages/db/schema.ts`
11. PineTS transpiles unknown function calls (including `trigger(...)`) through `$.call(fn, id, ...args)`, which is interceptable from Studio runtime.
- `../PineTS/src/transpiler/transformers/ExpressionTransformer.ts`
- `../PineTS/src/Context.class.ts`
12. External webhook-facing routes currently do not enforce full internal-only safeguards for `provider = 'indicator'`.
- `/api/webhooks/trigger/[path]` currently parses request body before webhook lookup/guard, so indicator-provider short-circuit cannot run pre-parse
- `/api/webhooks/test/[id]` currently runs parse/challenge/token/auth/rate checks and then queues execution for the resolved webhook id
- `/api/webhooks/[id]/test-url` currently allows minting test URLs for permitted webhook ids without indicator-provider deny rule
- `/api/webhooks/test?id=<webhookId>` currently has no session/permission check and returns test URL with `foundWebhook.path` in response payload
- generic webhook CRUD currently accepts/returns arbitrary providers, so indicator rows can be created/updated/read via `/api/webhooks` and `/api/webhooks/[id]` unless explicitly guarded
- this violates the required internal-only contract for indicator monitor webhooks
- `apps/tradinggoose/app/api/webhooks/trigger/[path]/route.ts`
- `apps/tradinggoose/app/api/webhooks/test/[id]/route.ts`
- `apps/tradinggoose/app/api/webhooks/[id]/test-url/route.ts`
- `apps/tradinggoose/app/api/webhooks/test/route.ts`
- `apps/tradinggoose/app/api/webhooks/route.ts`
- `apps/tradinggoose/app/api/webhooks/[id]/route.ts`
- `apps/tradinggoose/lib/webhooks/processor.ts`
13. Internal dispatch contracts are HTTP-bound in current code:
- `checkRateLimits(...)` and `checkUsageLimits(...)` return `NextResponse | null`
- `queueWebhookExecution(...)` requires `NextRequest` and derives headers from request only
- internal runtime/manual dispatch cannot use current interfaces without refactor
- until refactor is complete, manual execute dispatch and socket monitor runtime dispatch are blocked from using these APIs as-is
- this is a hard implementation dependency (step `3`), not optional cleanup/refactor debt
- `apps/tradinggoose/lib/webhooks/processor.ts`
14. `indicator_trigger` is not registered yet in current trigger/block registries.
- `apps/tradinggoose/triggers/registry.ts`
- `apps/tradinggoose/blocks/registry.ts`
15. Existing trigger subblock helper is webhook-coupled and incompatible with `indicator_trigger` requirements:
- `buildTriggerSubBlocks(...)` injects `webhookUrlDisplay` (`short-input`) + `trigger-save`
- `short-input` and `trigger-save` paths use webhook management hooks/components
- current webhook-coupled paths call `useWebhookManagement`, which reads/writes through generic `/api/webhooks` APIs and is therefore incompatible with indicator-monitor internal-only contracts
- `apps/tradinggoose/triggers/index.ts`
- `apps/tradinggoose/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/short-input.tsx`
- `apps/tradinggoose/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/trigger-save/trigger-save.tsx`
- `apps/tradinggoose/hooks/use-webhook-management.ts`
16. Socket-server currently does not expose monitor runtime control-plane endpoint (`POST /internal/indicator-monitors/reconcile`) and `/health` only reports basic server status.
- `apps/tradinggoose/socket-server/routes/http.ts`
17. Global lock helper currently fail-opens when Redis client is unavailable (`acquireLock(...)` returns `true`), which is incompatible with monitor-runtime fail-closed policy.
- `apps/tradinggoose/lib/redis.ts`
18. Execution log completion currently overwrites `executionData` and drops start-time trigger metadata:
- start path writes `executionData.trigger` in `safeStart(...)`
- completion path currently replaces `executionData` with trace/output/cost payload
- monitor metadata filtering after completion is unreliable until completion path is changed to merge-preserve trigger metadata
- `apps/tradinggoose/lib/logs/execution/logger.ts`
19. Editor Pine typings/member files are generated artifacts:
- `pine-cheat-sheet-typings.ts` and `pine-cheat-sheet-members.ts` are overwritten by `scripts/generate-pine-cheat-sheet.cjs`
- manual edits to generated files are not durable and must not be used for `trigger(...)` API exposure
- generator logic must be updated, then regenerated outputs committed
- `scripts/generate-pine-cheat-sheet.cjs`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-typings.ts`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-members.ts`
20. Existing socket-server workflow/control-plane notification endpoints are currently unauthenticated (`/api/workflow-deleted`, `/api/workflow-updated`, `/api/workflow-reverted`, `/api/copilot-workflow-edit`), and currently existing in-repo callers for these notifications (workflow delete + workflow revert) are headerless.
- `apps/tradinggoose/socket-server/routes/http.ts`
- `apps/tradinggoose/app/api/workflows/[id]/route.ts`
- `apps/tradinggoose/app/api/workflows/[id]/deployments/[version]/revert/route.ts`
21. Current indicator verify route rejects trigger-only scripts:
- when `plotsCount === 0 && markersCount === 0 && signalsCount === 0`, route returns `400` `invalid_output` regardless of trigger usage
- trigger-first verify contract in this plan requires explicit behavior change to success + warning for trigger-only scripts
- `apps/tradinggoose/app/api/indicators/verify/route.ts`

## Non-Negotiable Compatibility Rules
1. Use one ID everywhere: `indicator_trigger`.
2. For category trigger block:
- block type = `indicator_trigger`
- trigger registry id = `indicator_trigger`
- `providerConfig.triggerId = 'indicator_trigger'`
3. Trigger output schema must be tag-path compatible:
- no leaf `{ type: 'object' }` where nested paths are expected.
4. `trigger(...)` option validation must be non-throwing.
5. Non-trigger script/runtime exceptions continue to fail indicator compile output.
6. Root and app `pinets` dependency versions must resolve to the same build before implementation (current branch: satisfied; keep enforced).
7. `indicator_trigger` registry entry must use `provider: 'indicator'`.
8. Monitor configuration is webhook-backed only:
- no `indicator_monitor_configs` table
- no `indicator_monitor_auth_profiles` table
9. `trigger(...)` support is Studio-owned:
- do not block implementation on upstream PineTS changes
- do not require `../PineTS` edits for this feature plan
- treat upstream `pinets` package as immutable for this feature; implement via Studio runtime/editor extension layers
10. `trigger(...)` runtime capture must be stable and deterministic:
- do not rely on environment-provided globals (for example Bun `alert`) for trigger semantics
- normalize trigger call arguments immediately (using runtime context access) and never persist raw mutable `Series` references
11. Trigger bridge must be runtime-realm safe:
- local host realm, local VM realm (when used), and E2B realms must each install their own `trigger` sentinel before indicator code evaluation
- interception must not rely on a single-process global function identity only
12. `indicator_trigger` registration is mandatory before indicator-specific monitor API/UI work:
- trigger must exist in `TRIGGER_REGISTRY`
- block must exist in block registry
- `indicator_trigger` must not reuse webhook-coupled trigger helper plumbing (`buildTriggerSubBlocks(...)`, `short-input`, `trigger-save`, `webhookUrlDisplay`)
- applies to monitor APIs and indicator monitor UI flows (steps `12`, `14`, `15`)
- does not block generic Logs 3-mode foundation refactor work in step `8` (store/view URL/view-mode groundwork without indicator monitor mutations)
13. Editor typings/members generation contract is mandatory:
- do not manually edit generated cheat-sheet output files
- update `scripts/generate-pine-cheat-sheet.cjs` to append Studio-owned `trigger(...)` declarations
- regenerate and commit generated outputs from the script
- `trigger(...)` feature usage is blocked until both step `9` (runtime extraction) and step `20` (generated editor exposure) are implemented and validated
14. Provider-specific external compatibility flows for existing non-indicator triggers are preserved in this plan.
- this explicitly includes existing Microsoft Graph `validationToken` token-echo behavior on both `GET` and `POST` paths for non-indicator webhook providers
15. Indicator monitor auth must follow secure storage + response contracts:
- monitor auth stores encrypted provider secret fields only (`encryptedSecrets` by provider auth param id)
- never persist plaintext secret/token/api-key values in `providerConfig.monitor.auth`
- monitor APIs accept write-only secret input keyed by provider auth param ids, encrypt before persistence, and store ciphertext only
- monitor APIs must redact auth in responses (no plaintext or ciphertext secret values returned)
16. Resolved policy decision for this plan:
- AGENTS no-legacy rules apply without exception in this plan scope
- preserve existing provider-specific compatibility behavior for non-indicator webhook providers on `/api/webhooks/trigger/[path]`
- indicator webhook rows must not use provider-specific compatibility short-circuit paths
- no external approval gate branching is used in this document
- any future compatibility proposal requires a separate design document and is not part of this plan

## PineTS Trigger Bridge Contract (Studio-Owned)
Use a Studio-owned bridge that captures `trigger(...)` without modifying upstream PineTS package code.

Mechanics:
1. Use one fixed sentinel marker key across all realms:
   - `const TG_INDICATOR_TRIGGER_SENTINEL = '__tg_indicator_trigger__'`
2. For each execution realm, register a realm-local sentinel function on that realm `globalThis.trigger` and mark it with the sentinel marker key.
- local runtime (required): inject into host realm `globalThis` before `pine.run(...)` / transpiled indicator evaluation
- local VM wrapper path (when used): inject into VM context global before `Script.runInContext(...)` result is executed (supplemental only; host-realm sentinel is still required)
- E2B/runtime hosts: inject into that realm global before indicator evaluation
3. Patch `Context.prototype.call` once (idempotent) in Studio runtime bootstrap.
4. Intercept only when trigger sentinel matches:
- `fn === realmGlobalThis.trigger` OR
- sentinel marker exists on function (for cross-realm identity-safe matching)
- otherwise delegate to original `Context.prototype.call`
5. In intercept path, use current `Context` instance (`this`) to resolve arguments:
- `event = this.get(eventArg, 0)`
- `options = this.get(optionsArg, 0) ?? {}`
- `condition = Boolean(this.get(options.condition, 0))`
- `signal = this.get(options.signal, 0)`
- `input = this.get(options.input, 0)`
- runtime bar metadata from context (`idx`, `openTime`)
6. Normalize to plain JSON-safe values immediately and push to execution-local collector.
7. Collector isolation must use `AsyncLocalStorage` so concurrent executions cannot share trigger buffers.
8. Bridge must be applied in both local runtime and E2B runtime to guarantee parity.
9. Trigger validation remains non-throwing:
- invalid call shapes are dropped with warning
- non-trigger runtime exceptions still fail compile output as today.

Out-of-scope behavior:
1. Do not use PineTS `alert(...)` as trigger transport (environment-dependent global behavior).
2. Do not depend on PineTS `alertcondition(...)` runtime side effects (currently no-op).

## Public Script API
```ts
type TriggerMarkerPosition = 'aboveBar' | 'belowBar' | 'inBar'
type IndicatorTriggerSignal = 'long' | 'short' | 'flat'
type IndicatorTriggerCondition = unknown

type IndicatorTriggerOptions = {
  condition: IndicatorTriggerCondition
  input: string
  signal: IndicatorTriggerSignal
  position?: TriggerMarkerPosition
  color?: string
}

declare const trigger: (
  event: string,
  options: IndicatorTriggerOptions
) => void
```

## API Rules
1. `event` is required and must match `^[a-z][a-z0-9_]{0,63}$`.
2. `options` is required.
3. `condition` is required expression and is runtime-coerced per bar:
- resolve with runtime context getter: `resolved = context.get(options.condition, 0)`
- emit when `Boolean(resolved) === true`
- do not emit when `Boolean(resolved) === false`
- if resolution/coercion fails, drop call with warning (non-throw)
4. Coercion semantics above apply to both local and E2B runtimes and cover Pine series values (for example `close > open`, `ta.crossover(...)`) in immutable-PineTS Studio extension mode.
5. `input` is required (workflow primary text input).
6. `signal` is required and one of `long` | `short` | `flat`.
7. Marker options are optional:
- `position` default: `aboveBar`
- `color` optional valid color string
8. `triggerMarker.text` always equals `event`.
9. Script API does not accept `value`, `data`, `eventId`, or `dedupeKey`.

## Script Example
```ts
const fast = ta.ema(close, 9)
const slow = ta.ema(close, 21)

trigger('ma_cross', {
  condition: ta.crossover(fast, slow),
  input: 'MA cross long, consider long option',
  signal: 'long',
  position: 'aboveBar',
  color: '#00ff00',
})
```

## Canonical Payload
```ts
type IndicatorWorkflowTriggerPayload = {
  input: string
  event: string
  eventId: string
  time: number // unix seconds
  signal: 'long' | 'short' | 'flat'
  triggerMarker: NormalizedPineMarker
  marketSeries: MarketSeries
  indicator: {
    id: string
    name: string
    barIndex: number
    settings: {
      inputs: Record<string, unknown>
      options?: Record<string, unknown>
      interval?: string
      intervalMs?: number
      listingKey?: string
    }
    output: NormalizedPineOutput
  }
  monitor: {
    id: string
    workflowId: string
    blockId: string
    listing: ListingIdentity
    providerId: string
    interval: string
    indicatorId: string
  }
  trigger: {
    provider: 'indicator'
    source: 'indicator_trigger'
    executionId: string
    emittedAt: string
  }
}
```

## Timestamp Unit Contract
1. Internal execution bars remain milliseconds:
- `BarMs.openTime` / `BarMs.closeTime`
- `latestBarOpenTimeMs`
- `barBucketMs`
2. Trigger candidate and payload timestamps are unix seconds:
- `candidate.time`
- `payload.time`
- `payload.triggerMarker.time`
- normalized indicator output times (`series.points[].time`, marker `time`)
3. Conversion point is explicit:
- derive `latestBarOpenTimeSec = Math.floor(latestBarOpenTimeMs / 1000)` before latest-bar candidate filtering and dispatch comparison
4. Never compare second-based candidate/payload times directly against millisecond bar times.

## Trigger Registration + Block Model
1. Register trigger config with id `indicator_trigger` in:
- `apps/tradinggoose/triggers/registry.ts`
- `apps/tradinggoose/triggers/index.ts`
2. Add category trigger block with type `indicator_trigger` in:
- `apps/tradinggoose/blocks/registry.ts`
- `apps/tradinggoose/blocks/blocks/*` (new block)
3. For this block, define `block.outputs` directly (or shared constant mirrored to block + trigger registry) to satisfy current tag-dropdown behavior for category triggers.
4. `indicator_trigger` is a special category trigger block and does not follow generic-webhook subblock plumbing.
 - do not use `buildTriggerSubBlocks(...)` for `indicator_trigger`
 - do not reuse webhook-coupled `short-input`/`trigger-save` component paths from generic trigger plumbing
 - this is a hard implementation dependency for `indicator_trigger`, not optional UI cleanup
5. `indicator_trigger` subblocks must not include webhook-management controls:
- no `trigger-save` subblocks
- no `webhookUrlDisplay` subblock id
- no `short-input` subblocks (to avoid implicit webhook management coupling)
- no editable trigger auth/path/provider fields
6. Block subblocks are guidance-only and may include read-only `text` to route users to Logs `Monitors`.
7. Guidance subblocks must never create/update/delete monitor webhook rows.
8. Workflow editor for `indicator_trigger` must not call `useWebhookManagement`; monitor webhook rows are managed only from monitor APIs/UI.
9. Do not use `buildTriggerSubBlocks(...)` from `apps/tradinggoose/triggers/index.ts` for `indicator_trigger`.
10. `indicator_trigger` subblocks must be defined as dedicated non-webhook-coupled config in the block definition.

## Trigger Outputs (Tag-Compatible)
Use nested output fields so required tag paths are resolvable:

```ts
{
  input: { type: 'string', description: 'Primary workflow text input.' },
  event: { type: 'string', description: 'Event key passed to trigger(...).' },
  eventId: { type: 'string', description: 'Generated event identifier.' },
  time: { type: 'number', description: 'Bar time in unix seconds.' },
  signal: { type: 'string', description: 'Signal: long, short, flat.' },
  triggerMarker: {
    text: { type: 'string', description: 'Marker label text (event).' },
    position: { type: 'string', description: 'Marker position.' },
    shape: { type: 'string', description: 'Marker shape.' },
    color: { type: 'string', description: 'Marker color.' },
    time: { type: 'number', description: 'Marker time in unix seconds.' }
  },
  marketSeries: {
    listingBase: { type: 'string', description: 'Listing base symbol.' },
    listingQuote: { type: 'string', description: 'Listing quote symbol.' },
    marketCode: { type: 'string', description: 'Market code.' },
    start: { type: 'string', description: 'Series start timestamp.' },
    end: { type: 'string', description: 'Series end timestamp.' },
    timezone: { type: 'string', description: 'Series timezone.' },
    normalizationMode: { type: 'string', description: 'Normalization mode.' },
    bars: { type: 'array', description: 'Market bars array.' }
  },
  indicator: {
    id: { type: 'string', description: 'Indicator id.' },
    name: { type: 'string', description: 'Indicator name.' },
    barIndex: { type: 'number', description: 'Bar index where event emitted.' },
    settings: {
      inputs: { type: 'object', description: 'Resolved indicator inputs.' },
      options: { type: 'object', description: 'Resolved indicator options.' },
      interval: { type: 'string', description: 'Execution interval.' },
      intervalMs: { type: 'number', description: 'Execution interval ms.' },
      listingKey: { type: 'string', description: 'Execution listing key.' }
    },
    output: {
      series: { type: 'array', description: 'Normalized series output.' },
      markers: { type: 'array', description: 'Normalized markers output.' },
      signals: { type: 'array', description: 'Normalized signals output.' },
      unsupported: { type: 'object', description: 'Unsupported output metadata.' },
      indicator: { type: 'object', description: 'Indicator options in output.' }
    }
  },
  monitor: {
    id: { type: 'string', description: 'Monitor id (equals internal webhook id).' },
    workflowId: { type: 'string', description: 'Target workflow id.' },
    blockId: { type: 'string', description: 'Target indicator trigger block id.' },
    listing: {
      listing_id: { type: 'string', description: 'Listing id for default listings.' },
      base_id: { type: 'string', description: 'Base id for pair listings.' },
      quote_id: { type: 'string', description: 'Quote id for pair listings.' },
      listing_type: {
        type: 'string',
        description: 'Listing type: default | crypto | currency.'
      }
    },
    providerId: { type: 'string', description: 'Market provider id.' },
    interval: { type: 'string', description: 'Monitor interval.' },
    indicatorId: { type: 'string', description: 'Indicator id used for monitoring.' }
  },
  trigger: {
    provider: { type: 'string', description: 'Trigger provider id.' },
    source: { type: 'string', description: 'Trigger source id.' },
    executionId: { type: 'string', description: 'Execution id.' },
    emittedAt: { type: 'string', description: 'Emit timestamp ISO.' }
  }
}
```

Expected tag paths:
- `<triggerBlock.event>`
- `<triggerBlock.input>`
- `<triggerBlock.signal>`
- `<triggerBlock.triggerMarker.text>`
- `<triggerBlock.triggerMarker.position>`
- `<triggerBlock.marketSeries.bars>`
- `<triggerBlock.indicator.settings.inputs>`
- `<triggerBlock.indicator.output.series>`
- `<triggerBlock.indicator.output.markers>`
- `<triggerBlock.monitor.listing.listing_type>`
- `<triggerBlock.monitor.providerId>`

## Webhook-Backed Monitor Storage Contract
A monitor config is a webhook row with `provider = 'indicator'`.

```ts
type IndicatorMonitorAuthStored = {
  encryptedSecrets?: Record<string, string> // key: provider auth param id, value: ciphertext
  secretVersion?: 1
}

type IndicatorMonitorAuthPublic = {
  hasEncryptedSecrets?: boolean
  encryptedSecretFieldIds?: string[]
}

type IndicatorWebhookProviderConfig = {
  triggerId: 'indicator_trigger'
  version: 1
  monitor: {
    providerId: string
    interval: string
    listing: ListingIdentity
    indicatorId: string
    auth?: IndicatorMonitorAuthStored
    providerParams?: Record<string, unknown>
  }
}

type IndicatorWebhookProviderConfigPublic = Omit<IndicatorWebhookProviderConfig, 'monitor'> & {
  monitor: Omit<IndicatorWebhookProviderConfig['monitor'], 'auth'> & {
    auth?: IndicatorMonitorAuthPublic
  }
}

type IndicatorMonitorRecord = {
  monitorId: string // alias of webhook.id
  workflowId: string // webhook.workflowId
  blockId: string // webhook.blockId
  isActive: boolean // webhook.isActive
  providerConfig: IndicatorWebhookProviderConfigPublic
  createdAt: string
  updatedAt: string
}
```

Rules:
1. `monitorId` is `webhook.id` (no separate monitor id table).
2. `webhook.path` is deterministic and immutable: `indicator-monitor-{monitorId}`.
3. All monitor runtime settings live in `webhook.providerConfig.monitor`.
4. `listingKey` is never persisted in `webhook.providerConfig.monitor`; runtime derives keys from `monitor.listing` when needed.
5. Auth storage contract for indicator monitors:
- plaintext secret fields (for example `apiKey`, `apiSecret`, `token`, `password`) are forbidden in persisted monitor auth
- monitor APIs accept write-only secret values keyed by provider auth param ids, encrypt each value before persistence, and store ciphertext only under `auth.encryptedSecrets[paramId]`
- providers that require multiple secret params must persist all required secret param ids through encrypted write-only secret inputs before save succeeds
6. Provider non-secret runtime options are stored in `providerConfig.monitor.providerParams`.
7. Monitor API response redaction contract:
- never return plaintext secret values
- never return encrypted ciphertext values
- return only safe auth metadata in response shape (`hasEncryptedSecrets`, `encryptedSecretFieldIds`)
8. `webhookId` is internal plumbing only and is never exposed in UX labels.
9. Auth edits update the same webhook row in place; no workflow redeploy is required.
10. Monitor APIs persist monitor rows directly (typed monitor API path), not through generic `/api/webhooks` POST.
11. Generic webhook CRUD APIs must not manage `provider = 'indicator'` rows:
- `POST /api/webhooks` must reject `provider = 'indicator'` with `403`
- `PATCH /api/webhooks/[id]` must reject when target webhook provider is `indicator` with `403`
- `DELETE /api/webhooks/[id]` must reject when target webhook provider is `indicator` with `403`
- `GET /api/webhooks` must exclude `provider = 'indicator'` rows in both list branches:
- branch `workflowId + blockId`
- default user-owned list branch
- `GET /api/webhooks/[id]` must return `404` when target webhook provider is `indicator`
11. Indicator monitor webhooks are internal-only triggers:
- they must never be executed from public external webhook HTTP requests
- they are dispatched only by trusted internal paths (manual execute + socket runtime)
12. `webhook.path` is internal plumbing only:
- monitor list/detail APIs must not expose `webhook.path`
- monitor UI must not display or serialize `webhook.path`
13. External webhook route safeguards are mandatory:
- `POST /api/webhooks/trigger/[path]` must reject `provider = 'indicator'` with `403`
- canonical POST branch order for `/api/webhooks/trigger/[path]` is fixed (single source of truth):
  1. resolve webhook-by-path first
  2. apply indicator-provider guard before request body parse
- no alternative branch order is allowed anywhere else in this plan
- rejected indicator requests must not reach queue/execute stages
- required standard POST route order (applies to all POST requests):
  1. resolve webhook + workflow by `path`
  2. if not found -> `404`
  3. if `webhook.provider === 'indicator'` -> `403`
  4. for non-indicator providers, run provider-specific compatibility short-circuit handling (if applicable) after resolve + indicator guard
  5. parse request body for non-indicator providers when compatibility short-circuit did not return
  6. run provider challenge handling for non-indicator providers
  7. run provider auth verification
  8. run rate/usage/deployment checks
  9. queue execution
- provider-specific compatibility behavior (for example existing Microsoft Graph `validationToken` token-echo flow on `GET` and `POST`) remains supported for non-indicator providers and must not be removed by this feature.
 - indicator-provider requests must never execute compatibility short-circuit behavior because guard step `3` returns `403` first.
14. Test webhook routes must enforce the same internal-only rule:
- `/api/webhooks/test/[id]` must reject `provider = 'indicator'` with `403`
- canonical POST route order for `/api/webhooks/test/[id]` is fixed:
  1. verify test token first (`401` on missing/invalid token)
  2. resolve webhook + workflow by id
  3. if not found -> `404`
  4. if `webhook.provider === 'indicator'` -> `403`
  5. parse request body
  6. run provider challenge handling
  7. run provider auth verification
  8. run rate-limit checks
  9. queue execution
- token precedence is explicit: missing/invalid test token must return `401` before webhook lookup/indicator guard and before body parse/provider challenge handling to avoid webhook existence leakage
- rejected indicator test requests must not reach queue/execute stages
- `/api/webhooks/[id]/test-url` must reject `provider = 'indicator'` with `403`
- rejected indicator test-url mint requests must not issue tokenized URLs
15. Webhook test helper endpoint (`/api/webhooks/test?id=<webhookId>`) must not bypass path secrecy:
- endpoint must require authenticated session + ownership/workspace write/admin permission for requested webhook id
- endpoint must reject `provider = 'indicator'` with `403`
- endpoint must not return `webhook.url`, `webhook.path`, or derived trigger path for indicator webhook rows
- endpoint must not perform outbound test fetches for indicator webhook rows
16. Coordinated security gate for internal-only indicator webhooks:
- rules `10`, `13`, `14`, and `15` are one atomic enforcement unit
- no partial rollout is allowed across webhook surfaces (`/api/webhooks/trigger/[path]`, `/api/webhooks/test/[id]`, `/api/webhooks/[id]/test-url`, `/api/webhooks/test`, `/api/webhooks`, `/api/webhooks/[id]`)
- step `4` is incomplete if any one of the above surfaces can still create/read/update/execute/mint/test `provider = 'indicator'` through external/generic paths
- monitor API/runtime work must remain blocked until this coordinated gate is fully implemented and validated

## Logs Monitors Tab Contract
Monitoring is configured in a `Monitors` tab inside Logs, not in workflow editor trigger subblocks.

Route and layout:
1. Route remains `/workspace/[workspaceId]/logs`.
2. Header view tabs are `Logs`, `Monitors`, and `Dashboard`.
3. `Monitors` tab shell reuses Logs page interaction patterns (`ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`).
4. Panel behavior:
- left panel: monitor table (webhook-backed monitor records)
- middle panel: workflow run logs for selected monitor
- right panel: selected run log detail (same component behavior as Logs page)
5. On first row selection, open middle panel.
6. On log selection in middle panel, open right panel.

Normal table columns:
1. provider icon
2. auth configured status tag
3. listing icon + `base/quote` + listing name
4. indicator (with interval badge)
5. workflow
6. actions

Row actions behavior:
1. Non-edit mode actions column shows 3-dot menu.
2. 3-dot menu contains `Edit`, `Pause` or `Activate` (based on current state), and `Remove`.
3. Monitor create action is a header `+` icon button in Logs page header controls, positioned immediately left of Refresh in `Monitors` view (not inside monitor table panel).
4. Clicking header `+` opens monitor config modal.
5. `Edit` opens monitor config modal (custom-tools-style flow) instead of inline row edit.
6. Modal contains editable controls:
- provider selector (searchable dropdown) + required non-secret provider params
- auth editor (required secret fields only, no `Configured`/`Missing` status tag in modal; hidden when provider has no required secret fields)
- listing selector
- indicator selector (searchable modal dropdown, with interval selector in same section)
- workflow selector (searchable modal dropdown)
7. Modal actions are `Save` / `Cancel`.
8. Save writes only if normalized form is valid; otherwise show inline field errors and keep modal open.

Dropdown source contract:
1. provider options from `getMarketProviderOptionsByKind('live')` filtered by `getMarketLiveCapabilities(providerId)?.supportsStreaming === true`.
2. provider/auth editor fields from provider live param definitions (`getMarketProviderParamDefinitions(providerId, 'live')`) scoped to selected provider:
- include only required fields where visibility is not `hidden` and not `llm-only`
- password fields render in auth column and persist to `auth.secrets[paramId]` (encrypted at save)
- non-password fields render in provider column and persist to `providerParams[paramId]`
- non-password fields with discrete options use searchable dropdown selectors (same monitor-local dropdown/search pattern as workflow/indicator selectors)
- hide `Feed` section when selected provider has zero required non-secret live params
- hide `Auth` section when selected provider has zero required secret live params
- all edit-mode auth/provider/listing inputs must disable browser/password-manager autofill heuristics (`autoComplete` disabled and password-manager ignore attributes)
3. listing options from existing listing selector stack under `components/listing-selector/*` (same selector stack used by workflow block listing-selector input).
- monitor edit uses `components/listing-selector/selector/input.tsx` directly (`StockSelector`) instead of widget-specific wrapper selector.
- when no listing is selected, selector empty state shows standard `Select listing` placeholder.
4. indicator options come from `GET /api/indicators/options?workspaceId=<workspaceId>` and include only trigger-capable indicators.
- response contract includes `id`, `name`, `source`, and `color`.
- custom indicator colors come from persisted indicator color; default indicators use fallback `#3972F6`.
- monitor modal must render indicator icon/tag color from returned `indicator.color` (do not derive color from `source`).
5. workflow selector options are workflow-block targets:
- include only workflows with at least one `indicator_trigger` block
- modal selector displays one row per workflow (no trigger-count tag)
- on selection, set `workflowId`; resolve `blockId` by keeping current block when it belongs to selected workflow, otherwise use first available `indicator_trigger` block in that workflow
6. interval options from `getMarketSeriesCapabilities(providerId)?.intervals ?? []`, rendered via searchable dropdown selector.
7. Interval source rule is explicit for live monitors:
- provider eligibility is gated by `getMarketLiveCapabilities(...).supportsStreaming`
- interval options always come from `getMarketSeriesCapabilities(providerId)?.intervals ?? []`, even when live capability flags do not advertise interval support
8. Workflow/indicator selectors in monitor modal use monitor-local dropdown/search UI (not widget-header-only dropdown components under `widgets/widgets/components/*`).
9. Workflow/indicator selector trigger + menu item visuals use icon-with-color-tag style (matching existing workflow/indicator dropdown patterns); do not show workflow trigger-count tag in trigger or menu items.
- workflow color source: `workflowColor`.
- indicator color source: `indicator.color` from options API (never `source`-based mapping).

Required user-editable fields per monitor:
1. `workflowId`
2. `blockId`
3. `providerId`
4. `interval`
5. `indicatorId`
6. `listing`
7. provider-required auth fields (derived from provider param definitions)

Optional user-editable fields per monitor:
1. none (monitor editor only exposes required provider live params).

## Trigger-Capable Indicator Detection Contract
“Trigger-capable indicator” is resolved by one shared capability function used by both dropdown population and save-time validation.

Rules:
1. Use shared detector: `isIndicatorTriggerCapable(pineCode: string): boolean`.
2. Detection algorithm:
- strip line comments, block comments, and string literals
- then detect `trigger(` token using identifier-safe regex
3. An indicator is selectable only when `isIndicatorTriggerCapable(...) === true`.
4. Save-time validation must run the same detector against the persisted source to prevent stale UI bypass.
5. Applies to both default indicators and custom indicators.

## Trigger Block Contract
`indicator_trigger` remains a category trigger block for workflow graph and tag output shape.

Rules:
1. Do not store deployed monitor runtime config in block subblocks.
2. Block remains output schema anchor for tag dropdown and trigger payload consumption.
3. Block subblocks are guidance-only and may include read-only `text` guidance pointing users to Logs `Monitors` tab.
4. Block UI must never mutate webhook rows directly; all monitor row create/update/delete/toggle flows go through monitor APIs.
5. Allowed subblock types for `indicator_trigger` are:
- `text` for read-only guidance
6. Explicitly disallow `short-input`, `trigger-save`, `webhookUrlDisplay` (subblock id), `webhook-config`, and manual-default input fields in `indicator_trigger` block subblocks.

## Monitor Save + Internal Webhook Sync Contract
Monitor save pipeline (webhook-backed):
1. Validate and normalize monitor fields.
2. Validate target workflow/block ownership and permissions in workspace.
3. Validate target block exists and is type `indicator_trigger`.
4. Validate provider supports live streaming and selected interval.
5. Validate indicator is trigger-capable.
6. Validate provider-required auth fields and provider params using secure auth contract:
- derive required secret param ids from selected provider auth definitions and enforce that all required ids are satisfied for the monitor
- treat direct secret input as write-only; encrypt before persistence and map to `auth.encryptedSecrets[paramId]`
- reject persistence payloads that attempt to store plaintext auth keys in `providerConfig.monitor.auth`
7. Monitor edit field derivation must match provider-definition behavior used by data-chart provider controls:
- source field definitions from `getMarketProviderParamDefinitions(providerId, 'live')`
- include only required fields with visibility not `hidden` and not `llm-only`
- password fields map to monitor auth input (`auth.secrets[paramId]`)
- non-password fields map to `providerParams[paramId]`
- optional provider params (for example Alpaca `cryptoRegion`) are excluded unless marked required by provider config
8. Monitor cardinality rule:
- multiple monitor rows may target the same `workflowId + blockId`
- do not assume a single webhook row per `workflowId + blockId` for indicator monitors
- generic trigger-save/webhookUrlDisplay workflows are not used for indicator monitors
9. Create or update webhook record:
- `webhook.provider = 'indicator'`
- on create: generate `monitorId` in monitor API before DB insert
- on create: set `webhook.id = monitorId` and `webhook.path = 'indicator-monitor-' + monitorId` in the same insert
- on update: keep existing `webhook.path` immutable
- `webhook.blockId = monitor.blockId`
- `webhook.workflowId = monitor.workflowId`
- `webhook.providerConfig = { triggerId: 'indicator_trigger', version: 1, monitor: {...} }`
- `webhook.isActive = monitor.isActive`
10. Notify socket-server runtime for immediate reconcile.
- reconcile notification is best-effort and non-blocking
- if notification fails/unreachable, monitor API mutation still succeeds and logs warning
- periodic runtime reconcile loop remains eventual-consistency fallback

Pause/activate pipeline:
1. `Pause` sets `webhook.isActive = false`.
2. `Activate` sets `webhook.isActive = true`.
3. Trigger runtime reconcile immediately after toggle.

Remove pipeline:
1. Remove hard-deletes the monitor webhook row.
2. Trigger runtime reconcile immediately.

Important behavior:
1. User can add/remove monitors without workflow editor changes.
2. User can change provider/interval/indicator/workflow/listing/auth without redeploy.
3. User can pause/activate monitors without losing saved configuration.
4. Changes take effect through runtime reconcile, not deployment snapshot rewrite.
5. Monitor API list/detail responses expose only redacted auth metadata (`hasEncryptedSecrets`, `encryptedSecretFieldIds`) and never return plaintext/ciphertext secret values.

## Monitor Logs Drill-In Contract
Monitor UI must drill into workflow runs for the selected monitor.

Rules:
1. Reuse logs list/detail UX patterns from Logs page:
- `LogsList` behavior for middle panel
- `LogDetails` behavior for right panel
2. Canonical monitor filter query parameter contract (shared by `/api/logs`, `/api/logs/export`, `/api/v1/logs`, and hook serialization):
```ts
type MonitorLogFilterQuery = {
  monitorId?: string
  listing?: ListingIdentity
  indicatorId?: string
  providerId?: string
  interval?: string
  triggerSource?: 'indicator_trigger'
}
```
- key names are fixed and must remain camelCase exactly as above
- each monitor filter key is single-value (no CSV list semantics for monitor filters)
- `listing` filter is provided by listing selector as one canonical listing-identity value (not decomposed fields)
- query serialization uses one `listing` query param containing canonical JSON for `ListingIdentity`
- empty/whitespace-only values are treated as absent and must not emit SQL predicates
- monitor filters are passed only as explicit query params; `searchQuery` parser (`query-parser.ts`) must not infer or rewrite monitor filter fields
3. Extend `/api/logs` optional filters for monitor context:
- `monitorId`
- `listing`
- `indicatorId`
- `providerId`
- `interval`
- `triggerSource` (`indicator_trigger`)
4. Logs filtering field paths are canonical:
- monitor metadata filters read `workflow_execution_logs.executionData.trigger.data.monitor.*`
- listing filter path mapping is explicit:
  - `listing` -> exact identity match on `...monitor.listing` using normalized `listing_type` + `listing_id` + `base_id` + `quote_id`
- `triggerSource` filter reads top-level `workflow_execution_logs.executionData.trigger.source`
5. Monitor filters are optional and null-safe:
- apply monitor JSON-path predicates only when corresponding monitor filter params are provided
- when no monitor filter params are provided, do not add monitor JSON-path constraints
- rows without `executionData.trigger.data.monitor` must not error query execution
- if monitor filter params are provided, rows missing monitor metadata are treated as non-matches
6. Trigger metadata must be durable after completion:
- `completeWorkflowExecution(...)` must merge into existing `executionData` and preserve `executionData.trigger` written at start
- do not overwrite `executionData` with trace/final output only
7. Existing `/api/logs/[id]` detail route remains the source for detail panel.
8. Middle panel list query remains workspace-scoped and workflow-scoped, then narrowed by monitor metadata filters.
9. CSV export parity for monitor context:
- Monitors view CSV export must use `/api/logs/export` with the same monitor filters as `/api/logs`
- export trigger path from Logs UI must pass active monitor filters whenever `view=monitors`
10. `/api/v1/logs` parity:
- `/api/v1/logs` filter parser and query builder must implement the same optional/null-safe monitor-filter semantics as `/api/logs`
11. Route/parser serialization parity requirements:
- `/api/logs` `QueryParamsSchema` must add optional fields for all `MonitorLogFilterQuery` keys (`listing` parsed from canonical JSON string)
- `/api/logs/export` `ExportParamsSchema` must add the same optional fields with identical semantics
- `/api/v1/logs/route.ts` `QueryParamsSchema` and `/api/v1/logs/filters.ts` `LogFilters` must add the same monitor fields (`listing` parsed from canonical JSON string)
- `apps/tradinggoose/hooks/queries/logs.ts` must serialize monitor fields using exact canonical keys and `URLSearchParams`
- omitted monitor filters must be absent from query string (no empty-string params)
- listing selector output must be normalized before serialization (`listing_type` + `listing_id/base_id/quote_id`)
- monitor filter values are passed through as provided after canonical listing normalization (no implicit lowercase/format coercion in hook serialization)
12. Monitor JSON-path filter performance guardrails:
- keep workspace/permission/workflow base predicates as required filters; monitor JSON-path predicates are additive only
- only add monitor JSON-path predicates when corresponding monitor filter params are provided (no unconditional JSON-path clauses)
- preserve existing pagination behavior for monitor-filtered queries (`/api/logs` `limit+offset`, `/api/v1/logs` cursor + `limit`)
- add per-request query timing telemetry for monitor-filtered requests in `/api/logs` and `/api/v1/logs` for rollout verification
- rollout gate: block Monitors-tab default rollout if monitor-filtered query p95 regresses more than 25% versus baseline on the same dataset

## Execute Dispatch Contract
```ts
type IndicatorExecuteDispatchOptions =
  | { enabled: false }
  | {
    enabled: true
    workflowId: string
    executionTarget: 'deployed' | 'live'
  }
```

Rules:
1. Dispatch is opt-in and off by default.
2. `workflowId` and `executionTarget` are required when dispatch is enabled.
3. Execute request `interval` may remain optional for non-dispatch runs; when dispatch is enabled, `dispatchInterval` must resolve by rule `4`.
4. Dispatch interval resolution is deterministic and required before monitor candidate lookup:
- resolve one `dispatchInterval` string using this strict precedence:
  - request `interval` when provided and non-empty
  - else exact canonical mapping from `intervalMs` using the same full market interval map used by market planning (`apps/tradinggoose/providers/market/series-planner.ts`, `INTERVAL_MS`; aligned with `MARKET_INTERVALS` in `apps/tradinggoose/providers/market/types/base.ts`):
    - `60000 -> '1m'`, `120000 -> '2m'`, `180000 -> '3m'`, `300000 -> '5m'`, `600000 -> '10m'`
    - `900000 -> '15m'`, `1800000 -> '30m'`, `2700000 -> '45m'`, `3600000 -> '1h'`, `7200000 -> '2h'`
    - `10800000 -> '3h'`, `14400000 -> '4h'`, `86400000 -> '1d'`, `604800000 -> '1w'`, `1209600000 -> '2w'`
    - `2592000000 -> '1mo'`, `7776000000 -> '3mo'`, `15552000000 -> '6mo'`, `31536000000 -> '12mo'`
- do not infer interval from `marketSeries.bars` open-time deltas or other heuristics
- if `dispatchInterval` is unresolved:
  - do not perform monitor lookup/dispatch for that indicator result
  - append warning code `indicator_trigger_dispatch_interval_unresolved`
  - append dispatch skip code `interval_unresolved`
5. Candidate lookup is webhook-backed monitor driven:
- `webhook.workflowId === dispatch.workflowId`
- workspace must match execute workspace
- `webhook.provider === 'indicator'`
- `webhook.isActive === true`
- `webhook.providerConfig.triggerId === 'indicator_trigger'`
- `webhook.providerConfig.monitor.indicatorId` matches executed indicator id
- `webhook.providerConfig.monitor.listing` matches current marketSeries listing identity after normalization (`listing_type` + `listing_id/base_id/quote_id`)
- `webhook.providerConfig.monitor.interval` must exactly match resolved `dispatchInterval`
6. Dispatch scope for `/api/indicators/execute` is deterministic:
- execute route is stateless per request (no "newly-closed bars" memory across requests)
- evaluate trigger candidates from latest bar only (`candidate.time === latestBarOpenTimeSec`)
- `latestBarOpenTimeMs` is the maximum bar open time in the execution series used for indicator compute
- derive `latestBarOpenTimeSec = Math.floor(latestBarOpenTimeMs / 1000)` for candidate comparison
- do not dispatch older-bar candidates even if they are present in the returned execution window
- apply collapse
- dispatch at most one candidate per monitor per execute request
 - when no latest-bar candidates remain after filter/collapse, append skip code `no_latest_candidate` and do not synthesize fallback candidates.
7. Dispatch user attribution uses workflow pinned API key owner via existing queue path.
8. Run existing gates before queue:
- `checkRateLimits(...)`
- `checkUsageLimits(...)`
- `blockExistsInDeployment(...)` only for `executionTarget === 'deployed'`
9. Gate failure is non-fatal: skip target + warning.
10. Queue with `headerOverrides['x-event-id'] = payload.eventId`.
11. Internal gate contract must be non-HTTP:
- internal dispatch paths (manual execute + socket runtime) must not consume `NextResponse` objects directly
- add an adapter/wrapper that returns a plain gate result shape with explicit deny codes
- HTTP routes may continue to map gate results to `NextResponse`, but core internal dispatch logic uses the plain result shape
- current code is HTTP-bound; internal dispatch remains blocked until this refactor is complete
- forbidden interim approach: do not construct synthetic `NextRequest` objects just to call current HTTP-coupled helpers from internal dispatch paths
12. Required gate function migration (explicit):
```ts
type DispatchGateResult =
  | { allowed: true }
  | {
      allowed: false
      code: 'PINNED_API_KEY_REQUIRED' | 'RATE_LIMIT_EXCEEDED' | 'USAGE_LIMIT_EXCEEDED'
      message: string
    }
```
- core gate evaluators used by internal dispatch must return `DispatchGateResult` (no `NextResponse` in signature).
- `checkRateLimits(...)` and `checkUsageLimits(...)` current `NextResponse` behavior must be moved to HTTP-only wrappers/adapters.
- HTTP routes must map `DispatchGateResult` -> `NextResponse` at boundary layer using one shared deterministic mapper.
- provider-aware HTTP response parity is mandatory in that mapper:
  - `RATE_LIMIT_EXCEEDED` + `provider === 'microsoftteams'` => status `200`, body `{ type: 'message', text: 'Rate limit exceeded. Please try again later.' }`
  - `USAGE_LIMIT_EXCEEDED` + `provider === 'microsoftteams'` => status `200`, body `{ type: 'message', text: 'Usage limit exceeded. Please upgrade your plan to continue.' }`
  - `PINNED_API_KEY_REQUIRED` => status `200`, body `{ message: 'Pinned API key required' }`
  - `RATE_LIMIT_EXCEEDED` (non-`microsoftteams`) => status `200`, body `{ message: 'Rate limit exceeded' }`
  - `USAGE_LIMIT_EXCEEDED` (non-`microsoftteams`) => status `200`, body `{ message: 'Usage limit exceeded' }`
- internal manual/socket dispatch must call core evaluators directly (plain result only).
13. Queue API contract for header overrides is explicit:
```ts
type QueueWebhookExecutionContext =
  | { kind: 'http'; request: NextRequest }
  | { kind: 'internal'; headers?: Record<string, string> }

type QueueWebhookExecutionOptions = WebhookProcessorOptions & {
  headerOverrides?: Record<string, string>
}
```
- `queueWebhookExecution(...)` must accept `QueueWebhookExecutionContext` instead of hard-requiring `NextRequest`.
- resolved headers are merged deterministically.
- base headers come from context (`request.headers` for `http`, `headers` for `internal`).
- then `headerOverrides` wins on key collision.
- internal callers (manual execute + monitor runtime) must set `headerOverrides['x-event-id'] = payload.eventId`.
- using the legacy `queueWebhookExecution(..., request: NextRequest, ...)` signature in manual/socket internal dispatch paths is a spec violation.
14. Payload budget parity:
- manual execute dispatch must run the same payload budget + truncation contract as socket runtime before queue
- oversize-skip behavior is warning-based and non-fatal for execute response

## `/api/indicators/execute` Response Contract
1. Keep the top-level response envelope unchanged:
```ts
type IndicatorExecuteResponse =
  | { success: true; data: IndicatorExecuteResult[] }
  | { success: false; error: string }
```
2. Dispatch outcomes are attached per indicator result (no new top-level `warnings` field):
```ts
type IndicatorExecuteWarning = { code: string; message: string }

type IndicatorDispatchSkip = {
  code:
    | 'interval_unresolved'
    | 'no_monitor_match'
    | 'no_latest_candidate'
    | 'collapsed'
    | 'gate_blocked'
    | 'payload_too_large'
    | 'queue_failed'
  message: string
  monitorId?: string
}

type IndicatorDispatchSummary = {
  attempted: boolean
  workflowId?: string
  executionTarget?: 'deployed' | 'live'
  monitorsMatched: number
  monitorsDispatched: number
  monitorsSkipped: number
  skipped: IndicatorDispatchSkip[]
}

type IndicatorExecuteResult = {
  indicatorId: string
  output: unknown | null
  warnings: IndicatorExecuteWarning[]
  unsupported: unknown
  counts: { plots: number; markers: number; signals: number }
  executionError?: { message: string; code: string; unsupported?: unknown }
  dispatch?: IndicatorDispatchSummary
}

type IndicatorVerifyData = {
  plotsCount: number
  markersCount: number
  signalsCount: number
  triggerUsageDetected: boolean
  triggerOnly: boolean
  warnings: IndicatorExecuteWarning[]
  unsupported: unknown
}
```
3. Dispatch warning/skip mapping is deterministic:
- non-fatal anomalies append to `result.warnings[]` using codes:
  - `indicator_trigger_dispatch_interval_unresolved`
  - `indicator_trigger_gate_blocked`
  - `indicator_trigger_payload_truncated`
  - `indicator_trigger_payload_too_large`
  - `indicator_trigger_queue_failed`
- skip reasons always appear in `result.dispatch.skipped[]` using the fixed `IndicatorDispatchSkip.code` set above.
- `no_monitor_match` and `no_latest_candidate` are represented in `dispatch.skipped[]` and do not require warning entries unless they indicate a config/contract error.
4. Dispatch skips/warnings must not turn a successful indicator execution into `executionError`.
5. `POST /api/indicators/verify` remains non-dispatching and does not emit dispatch summary.
6. Trigger-only script verify behavior is explicit:
- trigger-only scripts must pass verify when script trigger usage is detected, even if `plotsCount`, `markersCount`, and `signalsCount` are all zero
- verify route must compute `triggerUsageDetected` deterministically from source text by removing comments/string literals, then matching `\\btrigger\\s*\\(`
- verify success condition is: compile/output valid AND (`plotsCount > 0 || markersCount > 0 || signalsCount > 0 || triggerUsageDetected === true`)
- set `triggerOnly = triggerUsageDetected === true && plotsCount === 0 && markersCount === 0 && signalsCount === 0`
- when `triggerOnly === true`, return success with non-fatal warning code `trigger_only_script`
- fail with `invalid_output` only when no visual outputs and `triggerUsageDetected === false`
- verify path must not enqueue/dispatch workflow execution under any branch

Collapse scope:
1. Collapse is per monitor (`webhook.id`) + bar bucket.
2. One monitor cannot suppress another monitor.
3. Apply allowlist filters first, then collapse.

## Deployed Workflow Live Runtime
When deployed workflows have active indicator monitor webhooks, runtime executes continuously from market streams without manual `POST /api/indicators/execute`.

### Runtime host
1. Host in socket-server process:
- `apps/tradinggoose/socket-server/index.ts`
- `apps/tradinggoose/socket-server/market/*`
2. Enforce singleton with Redis lock (`apps/tradinggoose/lib/redis.ts`).
3. Singleton policy is fail-closed for monitor runtime:
- if Redis lock cannot be acquired or Redis is unavailable, do not start monitor runtime dispatch loop
- current global `acquireLock(...)` is fail-open when Redis is unavailable; monitor runtime must use a monitor-specific fail-closed path
- scoped-lock contract is explicit:
  - keep shared `acquireLock(...)` behavior unchanged for existing pollers
  - add a monitor-runtime-specific lock API (for example `acquireMonitorRuntimeLock(...)`) that returns `false` when Redis client is unavailable
  - socket monitor runtime must use the monitor-specific lock API only (must not call shared `acquireLock(...)` directly)
  - Gmail/Outlook pollers continue to use shared `acquireLock(...)` unchanged
- expose degraded status in `/health` for visibility
4. Expose monitor runtime stats in `/health`.
- current socket-server `/health` is basic; monitor runtime status fields are new required output

### Discovery and reconcile
1. Reconcile on startup and fixed interval (30s).
2. Source query joins:
- active `webhook` rows where `provider = 'indicator'`
- linked `workflow` rows
- deployed workflow state
3. Trigger immediate reconcile via socket-server internal HTTP notification on:
- indicator monitor create/update/delete
- workflow deploy/undeploy/revert/activate
- webhook activate/deactivate
4. Internal reconcile endpoint contract:
- socket-server exposes `POST /internal/indicator-monitors/reconcile`
- monitor APIs and workflow deploy/undeploy/revert/activate routes call this endpoint after successful state mutation
- endpoint does not exist in current socket-server and must be added before enabling monitor runtime dispatch
 - control-plane auth policy in this plan is unified across all socket-server internal POST endpoints:
   - `POST /internal/indicator-monitors/reconcile`
   - `POST /api/workflow-deleted`
   - `POST /api/workflow-updated`
   - `POST /api/workflow-reverted`
   - `POST /api/copilot-workflow-edit`
 - all above endpoints require header `X-Internal-Secret: <INTERNAL_API_SECRET>`
- missing or invalid internal secret returns `401` and request is not processed
- callers read secret from app env (`env.INTERNAL_API_SECRET`) and must send it on every socket control-plane notification
- socket-server validates against its `INTERNAL_API_SECRET` value
- keep internal secret header policy (do not refactor these endpoints to internal JWT in this plan)
- rollout dependency is explicit: auth enforcement and caller header updates must ship atomically across socket-server + app routes
- no deploy window is allowed where endpoints require `X-Internal-Secret` but known in-repo callers are still sending headerless requests
- exact rollout order per phase scope is mandatory:
  1. finalize caller inventory for the active phase scope
  2. deploy app-side caller updates first (send `X-Internal-Secret`) while socket endpoints still accept requests
  3. verify caller header emission in runtime logs/telemetry for all known in-scope callers
  4. enforce socket endpoint auth requirement (`401` on missing/invalid secret)
  5. verify no deny events for known in-scope callers after enforcement
  - forbidden order: enabling endpoint auth before caller updates/verification
- phase-0 release contract is explicit and blocking:
  - known in-repo caller updates (`/api/workflow-deleted`, `/api/workflow-reverted`) and socket-server auth enforcement are one rollout unit
  - do not deploy auth enforcement ahead of caller header updates in any environment
  - do not mark phase `0` complete until both known callers are verified sending `X-Internal-Secret`
- rollout decision is explicit: these endpoints are internal control-plane APIs, not public integration APIs
- no unauthenticated compatibility mode is allowed for these endpoints
- out-of-repo callers that do not send `X-Internal-Secret` are unsupported and will fail with `401` after enforcement
 - current in-repo caller coverage: workflow delete + workflow revert notifications only; no in-repo HTTP callers currently target `/api/workflow-updated` or `/api/copilot-workflow-edit`
 - endpoint is internal-only and must not be exposed as unauthenticated public control plane
 - operational rollout risk controls are mandatory:
   - pre-enforcement gate: record a 7-day baseline of request volume per control-plane endpoint from socket-server logs before enabling auth checks
   - pre-enforcement gate: confirm in-repo caller inventory matches expected phase scope (step `7`: delete/revert; step `18`: deploy/undeploy/activate)
   - rollout window control: emit structured `401` deny logs for control-plane endpoints including endpoint path and missing/invalid-secret reason
   - rollout window control: monitor `401` deny volume for first 24h after each phase (`0` and `F`) and review unexpected callers
   - incident rule: keep auth enforcement on (no fallback); unexpected out-of-repo callers are handled via incident communication, not compatibility rollback
5. Reconcile notification failure semantics:
- calling routes treat reconcile notification as best-effort (do not rollback successful mutation/deploy/undeploy/revert/activate)
- failed notification logs warning/error and returns success for primary operation
- periodic reconcile loop converges runtime state after transient notification failures
6. Reconcile actions:
- add subscription when active indicator monitor appears
- restart subscription when monitor webhook config changes
- remove subscription when monitor/workflow/webhook deactivates

### Stream and state model
1. Build provider symbol per monitor listing via:
- `resolveListingContext(...)`
- `resolveProviderSymbol(...)`
2. Reuse existing stream clients:
- `AlpacaMarketStream`
- `FinnhubMarketStream`
3. Startup behavior:
- one historical backfill per subscription startup/restart
- then live-only updates
4. Rolling window per monitor:
- sort/dedupe by `openTime`
- fixed cap to `2000` bars

### Compute and emission
1. Compute on each accepted stream bar update.
2. Provider event cadence decides recompute frequency:
- if provider emits interim in-bar updates, recompute on each update
- if provider emits closed bars only, recompute once per closed bar
3. Resolve indicator source by monitor config `indicatorId` (default map + custom workspace indicator).
4. Gather `trigger(...)` candidates from Studio trigger collector output (injected by the runtime extension).
5. Collapse to one emitted event per monitor + bar bucket.

### Dispatch
1. Build canonical payload with:
- full rolling `marketSeries`
- indicator settings/output
- normalized trigger marker
- monitor metadata (`monitorId`, `workflowId`, `blockId`, `listing`, `providerId`, `interval`, `indicatorId`)
2. Deterministic event id (live runtime):
- `collapseKey = indicator_trigger_live|{monitorId}|{indicatorId}|{barBucketMs}`
- `barBucketMs` is derived from emitted bar open-time in milliseconds
- `eventId = SHA-256(collapseKey)`
3. Queue via `queueWebhookExecution` (no direct `executeWebhookJob`).
4. Set `x-event-id` via queue header overrides.
5. Gate failures skip affected dispatch and keep runtime alive.
6. Payload budget + truncation contract (applies before queue):
- enforce `MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES = 262144` (256 KiB) via `Buffer.byteLength(JSON.stringify(payload), 'utf8')`
- if payload exceeds budget, apply deterministic reduction in order:
  1. reduce rolling window for `payload.marketSeries.bars`, `payload.indicator.output.series[*].points`, and `payload.indicator.output.markers` using latest-bar steps `1000 -> 500 -> 250 -> 100 -> 50`
  2. if still over budget at 50 bars, drop optional heavy fields: `payload.marketSeries.marketSessions`, `payload.indicator.output.signals`, `payload.indicator.output.unsupported`
  3. if still over budget, skip dispatch for that candidate
- never drop required control fields: `event`, `input`, `signal`, `time`, `eventId`, `monitor`, `triggerMarker`, `indicator.settings`
- include dispatch metadata: `payload.monitorDispatch = { truncated, originalSizeBytes, finalSizeBytes, retainedBars }`
- truncation emits warning + telemetry code `indicator_trigger_payload_truncated`
- skip emits warning + telemetry code `indicator_trigger_payload_too_large`

## Runtime Mapping
1. `event` -> `payload.event`
2. `options.input` -> `payload.input`
3. `options.signal` -> `payload.signal`
4. `options.position` + `options.color` + `event` + `signal` -> `payload.triggerMarker`
5. emitted bar open-time ms -> `payload.time` and `payload.triggerMarker.time` via `Math.floor(ms / 1000)`
6. computed event id -> `payload.eventId`
7. rolling market series -> `payload.marketSeries` (subject to payload budget truncation)
8. execution settings -> `payload.indicator.settings`
9. normalized output -> `payload.indicator.output` (subject to payload budget truncation)
10. append `triggerMarker` into `payload.indicator.output.markers`
11. include monitor metadata in payload:
- `payload.monitor.id`
- `payload.monitor.workflowId`
- `payload.monitor.blockId`
- `payload.monitor.listing`
- `payload.monitor.providerId`
- `payload.monitor.interval`
- `payload.monitor.indicatorId`
12. marker shape mapping:
- `long` -> `arrowUp`
- `short` -> `arrowDown`
- `flat` -> `circle`

## Error Model
1. Trigger option validation:
- drop invalid trigger call
- append warning
- do not throw
2. Non-trigger runtime errors:
- unchanged compile failure behavior
3. Monitor save validation errors:
- fail monitor save API with structured field errors
- do not mutate existing monitor webhook on failed validation
4. Monitor logs query errors:
- keep monitor table panel active
- show non-blocking logs panel error state
5. Oversized dispatch payload:
- run deterministic payload truncation before queue
- if payload still exceeds budget after truncation, skip dispatch candidate
- append warning code `indicator_trigger_payload_too_large`
- for `/api/indicators/execute`, append warning to the indicator result `warnings[]` and append skip reason to `dispatch.skipped[]`
- keep runtime/execute request alive (non-fatal, no throw)

## Workflow Execution Reuse
Reuse existing webhook execution pipeline:
1. prechecks: rate + usage
2. deployment block check only for deployed target
3. queue: `apps/tradinggoose/lib/webhooks/processor.ts` (`queueWebhookExecution`)
4. execute: `apps/tradinggoose/background/webhook-execution.ts`
5. idempotency: `x-event-id` handled in `apps/tradinggoose/lib/idempotency/service.ts`

Public webhook route guard contract:
1. `provider = 'indicator'` webhook rows are internal-only and must be blocked on all external webhook test/trigger routes.
2. POST route behavior for external indicator webhook request:
- return `403`
- canonical POST branch order applies:
  - resolve webhook record (`path` or `id`) and apply indicator guard before provider compatibility short-circuit logic, request body parse, and provider challenge handling
- do not call provider auth verification
- do not call queue/execution pipeline
 - enforce this short-circuit before rate-limit/usage/deployment checks
 - enforce this short-circuit before provider compatibility short-circuit logic and before body parse/provider challenge logic
3. Compatibility short-circuit behavior at `/api/webhooks/trigger/[path]`:
- existing provider-specific compatibility short-circuit branches are preserved for non-indicator providers
- compatibility short-circuit execution is allowed only after webhook resolve and explicit `provider !== 'indicator'` check
- query params can trigger compatibility behavior only for non-indicator providers after the guard above
- this rule applies to both GET and POST paths for `/api/webhooks/trigger/[path]`
4. Test receiver behavior at `/api/webhooks/test/[id]` is canonical:
- missing/invalid test token returns `401` before webhook lookup/indicator guard and before body parse/provider challenge handling
- after token verification, resolve webhook-by-id + apply indicator guard before body parse/provider challenge/auth/rate/queue
5. Test URL mint behavior for indicator webhooks:
- `/api/webhooks/[id]/test-url` must return `403` for `provider = 'indicator'`
- do not mint tokenized test URL for indicator webhook rows
6. Webhook test helper behavior for indicator webhooks:
- `/api/webhooks/test?id=<webhookId>` must return `403` for `provider = 'indicator'`
- do not expose `webhook.url`/path-derived URLs in response for indicator webhook rows
- route requires authenticated session + ownership/workspace write/admin permission before returning any webhook test details
7. Generic webhook CRUD bypass guard for indicator webhooks:
- `POST /api/webhooks` must reject `provider = 'indicator'` with `403`
- `PATCH /api/webhooks/[id]` and `DELETE /api/webhooks/[id]` must reject target `provider = 'indicator'` rows with `403`
- `GET /api/webhooks` must not return `provider = 'indicator'` rows in either list branch (`workflowId + blockId` and default user-owned list)
- `GET /api/webhooks/[id]` for `provider = 'indicator'` must return `404`
7. Internal indicator dispatch continues through trusted internal call paths only:
- manual execute dispatch
- socket runtime dispatch

Webhook input formatting contract for `provider === 'indicator'`:
1. Add explicit formatter branch in `formatWebhookInput(...)` for internal indicator webhooks.
2. Return payload root as-is (passthrough), preserving root fields:
- `event`, `input`, `signal`, `monitor.*`, `marketSeries`, `indicator`, `triggerMarker`, `eventId`, `time`
3. Do not wrap indicator payload under `webhook.data.payload`.
4. Keep existing wrapped behavior for non-indicator providers unchanged.

Manual execute dispatch:
1. entrypoint remains `apps/tradinggoose/app/api/indicators/execute/route.ts`
2. dispatch uses emitted `trigger(...)` candidates from indicator output only (latest-bar scope, per Execute Dispatch Contract).
3. no start-trigger-style defaults, manual fallback mode, or synthetic candidate generation is allowed.
4. if no latest-bar emitted candidates remain after allowlist/collapse, do not dispatch and record skip code `no_latest_candidate`.
5. manual dispatch eventId contract is deterministic and request-scoped:
- derive `barBucketMs` from candidate bar open-time in milliseconds
- derive one `manualDispatchId = executeRequestId` at route entry (same value for the entire `/api/indicators/execute` request)
- `collapseKey = indicator_trigger_manual|{manualDispatchId}|{monitorId}|{indicatorId}|{barBucketMs}`
- `eventId = SHA-256(collapseKey)`
- set `headerOverrides['x-event-id'] = eventId`
- retries within the same execute request must reuse the same eventId
- separate execute requests intentionally generate different `manualDispatchId` values (no cross-request dedupe)
- manual/live collision is prevented by distinct prefixes (`indicator_trigger_manual` vs `indicator_trigger_live`)
6. queue through `queueWebhookExecution` with header override.
7. do not call `executeWebhookJob` directly.
8. do not re-enter external webhook route for internal dispatch.
9. manual execute dispatch does not create/update/delete monitor webhook rows.

Logging metadata contract for monitor filtering:
1. Execution start must persist canonical source + monitor metadata:
- `trigger.source = 'indicator_trigger'` (canonical source field)
- `triggerData.monitor.id` (webhook id)
- `triggerData.monitor.workflowId`
- `triggerData.monitor.blockId`
- `triggerData.monitor.listing`
- `triggerData.monitor.providerId`
- `triggerData.monitor.interval`
- `triggerData.monitor.indicatorId`
2. Logging-session contract must support setting top-level trigger source without writing duplicate `triggerData.source` payload fields.
3. Keep existing `isTest` and `executionTarget` fields in trigger data.
4. Source semantics are canonical and single-field:
- monitor trigger source selector must use top-level `executionData.trigger.source`
- indicator monitor executions must set `executionData.trigger.source = 'indicator_trigger'`
- do not persist duplicate source fields under `executionData.trigger.data`
5. Rollout safety rule:
- do not enable/ship monitor source filtering until all indicator monitor execution writers (manual execute + socket runtime dispatch paths) write canonical `executionData.trigger.source = 'indicator_trigger'`.

## Planned Implementation Steps
Execution gate:
1. Steps `9+` must not start until steps `1-8` are implemented and validated.
2. Studio implementation is blocked until Studio-owned `trigger(...)` runtime extension is implemented.
   - `pinets` alignment is a validation gate: block only if root/app resolution drifts (current branch is already aligned).
3. If any prerequisite in steps `1-8` is unresolved in the current branch, stop implementation work and resolve prerequisites first.
4. Steps `16` and `17` are blocked until step `3` (non-HTTP gate/queue contracts) is implemented and validated.
- this gate explicitly remains blocked while `checkRateLimits`/`checkUsageLimits` return `NextResponse` and `queueWebhookExecution` hard-requires `NextRequest` headers.
- step `3` is mandatory implementation dependency for internal dispatch paths and must not be treated as optional cleanup.
- step `3` is a Phase `A` hard exit gate: do not start phase `B+` work until step `3` validation passes.
5. Steps `12+` are blocked until step `11` (`indicator_trigger` trigger+block registration with dedicated non-webhook-coupled subblocks) is implemented and validated; do not bypass through existing `buildTriggerSubBlocks`/`useWebhookManagement` webhook-coupled paths.
6. Steps `14` and `15` are blocked until step `13` (logs filters/parity/parser/hook contract) is implemented and validated.
7. Steps `17` and `18` are blocked until step `7` (monitor-runtime control plane auth hardening + monitor-specific fail-closed lock prerequisites) is implemented and validated.
8. Steps `13-17` are blocked until step `6` (execution logger merge-preserve durability for `executionData.trigger`/`executionData.environment`) is implemented and validated.
9. Steps `14` and `15` are also blocked until step `8` logs 3-mode foundation is implemented in code (`stores/logs/filters/types.ts`, `stores/logs/filters/store.ts`, `logs.tsx`, and dashboard view handlers including controls).
10. Internal control-plane secret rollout must be atomic:
- do not deploy socket-server auth enforcement ahead of app caller header updates
- deploy step `7` auth enforcement together with all currently existing in-repo caller header updates in step `7` scope (delete/revert) in one release unit
- deploy/undeploy/activate caller header updates are owned by step `18` and validated in phase `F`
- if atomic deployment cannot be guaranteed, do not enable control-plane auth checks yet
- enforcing endpoint auth while either step `7` caller (`workflow delete` or `workflow revert`) is still headerless is a release-blocking contract violation because it breaks control-plane notifications
11. Phase-0 mandatory security gate:
- complete and validate step `7` before any monitor runtime work starts (socket monitor runtime, reconcile wiring, lifecycle reconcile notifications)
- no implementation work for steps `17` or `18` may begin before this gate is satisfied
12. External webhook internal-only guard rollout must be coordinated:
- step `4` (`provider = 'indicator'` internal-only guards across webhook trigger/test/test-url/helper + generic webhook CRUD/list/get) is a single security gate
- no step `12+` work may start unless step `4` is fully implemented and validated on all required webhook surfaces
- partial guard rollout across those surfaces is a release-blocking security contract violation
13. `trigger(...)` feature-usage gate:
- do not treat `trigger(...)` as usable/ready until both step `9` runtime extraction (local + E2B) and step `20` editor typings/docs generation are implemented and validated
- partial readiness (runtime only or editor only) is a release-blocking contract violation for feature usage

Phase execution order (mandatory, no overlap):
1. Phase `0` (mandatory security gate): step `7` first.
2. Phase `A` (remaining prerequisites): steps `1-6` and `8`.
- Phase `A` must include step `3` contract split completion and validation (non-HTTP internal gate/queue path) before any later phase starts.
3. Phase `B` (indicator trigger core plumbing): steps `9-11`.
4. Phase `C` (monitor persistence + logs query contract): steps `12-13`.
5. Phase `D` (logs monitors UX): steps `14-15`.
6. Phase `E` (dispatch execution paths): steps `16-17`.
7. Phase `F` (lifecycle notifications + final surfaces): steps `18-20`.
8. Do not start a later phase until the prior phase is fully implemented and validated against its mapped validation checklist items and test touchpoints.
9. If regression is found in a completed phase, stop forward implementation and resolve regression in that phase before continuing.

1. Hard prerequisite: Studio-owned `trigger(...)` runtime extension:
- implement bridge/bootstrap infrastructure only (precondition for later runtime extraction):
  - Studio trigger bridge using `Context.prototype.call` interception with realm-safe sentinel matching
  - runtime-realm-safe sentinel install (local host + local VM when used + E2B) before code evaluation
  - shared argument normalization helpers (`context.get(...)`) and execution-local collector isolation via `AsyncLocalStorage`
- step `1` does not own final runtime extraction behavior (owned by step `9`)
- step `1` does not own editor typings/docs generation (owned by step `20`)
- required integration points:
  - wire bridge bootstrap + host-realm sentinel install into `apps/tradinggoose/lib/indicators/run-pinets.ts` before `pine.run(...)` (required local runtime path)
  - inject VM-realm sentinel setup in `apps/tradinggoose/lib/indicators/execution/local-executor.ts` before `Script.runInContext(...)` (supplemental local VM path; does not replace host-realm sentinel requirement)
  - inject E2B-realm bridge bootstrap/sentinel in `apps/tradinggoose/lib/indicators/execution/e2b-script-builder.ts` before indicator evaluation
2. Hard prerequisite: `pinets` package version alignment in Studio:
- validate that root + app resolve the same `pinets` version (current branch already aligned; validation-only when true)
- only when mismatch exists: update root/app dependency entries, refresh lockfile, then verify runtime/editor parity across:
  - app runtime dependency
  - root dependency used by cheat-sheet generator
3. Hard prerequisite: extend queue API for internal dispatch headers:
- `queueWebhookExecution` must support internal header overrides without requiring `NextRequest`-derived headers only
- internal dispatch must set deterministic `x-event-id` through this contract
- treat this prerequisite as mandatory dispatch-enablement work, not cleanup/refactor-only scope
 - refactor gate checks to an internal plain-result contract used by runtime/execute paths, with HTTP adapters only at route boundaries
 - migrate `checkRateLimits` + `checkUsageLimits` core signatures to plain `DispatchGateResult` and keep `NextResponse` mapping only in HTTP wrappers
 - define one shared `DispatchGateResult -> NextResponse` mapper used by HTTP routes; preserve existing provider-specific deny payload parity (notably `microsoftteams`)
 - migrate all active HTTP route boundaries that call these helpers (`/api/webhooks/trigger/[path]` and `/api/webhooks/test/[id]`) to the new contracts
 - replace HTTP-bound direct use (`NextResponse`/`NextRequest`) in internal runtime dispatch path with the contracts defined in Execute Dispatch Contract
 - do not start step 16 or step 17 with adapter shims that still require `NextRequest`/`NextResponse` in internal paths
4. Hard prerequisite: add indicator formatter passthrough:
- explicit `provider === 'indicator'` branch in `formatWebhookInput(...)`
- return root payload as-is for tag path compatibility
 - add internal-only guard for `provider = 'indicator'` at `/api/webhooks/trigger/[path]` (explicit `403`, no queue)
 - enforce canonical POST branch order for `/api/webhooks/trigger/[path]`:
   - resolve webhook-by-path + apply indicator guard before provider compatibility short-circuit logic, request body parse, and provider challenge handling
 - preserve existing provider-specific compatibility short-circuit branches for non-indicator providers on `/api/webhooks/trigger/[path]`
 - move compatibility short-circuit execution after webhook resolve + explicit `provider !== 'indicator'` check
 - add internal-only guard for `provider = 'indicator'` at `/api/webhooks/test/[id]` (explicit `403`, no queue)
 - enforce canonical POST branch order for `/api/webhooks/test/[id]`:
   - missing/invalid token returns `401` before webhook lookup/indicator guard and before body parse/provider challenge handling
   - after token verification, resolve webhook-by-id + apply indicator guard before body parse/provider challenge/auth/rate/queue
 - add internal-only guard for `provider = 'indicator'` at `/api/webhooks/[id]/test-url` (explicit `403`, no token mint)
 - add internal-only guard for `provider = 'indicator'` at `/api/webhooks/test?id=<webhookId>` (explicit `403`, no URL/path exposure)
 - require authenticated session + ownership/workspace write/admin permission for `/api/webhooks/test?id=<webhookId>`
 - add generic webhook CRUD guard for `provider = 'indicator'` at `/api/webhooks` and `/api/webhooks/[id]`:
   - reject create/update/delete through generic webhook CRUD paths
  - exclude indicator rows from both `/api/webhooks` list branches (`workflowId + blockId` and default user-owned list) and return `404` on generic get-by-id to prevent path/config leakage
 - guard must short-circuit before provider auth, rate-limit/usage checks, and queue dispatch on trigger/test receiver routes
 - coordinated rollout contract (mandatory):
   - all above guard changes in step `4` ship together as one release unit
   - do not ship route-by-route guard coverage increments across releases
   - if any listed surface remains unguarded, block monitor APIs/runtime rollout and treat step `4` as incomplete
5. Hard prerequisite: logging metadata enrichment for monitor filtering:
- set canonical top-level `trigger.source` and enrich `triggerData.monitor.*` metadata at execution start
- implement canonical single-field source persistence for indicator monitor execution paths (`trigger.source = 'indicator_trigger'`)
- do not persist duplicate monitor source fields under `trigger.data`
- enforce rollout safety: do not enable monitor-source filtering until both manual execute and socket runtime writers use canonical top-level source contract
- keep this step metadata-only; route/parser/hook/export filter contract changes are implemented in step `13`
6. Hard prerequisite: make monitor trigger metadata durable in persisted logs:
- update execution logger completion path to preserve prior `executionData.trigger` content
- preserve `executionData.environment` written at start
- completion update must merge into existing `executionData` instead of replacing whole object
- explicit no-regression: monitor metadata under `executionData.trigger.data.monitor.*` must remain present after completion
- ensure monitor filters work after execution completion, not just at start
- this is a strict dependency for step `13`: do not implement monitor filtering while logger completion still replaces `executionData` in `apps/tradinggoose/lib/logs/execution/logger.ts`
7. Hard prerequisite / Phase-0 mandatory security gate: scope singleton fail-closed behavior to monitor runtime only:
- do not change global `acquireLock(...)` semantics used by existing pollers
- add monitor-runtime-specific lock acquisition behavior that is fail-closed when Redis is unavailable
- Gmail/Outlook polling lock behavior remains unchanged
- explicit scoped-lock implementation contract:
  - introduce monitor-runtime lock API in `apps/tradinggoose/lib/redis.ts` (for example `acquireMonitorRuntimeLock(...)`)
  - monitor-runtime lock API must fail-closed when Redis client is unavailable (`false`)
  - keep shared `acquireLock(...)` fail-open fallback unchanged for Gmail/Outlook poller routes
  - socket monitor runtime codepaths must call monitor-runtime lock API (not shared `acquireLock(...)`)
 - monitor runtime dispatch loop must stay disabled until this monitor-specific fail-closed lock path is active
 - add socket-server control-plane endpoint `POST /internal/indicator-monitors/reconcile` with `X-Internal-Secret` auth
 - enforce the same `X-Internal-Secret` auth on existing socket control-plane POST endpoints (`/api/workflow-deleted`, `/api/workflow-updated`, `/api/workflow-reverted`, `/api/copilot-workflow-edit`)
 - update currently existing in-repo app-side callers to send `X-Internal-Secret` (`workflows/[id]` delete notification and `workflows/[id]/deployments/[version]/revert` notification) in this step
- deploy/undeploy/activate workflow notification caller wiring is owned by step `18` and is not part of step `7` completion criteria
- rollout sequencing is strict: caller updates and endpoint auth enforcement must ship atomically (no intermediary headerless-caller window)
- no partial rollout is allowed in phase `0`: endpoint auth enforcement without both delete+revert caller header updates is forbidden
- step `7` is incomplete if either delete or revert control-plane notification can still be emitted without `X-Internal-Secret`
- phase `0` exact enforcement sequence (blocking):
  1. update delete/revert callers to send `X-Internal-Secret`
  2. verify header emission for delete/revert caller paths in runtime logs
  3. enable socket endpoint auth enforcement
  4. verify zero `401` denies for delete/revert in-scope callers post-enforcement
- before enabling phase-`0` auth enforcement, re-validate live implementation-time caller inventory for this phase scope and confirm all discovered callers are secret-enabled
- auth rollout is a deliberate breaking hardening for unknown out-of-repo callers of these internal endpoints; do not add unauthenticated fallback paths
- phase `0` execution policy is strict:
  - apply app caller header updates and socket-server auth enforcement in the same release wave per environment
  - if either side is not ready, do not enable auth enforcement yet
  - monitor runtime implementation steps remain blocked until this release wave is complete
- execute operational rollout controls defined in Reconcile endpoint contract before and after enabling auth checks
- extend socket-server `/health` with monitor runtime status + lock degradation state
- this phase-0 gate must be completed and validated before any step `17`/`18` implementation work starts
8. Hard prerequisite: Logs Monitors surface foundation migration:
- extend logs view mode from `logs|dashboard` to `logs|monitors|dashboard`
- make store URL init/sync parse and persist `view=monitors`
- align all existing view handlers (`logs.tsx` + dashboard components) to 3-state behavior
  - include dashboard controls component 3-mode migration (`logs/components/dashboard/components/controls.tsx`)
 - scope note: this step is UI/store view-mode foundation only and intentionally allowed before step `11` registration
 - logs API/parser/hook/export monitor filter contracts are implemented in step `13`
9. Indicator runtime extraction:
- collect trigger events in local and E2B paths
- keep warning channel for invalid trigger calls
- enforce local/E2B parity using same bridge normalization and validation logic
- this is the only step that finalizes runtime trigger extraction behavior (step `1` only bootstraps bridge infrastructure)
- feature usage remains blocked until step `20` editor typings/docs generation is also complete
10. Define webhook-backed monitor providerConfig schema and parser/validator.
11. Register `indicator_trigger` trigger config and block:
- keep block output schema tag-compatible
- remove trigger-side market config editing
- keep block subblocks guidance-only (`text`), no default-input fields
- do not compose `indicator_trigger` subblocks with `buildTriggerSubBlocks(...)`; define dedicated block subblocks directly
- treat non-reuse of webhook-coupled trigger plumbing as a hard dependency: if `indicator_trigger` still uses `buildTriggerSubBlocks(...)` or webhook-coupled `short-input`/`trigger-save` paths, step `11` fails and steps `12+` remain blocked
- registration requirements:
  - add `indicator_trigger` entry to `TRIGGER_REGISTRY` with `provider: 'indicator'`
  - add `indicator_trigger` block entry to block registry
  - keep `triggerId === block.type === 'indicator_trigger'`
12. Add monitor APIs (webhook-backed):
- list/create/update/delete/pause/activate monitor records
- validate workflow/block/provider/interval/indicator/listing/auth/provider params
- implement auth normalization + storage security contract (write-only secret encryption, response redaction)
 - monitor API validation depends on `indicator_trigger` block/registry existence from step 11
13. Extend logs query contract:
- add optional monitor metadata filters to `/api/logs`
- add equivalent monitor metadata filters to `/api/v1/logs`
- add hook support for monitor logs panel queries
 - add `/api/logs/export` monitor filter parity with `/api/logs` for Monitors view export
 - lock canonical monitor filter key/type contract across `/api/logs`, `/api/logs/export`, `/api/v1/logs`, and `hooks/queries/logs.ts` serialization
 - keep monitor filters as explicit query params only (no monitor filter derivation from `searchQuery` parser)
 - enforce monitor JSON-path performance guardrails (predicate gating + query timing telemetry + rollout regression gate)
 - hard dependency reminder: this step is blocked until step `6` logger merge-preserve durability is complete and validated
14. Add Logs `Monitors` tab UI:
- route `/workspace/[workspaceId]/logs` with `view=monitors`
- monitor table with required columns and row actions
- modal add/edit flow with provider/auth/listing/indicator+interval/workflow controls
- 3-dot menu pause/activate toggle tied to `isActive`
15. Implement monitor drill-in panels:
- row click opens run logs panel
- run log click opens log detail panel
- reuse existing logs list/detail interaction patterns
16. Implement monitor-driven dispatch in execute route from active indicator webhooks.
 - hard phase gate: this step must not start until step `3` non-HTTP gate/queue contract split is complete and Phase `A` exit validation passes
 - enforce latest-bar-only dispatch scope for manual execute route
 - resolve `dispatchInterval` deterministically (`interval` -> canonical `intervalMs` map only); unresolved interval yields warning + skip (no monitor lookup)
 - dispatch from emitted latest-bar `trigger(...)` candidates only; no synthetic/default-input fallback mode
 - enforce payload budget/truncation contract before queue (`MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES`, deterministic reduction, warning-based skip)
 - keep `/api/indicators/execute` response envelope as `success + data[]` and populate per-indicator `dispatch` summary + warning codes per the execute response contract
17. Implement deployed monitor runtime in socket-server:
- reconcile indicator monitor webhooks
- subscribe streams
- run backfill + live aggregation + indicator compute
- dispatch through queue/gates
- enforce payload budget/truncation contract before queue (`MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES`, deterministic reduction, warning-based skip)
- consume control-plane foundation implemented in step `7` (existing reconcile endpoint, control-plane auth enforcement, and `/health` monitor-runtime fields)
- do not re-implement control-plane endpoint/auth/health ownership in step `17`
- use monitor-runtime-specific fail-closed lock path when Redis is unavailable (do not reuse global fail-open semantics as-is)
18. Add lifecycle notifications for runtime reconcile:
- deploy/undeploy/revert/activate and monitor webhook CRUD/toggle events
 - wire lifecycle call-sites to step `7` control-plane contract (call existing `POST /internal/indicator-monitors/reconcile` and send `X-Internal-Secret`)
- in this step, extend app-side `X-Internal-Secret` caller coverage to deploy/undeploy/activate routes
- these deploy/undeploy/activate caller updates are validated in phase `F` (not phase `0`)
- before enabling phase-`F` auth enforcement for this lifecycle scope, re-validate live implementation-time caller inventory and confirm all discovered deploy/undeploy/activate callers are secret-enabled
- phase `F` exact enforcement sequence (blocking):
  1. update deploy/undeploy/activate callers to send `X-Internal-Secret`
  2. verify header emission for deploy/undeploy/activate caller paths in runtime logs
  3. enable/expand socket endpoint auth enforcement for this scope
  4. verify zero `401` denies for deploy/undeploy/activate in-scope callers post-enforcement
- this step owns call-site wiring only; endpoint/auth policy ownership remains in step `7`
- notification failures are non-blocking (log warning/error; do not fail primary mutation/deploy/undeploy/revert/activate response)
19. Keep verify route non-dispatching and trigger-first compatible.
- implement explicit trigger-only pass semantics from Execute Dispatch Contract item `6`
- keep `invalid_output` only for scripts with no visual output and no detected `trigger(...)` usage
- include `triggerUsageDetected` + `triggerOnly` fields in verify response data contract
- this is a required behavior change from current verify logic (current no-output path returns `400` `invalid_output` unconditionally); implementation is incomplete until trigger-only scripts return success + warning `trigger_only_script`
20. Update editor typings/docs to include `trigger(...)`.
- implement this through generator path only:
  - update `scripts/generate-pine-cheat-sheet.cjs` generation logic to include Studio-owned `trigger(...)` typing/docs entries
  - run generator to refresh `pine-cheat-sheet-typings.ts` and `pine-cheat-sheet-members.ts`
  - do not hand-edit generated files
- this is the only step that changes generated editor typings/docs exposure for `trigger(...)`
- feature usage remains blocked until step `9` runtime extraction is complete

## Planned File Touchpoints
1. Studio-owned `trigger(...)` runtime extension:
- `apps/tradinggoose/lib/indicators/run-pinets.ts`
- `apps/tradinggoose/lib/indicators/execution/e2b-script-builder.ts`
- `apps/tradinggoose/lib/indicators/execution/local-executor.ts`
- `apps/tradinggoose/lib/indicators/custom/compile.ts`
- `apps/tradinggoose/lib/indicators/normalize-context.ts`
- `apps/tradinggoose/lib/indicators/trigger-bridge.ts` (new)
2. `pinets` package consumption alignment (mismatch-only edits):
- validation-only when already aligned (no package/lock diffs from this step)
- `package.json` (mismatch only)
- `apps/tradinggoose/package.json` (mismatch only)
- `bun.lock` (mismatch only)
3. Monitor APIs (new, webhook-backed):
- `apps/tradinggoose/app/api/indicator-monitors/route.ts`
- `apps/tradinggoose/app/api/indicator-monitors/[id]/route.ts`
- `apps/tradinggoose/lib/utils.ts` (reuse `encryptSecret` helper for write-only monitor secret inputs)
4. Logs page + Monitors tab UI:
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/logs.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/dashboard/dashboard.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/dashboard/components/controls.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/monitors/*`
- `apps/tradinggoose/stores/logs/filters/types.ts`
- `apps/tradinggoose/stores/logs/filters/store.ts`
5. Logs filtering + queries:
- `apps/tradinggoose/app/api/logs/route.ts`
- `apps/tradinggoose/app/api/logs/export/route.ts`
- `apps/tradinggoose/app/api/v1/logs/route.ts`
- `apps/tradinggoose/app/api/v1/logs/filters.ts`
- `apps/tradinggoose/lib/logs/query-parser.ts`
- `apps/tradinggoose/hooks/queries/logs.ts`
 - `apps/tradinggoose/lib/logs/execution/logger.ts`
 - `apps/tradinggoose/lib/logs/execution/logging-factory.ts`
6. Indicator runtime:
- `apps/tradinggoose/lib/indicators/custom/compile.ts`
- `apps/tradinggoose/lib/indicators/normalize-context.ts`
- `apps/tradinggoose/lib/indicators/types.ts`
7. Trigger/block registration:
- `apps/tradinggoose/triggers/registry.ts`
- `apps/tradinggoose/triggers/index.ts`
- `apps/tradinggoose/blocks/registry.ts`
- `apps/tradinggoose/blocks/blocks/*` (new `indicator_trigger` block)
8. Dispatch and queue:
- `apps/tradinggoose/app/api/webhooks/route.ts` (generic webhook create/list guard for `provider = 'indicator'`)
- `apps/tradinggoose/app/api/webhooks/[id]/route.ts` (generic webhook get/update/delete guard for `provider = 'indicator'`)
- `apps/tradinggoose/app/api/webhooks/trigger/[path]/route.ts`
- `apps/tradinggoose/app/api/webhooks/test/[id]/route.ts`
- `apps/tradinggoose/app/api/webhooks/[id]/test-url/route.ts`
- `apps/tradinggoose/app/api/webhooks/test/route.ts`
- `apps/tradinggoose/app/api/indicators/execute/route.ts`
- `apps/tradinggoose/app/api/indicators/verify/route.ts`
- `apps/tradinggoose/lib/webhooks/processor.ts`
- `apps/tradinggoose/background/webhook-execution.ts`
- `apps/tradinggoose/lib/webhooks/utils.ts`
- `apps/tradinggoose/lib/workflows/db-helpers.ts`
 - `apps/tradinggoose/lib/redis.ts` (monitor-runtime-specific fail-closed lock path only)
9. Deployed runtime:
- `apps/tradinggoose/socket-server/index.ts`
- `apps/tradinggoose/socket-server/routes/http.ts`
- `apps/tradinggoose/socket-server/market/alpaca.ts`
- `apps/tradinggoose/socket-server/market/finnhub.ts`
- `apps/tradinggoose/socket-server/market/manager.ts`
- `apps/tradinggoose/lib/indicators/series-data.ts`
- `apps/tradinggoose/lib/redis.ts`
10. Lifecycle notifications:
- `apps/tradinggoose/app/api/workflows/[id]/route.ts` (workflow delete socket notification adds `X-Internal-Secret`)
- `apps/tradinggoose/app/api/workflows/[id]/deploy/route.ts`
- `apps/tradinggoose/app/api/workflows/[id]/deployments/[version]/revert/route.ts`
- `apps/tradinggoose/app/api/workflows/[id]/deployments/[version]/activate/route.ts`
- monitor API routes above
- note: no current in-repo HTTP callers target `/api/workflow-updated` or `/api/copilot-workflow-edit`; endpoint auth is still enforced for future/internal callers
11. Editor docs:
- `scripts/generate-pine-cheat-sheet.cjs`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet.ts`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-typings.ts`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-members.ts`

## Validation Checklist
1. `trigger(...)` callable in local + E2B runtime (no undefined error).
 - local + E2B both capture through Studio bridge (`Context.prototype.call` intercept path).
 - bridge intercept applies only to sentinel `trigger` function and does not affect non-trigger calls.
 - bridge matching is realm-safe: local VM realm + host realm + E2B realm all capture `trigger(...)` correctly.
 - trigger collection is execution-isolated (no cross-request/cross-workflow leakage under concurrency).
 - `runPineTS` path initializes bridge bootstrap and installs host-realm sentinel `globalThis.trigger` before `pine.run(...)` (required).
 - local executor path injects VM-realm sentinel `globalThis.trigger` before `Script.runInContext(...)` as supplemental path coverage (not a replacement for host-realm sentinel).
 - E2B executor script includes bridge bootstrap/sentinel setup before indicator evaluation.
2. Root/app/editor resolve same `pinets` build.
3. `indicator_trigger` ID consistency across block, registry, webhook linkage.
- `TRIGGER_REGISTRY` contains `indicator_trigger` with `provider: 'indicator'`.
- block registry contains `indicator_trigger` block entry.
4. Tag paths resolve from trigger block outputs.
 - no `{ type: 'object' }` leaf nodes for branches that require nested tag paths
5. Monitor save validation:
- rejects invalid workflow/block/provider/interval/indicator/listing/auth
- rejects non-trigger-capable indicator
- enforces provider streaming capability
- enforces provider-required multi-secret auth params (all required secret param ids must be satisfied)
- writes deterministic internal webhook path (`indicator-monitor-{monitorId}`)
- persists monitor auth using encrypted-secrets contract (no plaintext secrets in persisted `providerConfig.monitor.auth`)
- monitor API responses redact auth (no plaintext/ciphertext secrets; safe metadata only)
6. Logs Monitors tab behavior:
- table shows required columns and status tags
- row click opens logs panel for that monitor
- run log click opens log detail panel
- URL view mode supports and persists `view=monitors`
- all existing view-mode handlers are aligned to 3-mode behavior (`logs|monitors|dashboard`)
 - `indicator_trigger` block in workflow editor is guidance-only (`text`) and does not mutate webhook rows
- `indicator_trigger` subblocks do not use webhook-coupled component types (`short-input`, `trigger-save`) or webhook URL display id (`webhookUrlDisplay`)
 - manual/default-input dispatch fields are not present in `indicator_trigger` block subblocks
- `indicator_trigger` definition does not use `buildTriggerSubBlocks(...)`
- checklist failure rule: if `indicator_trigger` resolves through generic webhook trigger plumbing (`buildTriggerSubBlocks(...)`, `short-input`, `trigger-save`, `useWebhookManagement`), this item fails and phase `B` cannot pass
7. Row edit behavior:
- 3-dot menu `Edit` opens monitor config modal
- modal exposes required selectors/editors and validates before save
- modal `Save`/`Cancel` actions close or keep form based on validation result
8. Row activate/pause behavior:
- 3-dot menu shows `Pause` for active monitors and `Activate` for paused monitors
- toggle updates `webhook.isActive`
- paused monitors stop new runtime dispatch until re-activated
9. Internal webhook linkage:
- monitor id equals webhook id
- monitor edits update linked indicator webhook record
 - monitor APIs do not expose `webhook.path`
10. Runtime reconcile:
- add/update/remove subscriptions on indicator monitor webhook changes
- remove subscriptions on workflow undeploy
- does not run monitor dispatch loop without Redis lock (fail-closed)
- socket-server control-plane POST endpoints require internal-secret auth (`/internal/indicator-monitors/reconcile`, `/api/workflow-deleted`, `/api/workflow-updated`, `/api/workflow-reverted`, `/api/copilot-workflow-edit`)
- missing/invalid `X-Internal-Secret` returns `401` and no side effects
- phase `0`/step `7` validation: currently existing in-repo callers (`workflow delete`, `deployment revert`) send `X-Internal-Secret`
- phase `F`/step `18` validation: deploy/undeploy/activate routes send `X-Internal-Secret` when lifecycle reconcile wiring is added
- implementation-time caller inventory is re-validated at each enforcement phase gate (`0` and `F`) immediately before enabling/expanding auth enforcement
- if re-validation finds additional callers in the active phase scope that are not secret-enabled, the phase gate fails and auth enforcement expansion must not proceed
- auth rollout is atomic per phase scope: no production window with enforced endpoint auth and stale headerless in-repo callers for the callers introduced in that phase (step `7` callers in phase `0`, step `18` callers in phase `F`)
- explicit phase `0` failure condition: if either delete or revert notification path is still headerless while endpoint auth is enabled, phase `0` fails and monitor runtime work remains blocked
- phase-0 security gate (step `7`) is validated before any monitor runtime/lifecycle implementation (`steps 17-18`) is started or enabled
- no unauthenticated compatibility path exists for these internal endpoints; non-secret out-of-repo callers are intentionally unsupported
- control-plane auth rollout risk controls are executed: 7-day baseline captured pre-enforcement, 24h post-rollout `401` monitoring reviewed per phase, and no compatibility fallback applied
- socket-server `/health` includes monitor runtime status (including degraded lock state)
11. Emission collapse/idempotency:
- max one emission per monitor + bar bucket
- deterministic `eventId` reused on retry
- live runtime eventId formula uses `indicator_trigger_live|{monitorId}|{indicatorId}|{barBucketMs}`
- manual execute eventId formula uses `indicator_trigger_manual|{executeRequestId}|{monitorId}|{indicatorId}|{barBucketMs}`
- manual/live eventId domains do not collide because prefixes differ
- manual retries within one execute request reuse eventId; separate execute requests generate different eventIds
12. Queue dispatch:
- gate checks run before queue
- `x-event-id` passed via header override
- gate failures return warnings and do not kill runtime
- internal dispatch path does not require `NextRequest` construction and does not consume `NextResponse` gate objects
- internal dispatch path does not call legacy HTTP-bound processor signatures as-is (`checkRateLimits`, `checkUsageLimits`, `queueWebhookExecution(request: NextRequest, ...)`)
- this checklist item is a hard phase gate: if any HTTP-bound internal dispatch coupling remains, phase `A` fails and phases `B+` are blocked
- core gate function signatures used by internal dispatch return plain `DispatchGateResult` (no `NextResponse` return types)
- checklist failure rule: if any internal dispatch path still depends on `NextRequest` input or `NextResponse` gate outputs, this item fails and phase `E` cannot pass
- HTTP adapters preserve provider-specific deny response payloads for external routes (including `microsoftteams` message shape for rate/usage limits)
- serialized indicator dispatch payload is bounded by `MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES` after deterministic truncation
- truncation/skip telemetry includes `monitorId`, `workflowId`, `originalSizeBytes`, `finalSizeBytes`, `retainedBars`
- payloads still over budget after truncation are skipped with warning (non-fatal)
 - manual execute dispatch uses deterministic `dispatchInterval` resolution (`interval` -> canonical `intervalMs` map only)
 - unresolved `dispatchInterval` yields warning code `indicator_trigger_dispatch_interval_unresolved` + dispatch skip `interval_unresolved` (no monitor lookup)
13. Monitor logs filtering:
- logs panel returns only selected monitor runs via monitor metadata filters
- log detail view remains identical to Logs page behavior
 - `/api/logs` and `/api/v1/logs` monitor filters are parity-aligned
 - `/api/logs/export` monitor filters are parity-aligned with `/api/logs` for Monitors view export
 - monitor filter query key names/types are parity-aligned across `/api/logs`, `/api/logs/export`, `/api/v1/logs`, and `hooks/queries/logs.ts`
 - monitor filters are serialized as explicit query params only; `searchQuery` parser does not infer monitor filter fields
 - logs query parser remains scoped to existing free-text filters and must not synthesize monitor filter params
 - monitor metadata remains queryable after completion updates
 - completion must not drop pre-existing `executionData.trigger` or `executionData.environment`
 - monitor-filtered queries emit timing telemetry in `/api/logs` and `/api/v1/logs`
 - rollout verification confirms monitor-filtered p95 query latency regression is <= 25% vs baseline on same dataset
14. Indicator webhook formatting:
- indicator payload remains root passthrough after webhook formatting
- expected root tag paths stay intact (`event`, `input`, `monitor.*`, etc.)
15. Runtime singleton behavior:
- monitor runtime is fail-closed when Redis is unavailable (no dispatch loop)
- monitor runtime uses scoped monitor lock API and does not call shared `acquireLock(...)` directly
 - existing Gmail/Outlook polling behavior is unchanged by monitor-runtime lock changes and continues using shared `acquireLock(...)`
16. Logging metadata enrichment:
- trigger logs include canonical `trigger.source = 'indicator_trigger'` + `triggerData.monitor.*` for monitor drill-in filters
 - source selector uses top-level `trigger.source` (`indicator_trigger`)
 - persisted monitor-trigger logs must not duplicate source under `trigger.data.source`
17. Trigger arg normalization safety:
- no raw `Series` objects are persisted in collected trigger payloads
- event/signal/input/condition are normalized from current bar values at capture time
- result is JSON-safe and deterministic for dispatch/idempotency
18. Manual execute dispatch determinism:
- `/api/indicators/execute` dispatch evaluates latest-bar candidates only
- at most one dispatch per monitor per execute request
- no synthetic/default-input fallback mode is allowed; dispatch uses emitted candidates only
- when no emitted latest-bar candidates remain after filtering/collapse, dispatch records `no_latest_candidate`
- `/api/indicators/execute` top-level response remains `{ success, data[] }`
- dispatch outcomes are represented per indicator result via optional `dispatch` summary (no new top-level warnings field)
- warning codes for dispatch anomalies are deterministic (`indicator_trigger_dispatch_interval_unresolved`, `indicator_trigger_gate_blocked`, `indicator_trigger_payload_truncated`, `indicator_trigger_payload_too_large`, `indicator_trigger_queue_failed`)
- skip outcomes are represented in `dispatch.skipped[]` with fixed skip code set
- dispatch warnings/skips do not convert successful indicator execution into `executionError`
19. Verify route trigger-only behavior:
- `/api/indicators/verify` stays non-dispatching in all branches
- trigger-only scripts pass verify when `triggerUsageDetected === true` even with zero plots/markers/signals
- verify returns deterministic `triggerUsageDetected` and `triggerOnly` fields
- `invalid_output` is returned only when zero plots/markers/signals and `triggerUsageDetected === false`
- checklist failure rule: if trigger-only scripts still return `400` `invalid_output`, this item fails and phase `F` cannot pass
20. No default-input fallback behavior:
- indicator-trigger dispatch follows webhook-style emission behavior: dispatch only from emitted `trigger(...)` candidates
- no start-trigger-style defaults or synthetic fallback dispatch path is allowed
- absence of emitted latest-bar candidates results in no dispatch (`no_latest_candidate`)
21. Internal-only monitor webhook safeguard:
- external `POST /api/webhooks/trigger/[path]` for `provider = 'indicator'` is rejected with `403`
- rejected external indicator requests never reach queue/execute path
- rejected external indicator requests short-circuit before provider auth/rate-limit/usage checks
- provider-specific compatibility short-circuit branches remain supported for non-indicator providers on `/api/webhooks/trigger/[path]` (including existing Microsoft Graph `validationToken` token-echo behavior on `GET` and `POST`)
- indicator requests must be denied before compatibility short-circuit evaluation
- no new compatibility behavior is introduced by this feature; existing non-indicator behavior is preserved
- non-regression scope note: non-indicator external webhook behavior (including existing provider compatibility flows) is preserved
- external `POST /api/webhooks/test/[id]` for `provider = 'indicator'` is rejected with `403`
- `/api/webhooks/test/[id]` token verification (`401` on missing/invalid token) runs before webhook lookup and before body parse/provider challenge handling
- rejected indicator test-receiver requests never reach queue/execute path
- `POST /api/webhooks/[id]/test-url` for `provider = 'indicator'` is rejected with `403` and does not mint test URL tokens
- `GET /api/webhooks/test?id=<webhookId>` for `provider = 'indicator'` is rejected with `403` and does not expose `webhook.url`/path-derived URLs
- `GET /api/webhooks/test?id=<webhookId>` requires authenticated session + ownership/workspace write/admin permission
- generic webhook CRUD bypass is blocked:
  - `POST /api/webhooks` rejects `provider = 'indicator'` with `403`
  - `PATCH /api/webhooks/[id]` and `DELETE /api/webhooks/[id]` reject target `provider = 'indicator'` rows with `403`
  - `GET /api/webhooks` excludes indicator rows in both list branches (`workflowId + blockId` and default user-owned list)
- `GET /api/webhooks/[id]` returns `404` for indicator rows
- internal manual/socket dispatch for indicator monitor still works
- guard enforcement is coordinated across all listed webhook surfaces; partial guard rollout fails this checklist item
- phase rollout is blocked if any external/generic webhook surface still allows `provider = 'indicator'` create/read/update/execute/test-url mint/test helper bypass
22. Editor cheat-sheet generation integrity:
- rerunning `scripts/generate-pine-cheat-sheet.cjs` keeps generated files deterministic (no unexpected diff after committed changes)
- generated `pine-cheat-sheet-typings.ts` contains Studio-owned `trigger(...)` declaration
- generated `pine-cheat-sheet-members.ts` includes `trigger` in surfaced script API members
23. `trigger(...)` usage readiness gate:
- runtime bridge extraction is active in both local + E2B paths and verified by item `1`
- generated editor API exposure is complete and verified by item `22`
- checklist failure rule: if either side is missing, feature usage is blocked and this checklist fails

## Phase-Gated Validation Commands (Bun/Turbo)
Notes:
1. This section is a phase-gate runbook for rollout execution, not an immediate day-0 implementation checklist.
2. Commands become runnable phase-by-phase as planned code and tests land.
3. Missing test files before their owning phase are expected; they become mandatory at that phase gate.
4. Do not run future-phase command blocks early; execute only global checks plus the currently active phase block.
5. Current branch is expected to have missing future-phase tests until those phases are implemented.
6. Full end-to-end runbook execution is intentionally deferred until all planned phase files/tests exist.

Execution policy:
1. Run all commands from repo root.
2. The active phase exits only when every listed command for that phase returns exit code `0`.
3. This runbook is a phase-exit gate (not day-0 bootstrap); it is expected to become runnable as planned phase test files are added.
4. If any listed targeted test file for the active phase is missing, treat that phase as failed/incomplete (do not skip); create the missing phase test files first, then rerun.
5. If any command fails, stop forward progress, fix inside the same phase, and rerun the full phase command set.
6. Keep command order stable: global checks first, phase-targeted checks second.

Global checks (required at the end of every phase):
1. `bun run check`
2. `bunx turbo run type-check --filter=tradinggoose`

Phase `0` exit commands (step `7`):
1. `bun --cwd apps/tradinggoose run test -- 'socket-server/routes/http.test.ts'`
2. `bun --cwd apps/tradinggoose run test -- 'app/api/workflows/[id]/route.test.ts' 'app/api/workflows/[id]/deployments/[version]/revert/route.test.ts'`

Phase `A` exit commands (steps `1-6` and `8`):
1. `bun -e "import fs from 'node:fs'; const root = JSON.parse(fs.readFileSync('package.json', 'utf8')); const app = JSON.parse(fs.readFileSync('apps/tradinggoose/package.json', 'utf8')); if (root.dependencies?.pinets !== app.dependencies?.pinets) { console.error('pinets version mismatch between root/app'); process.exit(1) }"`
2. `bun --cwd apps/tradinggoose run test -- 'lib/indicators/trigger-bridge.test.ts' 'lib/logs/execution/logger.test.ts'`
3. `bun --cwd apps/tradinggoose run test -- 'app/workspace/[workspaceId]/logs/logs.test.tsx'`
4. `bun --cwd apps/tradinggoose run test -- 'lib/webhooks/processor.test.ts'`

Phase `B` exit commands (steps `9-11`):
1. `bun --cwd apps/tradinggoose run test -- 'blocks/blocks/indicator_trigger.test.ts' 'triggers/registry.test.ts' 'blocks/registry.test.ts'`

Phase `C` exit commands (steps `12-13`):
1. `bun --cwd apps/tradinggoose run test -- 'app/api/indicator-monitors/route.test.ts'`
2. `bun --cwd apps/tradinggoose run test -- 'app/api/logs/route.test.ts' 'app/api/logs/export/route.test.ts' 'app/api/v1/logs/filters.test.ts' 'lib/logs/query-parser.test.ts'`

Phase `D` exit commands (steps `14-15`):
1. `bun --cwd apps/tradinggoose run test -- 'app/workspace/[workspaceId]/logs/logs.test.tsx'`

Phase `E` exit commands (steps `16-17`):
1. `bun --cwd apps/tradinggoose run test -- 'app/api/indicators/execute/route.test.ts' 'lib/webhooks/processor.test.ts'`
2. `bun --cwd apps/tradinggoose run test -- 'app/api/webhooks/trigger/[path]/route.test.ts' 'app/api/webhooks/test/[id]/route.test.ts' 'app/api/webhooks/[id]/test-url/route.test.ts' 'app/api/webhooks/test/route.test.ts' 'app/api/webhooks/route.test.ts' 'app/api/webhooks/[id]/route.test.ts'`
3. `bun --cwd apps/tradinggoose run test -- 'socket-server/market/indicator-trigger-runtime.test.ts' 'executor/handlers/trigger/trigger-handler.test.ts'`

Phase `F` exit commands (steps `18-20`):
1. `bun --cwd apps/tradinggoose run test -- 'app/api/workflows/[id]/route.test.ts' 'app/api/workflows/[id]/deploy/route.test.ts' 'app/api/workflows/[id]/deployments/[version]/revert/route.test.ts' 'app/api/workflows/[id]/deployments/[version]/activate/route.test.ts'`
2. `bun run scripts/generate-pine-cheat-sheet.cjs`
3. `git diff --exit-code -- 'apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-typings.ts' 'apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-members.ts'`
4. `bunx turbo run test --filter=tradinggoose`
5. `bun --cwd apps/tradinggoose run test -- 'app/api/indicators/verify/route.test.ts'`

## Test Touchpoints
Note: several tests below are planned new files and do not exist yet in current codebase; this is intentional for phased rollout and is not a plan defect.
1. `apps/tradinggoose/app/api/indicator-monitors/route.test.ts` (new):
- create/update/delete monitor validation and persistence (webhook-backed)
- pause/activate toggle updates `isActive`
- workflow/block permission and ownership checks
 - response shape does not expose internal `webhook.path`
- write-only monitor secret input is encrypted per provider auth param id before persistence and never returned in API responses
- providers with multiple required auth secret params persist encrypted values per required param id and reject partial auth payloads
- monitor API responses never expose plaintext/ciphertext secret values in auth payloads
- persistence rejects plaintext secret fields in `providerConfig.monitor.auth`
2. `apps/tradinggoose/app/api/indicators/execute/route.test.ts`:
- dispatch target validation
- webhook-backed monitor lookup
- header override + warning behavior
 - response contract remains `{ success, data[] }` with per-indicator dispatch outcomes
 - dispatch summary shape (`attempted`, `monitorsMatched`, `monitorsDispatched`, `monitorsSkipped`, `skipped[]`) is present when dispatch is enabled
 - dispatch warning codes are deterministic and mapped to skip outcomes
 - dispatch skips/warnings do not set `executionError` when indicator execution itself succeeds
 - manual dispatch eventId uses `indicator_trigger_manual|{executeRequestId}|{monitorId}|{indicatorId}|{barBucketMs}`
 - retries within one execute request reuse identical `x-event-id`
 - separate execute requests produce different manual eventIds
 - manual eventId namespace does not collide with live runtime (`indicator_trigger_live|...`)
 - concurrent executions keep isolated trigger buffers
 - latest-bar-only dispatch scope
 - no synthetic/default-input fallback dispatch path exists
 - dispatch interval matching uses resolved `dispatchInterval` (exact monitor interval match)
 - missing `interval` resolves from full canonical market `intervalMs` mapping (shared source, not subset hardcoding)
 - unresolved interval (no `interval` and unsupported `intervalMs`) yields warning `indicator_trigger_dispatch_interval_unresolved` and skip `interval_unresolved`
 - no interval inference from market-series bar-gap heuristics
 - no manual-default source precedence exists (request/block defaults are not part of dispatch contract)
 - no emitted latest-bar candidates after allowlist/collapse yields skip `no_latest_candidate`
 - internal dispatch path uses non-HTTP gate results and internal queue context (no `NextRequest` dependency)
 - no synthetic/fabricated `NextRequest` shim is used for internal dispatch
 - payload over budget is deterministically truncated before queue dispatch
 - payload still over budget after truncation yields warning and skips queue dispatch
3. `apps/tradinggoose/lib/webhooks/utils.indicator.test.ts` (new):
- `provider === 'indicator'` returns root payload passthrough
- non-indicator providers remain wrapped
4. `apps/tradinggoose/app/api/logs/route.test.ts`:
- monitor metadata filters (`monitorId`, `listing`, `indicatorId`, `providerId`, `interval`)
 - `QueryParamsSchema` accepts canonical monitor filter keys with string/optional typing
 - empty monitor filter params do not add monitor JSON-path predicates
 - `triggerSource` filter is evaluated against top-level `executionData.trigger.source`
5. `apps/tradinggoose/app/api/logs/export/route.test.ts` (new):
- monitor metadata filters parity with `/api/logs` when export is called from Monitors view
 - `ExportParamsSchema` accepts same canonical monitor filter keys and semantics as `/api/logs`
6. `apps/tradinggoose/app/api/v1/logs/filters.test.ts` (new):
- monitor metadata filter parsing parity with `/api/logs`
 - `/api/v1/logs/route.ts` query parser + `filters.ts` use identical canonical monitor filter keys/types
7. `apps/tradinggoose/lib/logs/query-parser.test.ts` (new):
- existing free-text filter parsing remains unchanged
- `apps/tradinggoose/hooks/queries/logs.ts` serializes monitor filter fields for `/api/logs` and `/api/v1/logs` requests
 - free-text `searchQuery` parser does not synthesize canonical monitor filter params
8. `apps/tradinggoose/lib/logs/execution/logger.test.ts` (new):
- completion update preserves existing `executionData.trigger` metadata
- completion update preserves existing `executionData.environment` metadata
- completion update stores trace/output/cost fields without replacing prior `executionData` object
- indicator monitor trigger rows persist canonical source field only: `executionData.trigger.source = 'indicator_trigger'`
- indicator monitor trigger rows do not persist duplicate `executionData.trigger.data.source`
9. `apps/tradinggoose/app/workspace/[workspaceId]/logs/logs.test.tsx` (new):
- view toggle supports `Logs` / `Monitors` / `Dashboard`
- `view=monitors` URL initialization and sync
10. `apps/tradinggoose/blocks/blocks/indicator_trigger.test.ts` (new):
- block subblocks are guidance-only `text`
- block excludes `trigger-save` and `webhookUrlDisplay` id
- block excludes `short-input`-based webhook wiring
- block excludes manual/default-input dispatch fields
- block definition does not compose subblocks through `buildTriggerSubBlocks(...)`
11. `apps/tradinggoose/triggers/registry.test.ts` (new):
- `indicator_trigger` is registered in `TRIGGER_REGISTRY`
- `indicator_trigger` trigger provider is `indicator`
12. `apps/tradinggoose/blocks/registry.test.ts` (new):
- `indicator_trigger` block is present in block registry
- `indicator_trigger` block type/id contract matches trigger id
13. `apps/tradinggoose/socket-server/market/indicator-trigger-runtime.test.ts` (new):
- reconcile from indicator webhook records
- startup backfill + live-only updates
- collapse per monitor + bar
- deterministic event id + queue payload
- payload budget enforcement truncates deterministically and emits telemetry fields
- payload still over budget after truncation is skipped with warning while runtime loop continues
- runtime lock behavior is scoped: monitor runtime uses monitor-specific lock API (not shared `acquireLock(...)`)
- monitor runtime lock path is fail-closed when Redis client is unavailable
- Gmail/Outlook poller lock behavior remains unchanged (shared `acquireLock(...)` path)
14. `apps/tradinggoose/lib/indicators/trigger-bridge.test.ts` (new):
- `Context.prototype.call` intercept for sentinel matches, including realm-safe marker-based matching
- non-trigger calls delegate unchanged to original behavior
- argument normalization resolves current-bar values via context
- `AsyncLocalStorage` isolation across parallel indicator executions
 - local host-realm `runPineTS` execution captures `trigger(...)` after host-realm sentinel install (without requiring VM-wrapper sentinel)
 - local VM context execution captures `trigger(...)` after VM-realm sentinel injection
15. `apps/tradinggoose/socket-server/routes/http.test.ts`:
- internal runtime reconcile notification endpoint
- `/health` includes monitor runtime status fields
- all control-plane POST endpoints reject missing/invalid `X-Internal-Secret` with `401`
- all control-plane POST endpoints accept valid `X-Internal-Secret` and keep existing side effects
 - no unauthenticated compatibility path for control-plane endpoints
16. `apps/tradinggoose/app/api/webhooks/trigger/[path]/route.test.ts`:
- rejects `provider = 'indicator'` webhook path with `403` and no queue dispatch
- rejects `provider = 'indicator'` before provider auth/rate-limit/usage checks
- malformed request body on `provider = 'indicator'` POST request still returns `403` (guard runs pre-parse)
- provider-specific compatibility short-circuit behavior is preserved for non-indicator providers (including existing Microsoft Graph `validationToken` token-echo behavior on `GET` and `POST`)
- compatibility short-circuit evaluation runs only after webhook resolve + explicit non-indicator provider check
- non-regression for non-indicator external webhook behavior, including existing provider compatibility flows
17. `apps/tradinggoose/app/api/webhooks/test/[id]/route.test.ts` (new):
- route compiles/runs against migrated gate + queue contracts after Step 3 signature changes
- uses updated HTTP adapter path (no stale direct dependency on legacy processor signatures)
- missing/invalid test token returns `401` before webhook lookup/indicator guard and before body parse/provider challenge handling; does not leak webhook/provider existence via `404`/`403`
- rejects `provider = 'indicator'` webhook id with `403` and no queue dispatch
- with valid token, rejects `provider = 'indicator'` before body parse/challenge/auth/rate checks
- non-regression for non-indicator test receiver behavior
18. `apps/tradinggoose/lib/webhooks/processor.test.ts` (new):
- internal gate adapter returns plain result shape and is used by manual/socket internal dispatch
- `checkRateLimits`/`checkUsageLimits` core evaluators return plain `DispatchGateResult` (no `NextResponse` in internal path)
- HTTP route wrappers continue to map gate results to `NextResponse`
- HTTP mapping preserves provider-specific deny payloads for `microsoftteams` (rate + usage)
- HTTP mapping preserves generic deny payloads for non-`microsoftteams` providers
- HTTP mapping preserves pinned-api-key-required payload shape
- internal queue context path supports header overrides without `NextRequest`
19. `apps/tradinggoose/executor/handlers/trigger/trigger-handler.test.ts`:
- non-regression on trigger payload pass-through
20. `apps/tradinggoose/app/api/webhooks/[id]/test-url/route.test.ts` (new):
- rejects `provider = 'indicator'` webhook id with `403`
- does not mint tokenized test URL for indicator webhook rows
- non-regression for non-indicator test URL mint behavior
21. `apps/tradinggoose/app/api/webhooks/test/route.test.ts` (new):
- rejects unauthenticated requests (`401`)
- enforces ownership/workspace write/admin permission for requested webhook id
- rejects `provider = 'indicator'` webhook id with `403`
- does not expose `webhook.url`/path-derived URLs for indicator webhook rows
- non-regression for non-indicator helper behavior
22. `apps/tradinggoose/app/api/webhooks/route.test.ts` (new):
- `POST /api/webhooks` rejects `provider = 'indicator'` with `403`
- `GET /api/webhooks` excludes `provider = 'indicator'` rows in `workflowId + blockId` branch
- `GET /api/webhooks` excludes `provider = 'indicator'` rows in default user-owned list branch
- non-regression for non-indicator webhook CRUD list/create behavior
23. `apps/tradinggoose/app/api/webhooks/[id]/route.test.ts` (new):
- `GET /api/webhooks/[id]` returns `404` for indicator webhook rows
- `PATCH /api/webhooks/[id]` and `DELETE /api/webhooks/[id]` reject indicator webhook rows with `403`
- non-regression for non-indicator webhook get/update/delete behavior
24. `apps/tradinggoose/app/api/workflows/[id]/route.test.ts` (new/updated, phase `0` / step `7`):
- workflow delete socket notification includes `X-Internal-Secret` header
- socket notification failure remains non-blocking
25. `apps/tradinggoose/app/api/workflows/[id]/deployments/[version]/revert/route.test.ts` (new/updated, phase `0` / step `7`):
- workflow revert socket notification includes `X-Internal-Secret` header
- socket notification failure remains non-blocking
26. `apps/tradinggoose/app/api/workflows/[id]/deploy/route.test.ts` (new/updated, phase `F` / step `18`):
- workflow deploy socket notification includes `X-Internal-Secret` header
- workflow undeploy socket notification includes `X-Internal-Secret` header
- socket notification failure remains non-blocking for deploy/undeploy flows
27. `apps/tradinggoose/app/api/workflows/[id]/deployments/[version]/activate/route.test.ts` (new/updated, phase `F` / step `18`):
- workflow activate socket notification includes `X-Internal-Secret` header
- socket notification failure remains non-blocking
28. Monitor logs performance rollout check (manual/staging):
- run `/api/logs` and `/api/v1/logs` with monitor filters on representative workspace datasets
- compare p95 query latency against pre-monitor baseline on same dataset
- block Monitors-tab default rollout if regression exceeds 25% until query plan is optimized
29. `apps/tradinggoose/app/api/indicators/verify/route.test.ts` (new):
- verify remains non-dispatching and never emits dispatch summary
- trigger-only script (`trigger(...)` usage with zero plots/markers/signals) returns success with warning `trigger_only_script`
- verify response includes deterministic `triggerUsageDetected` and `triggerOnly` fields
- no-output script without trigger usage returns `invalid_output`
- explicit regression check: current behavior (`400` `invalid_output` for trigger-only scripts) is removed

## Backout Plan
1. Disable monitor runtime dispatch service.
2. Keep indicator webhooks intact but stop reconciling subscriptions.
3. Keep `trigger(...)` collector behavior but disable workflow dispatch.
4. Hide Logs `Monitors` tab view entry.
5. Remove `indicator_trigger` registry/block entries if rollback requires full disable.
