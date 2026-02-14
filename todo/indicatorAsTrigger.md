# Indicator Trigger API (TODO)

## Goal
Define indicator script trigger API:
`trigger('event_name', options)`.

This must integrate with existing workflow trigger infrastructure and be directly usable as implementation instructions.

## Verified Current Constraints
1. `trigger(...)` is not available in PineTS runtime today.
- `../PineTS/src/transpiler/settings.ts` (no `trigger` in context vars)
- `../PineTS/src/namespaces/Core.ts` (no `Core.trigger(...)`)
- `../PineTS/src/types/PineTypes.ts` (no trigger declaration)
- indicator execution currently only runs `new Indicator(code, inputs)`:
  - `apps/tradinggoose/lib/indicators/run-pinets.ts`
  - `apps/tradinggoose/lib/indicators/execution/e2b-script-builder.ts`
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
7. PineTS is consumed from different package roots today:
- runtime path depends on `apps/tradinggoose/package.json`
- cheat-sheet generator reads root `node_modules/pinets` via `scripts/generate-pine-cheat-sheet.cjs`
- root and app `pinets` versions must be aligned to avoid runtime/editor drift
8. Existing Logs page already provides the target split-panel interaction model.
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/logs.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/logs-list/logs-list.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/log-details/log-details.tsx`
9. Current logs API does not yet provide first-class monitor filters.
- `apps/tradinggoose/app/api/logs/route.ts`
10. Existing webhook table already supports monitor config storage (`providerConfig` + `isActive` + unique `path`).
- `packages/db/schema.ts`

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
6. Root and app `pinets` dependency versions must resolve to the same build before implementation.
7. `indicator_trigger` registry entry must use `provider: 'indicator'`.
8. Monitor configuration is webhook-backed only:
- no `indicator_monitor_configs` table
- no `indicator_monitor_auth_profiles` table

## Public Script API
```ts
type TriggerMarkerPosition = 'aboveBar' | 'belowBar' | 'inBar'
type IndicatorTriggerSignal = 'long' | 'short' | 'flat'

type IndicatorTriggerOptions = {
  condition: boolean
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
3. `condition` is required boolean:
- `true` => emit
- `false` => no emit
4. `input` is required (workflow primary text input).
5. `signal` is required and one of `long` | `short` | `flat`.
6. Marker options are optional:
- `position` default: `aboveBar`
- `color` optional valid color string
7. `triggerMarker.text` always equals `event`.
8. Script API does not accept `value`, `data`, `eventId`, or `dedupeKey`.

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
  time: number
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
    listingKey: string
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

## Trigger Registration + Block Model
1. Register trigger config with id `indicator_trigger` in:
- `apps/tradinggoose/triggers/registry.ts`
- `apps/tradinggoose/triggers/index.ts`
2. Add category trigger block with type `indicator_trigger` in:
- `apps/tradinggoose/blocks/registry.ts`
- `apps/tradinggoose/blocks/blocks/*` (new block)
3. For this block, define `block.outputs` directly (or shared constant mirrored to block + trigger registry) to satisfy current tag-dropdown behavior for category triggers.
4. `indicator_trigger` is a special category trigger block and does not follow generic-webhook subblock plumbing.
5. `indicator_trigger` subblocks are instruction-only and must not include webhook-management controls:
- no `triggerSave`
- no `webhookUrlDisplay`
- no `short-input` subblocks (to avoid implicit webhook management coupling)
- no editable trigger credential/path/provider fields
6. Workflow editor for `indicator_trigger` must not call `useWebhookManagement`; monitor webhook rows are managed only from monitor APIs/UI.

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
    listingKey: { type: 'string', description: 'Resolved listing key.' },
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
- `<triggerBlock.monitor.listingKey>`
- `<triggerBlock.monitor.providerId>`

## Webhook-Backed Monitor Storage Contract
A monitor config is a webhook row with `provider = 'indicator'`.

```ts
type IndicatorWebhookProviderConfig = {
  triggerId: 'indicator_trigger'
  version: 1
  monitor: {
    providerId: string
    interval: string
    listing: ListingIdentity
    listingKey: string
    indicatorId: string
    warmupBars: number
    eventAllowlist?: string[]
    signalAllowlist?: Array<'long' | 'short' | 'flat'>
    auth?: {
      apiKey?: string
      apiSecret?: string
    }
    providerParams?: Record<string, unknown>
  }
}

type IndicatorMonitorRecord = {
  monitorId: string // alias of webhook.id
  workflowId: string // webhook.workflowId
  blockId: string // webhook.blockId
  path: string // webhook.path
  isActive: boolean // webhook.isActive
  providerConfig: IndicatorWebhookProviderConfig // webhook.providerConfig
  createdAt: string
  updatedAt: string
}
```

Rules:
1. `monitorId` is `webhook.id` (no separate monitor id table).
2. `webhook.path` is deterministic and immutable: `indicator-monitor-{monitorId}`.
3. All monitor runtime settings live in `webhook.providerConfig.monitor`.
4. Auth and provider params are stored directly in `providerConfig.monitor.auth` and `providerConfig.monitor.providerParams`.
5. `webhookId` is internal plumbing only and is never exposed in UX labels.
6. Credential edits update the same webhook row in place; no workflow redeploy is required.
7. Monitor APIs persist monitor rows directly (typed monitor API path), not through generic `/api/webhooks` POST.

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
4. indicator
5. workflow (with interval badge)
6. actions

Row actions behavior:
1. Non-edit mode actions column shows 3-dot menu.
2. 3-dot menu contains `Edit`, `Pause` or `Activate` (based on current state), and `Remove`.
3. Edit mode row cells become editable controls:
- col 1: provider dropdown
- col 2: auth dropdown/editor
- col 3: listing selector
- col 4: indicator selector
- col 5: workflow selector (with interval selector in same cell)
4. Edit mode actions column switches to check/cross buttons (`Save` / `Discard`).
5. Save writes only if normalized row is valid; otherwise show inline field errors and keep row in edit mode.

Dropdown source contract:
1. provider options from `getMarketProviderOptionsByKind('live')` filtered by `getMarketLiveCapabilities(providerId)?.supportsStreaming === true`.
2. auth dropdown/editor fields from provider live param definitions (`getMarketProviderParamCatalog('live')`) scoped to selected provider.
3. listing options from existing listing selector (`ListingSelector`).
4. indicator options from custom indicators (`GET /api/indicators/custom?workflowId=<workflowId>`) merged with defaults; include only trigger-capable indicators.
5. workflow selector options are workflow-block targets:
- include only workflows with at least one `indicator_trigger` block
- if multiple `indicator_trigger` blocks exist in one workflow, create one option per block and persist both `workflowId` and `blockId`
6. interval options from `getMarketSeriesCapabilities(providerId)?.intervals ?? []`.
7. Interval source rule is explicit for live monitors:
- provider eligibility is gated by `getMarketLiveCapabilities(...).supportsStreaming`
- interval options always come from `getMarketSeriesCapabilities(providerId)?.intervals ?? []`, even when live capability flags do not advertise interval support

Required user-editable fields per monitor:
1. `workflowId`
2. `blockId`
3. `providerId`
4. `interval`
5. `indicatorId`
6. `listing`
7. provider-required auth fields (derived from provider param definitions)

Optional user-editable fields per monitor:
1. `warmupBars` (default `500`, clamp `[100, 2000]`).
2. `eventAllowlist`.
3. `signalAllowlist` (`long | short | flat`).
4. provider optional params.

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
1. Do not store market provider/interval/indicator/listing/auth in block subblocks.
2. Block remains output schema anchor for tag dropdown and trigger payload consumption.
3. Block subblocks may include read-only instructions pointing users to Logs `Monitors` tab.
4. Block UI must never mutate webhook rows directly; all monitor row create/update/delete/toggle flows go through monitor APIs.
5. Allowed subblock types for `indicator_trigger` are read-only/instruction types only; exclude webhook-coupled input types.

## Monitor Save + Internal Webhook Sync Contract
Monitor save pipeline (webhook-backed):
1. Validate and normalize monitor fields.
2. Validate target workflow/block ownership and permissions in workspace.
3. Validate target block exists and is type `indicator_trigger`.
4. Validate provider supports live streaming and selected interval.
5. Validate indicator is trigger-capable.
6. Validate provider-required auth fields and provider params.
7. Monitor cardinality rule:
- multiple monitor rows may target the same `workflowId + blockId`
- do not assume a single webhook row per `workflowId + blockId` for indicator monitors
- generic trigger-save/webhookUrlDisplay workflows are not used for indicator monitors
8. Create or update webhook record:
- `webhook.provider = 'indicator'`
- on create: generate `monitorId` in monitor API before DB insert
- on create: set `webhook.id = monitorId` and `webhook.path = 'indicator-monitor-' + monitorId` in the same insert
- on update: keep existing `webhook.path` immutable
- `webhook.blockId = monitor.blockId`
- `webhook.workflowId = monitor.workflowId`
- `webhook.providerConfig = { triggerId: 'indicator_trigger', version: 1, monitor: {...} }`
- `webhook.isActive = monitor.isActive`
9. Notify socket-server runtime for immediate reconcile.
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

## Monitor Logs Drill-In Contract
Monitor UI must drill into workflow runs for the selected monitor.

Rules:
1. Reuse logs list/detail UX patterns from Logs page:
- `LogsList` behavior for middle panel
- `LogDetails` behavior for right panel
2. Extend `/api/logs` optional filters for monitor context:
- `monitorId`
- `listingKey`
- `indicatorId`
- `providerId`
- `interval`
- `triggerSource` (`indicator_trigger`)
3. Logs filtering reads `workflow_execution_logs.executionData.trigger.data.monitor.*`.
4. Trigger metadata must be durable after completion:
- `completeWorkflowExecution(...)` must merge into existing `executionData` and preserve `executionData.trigger` written at start
- do not overwrite `executionData` with trace/final output only
5. Existing `/api/logs/[id]` detail route remains the source for detail panel.
6. Middle panel list query remains workspace-scoped and workflow-scoped, then narrowed by monitor metadata filters.

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
3. Candidate lookup is webhook-backed monitor driven:
- `webhook.workflow_id === dispatch.workflowId`
- workspace must match execute workspace
- `webhook.provider === 'indicator'`
- `webhook.is_active === true`
- `webhook.providerConfig.triggerId === 'indicator_trigger'`
- `webhook.providerConfig.monitor.indicatorId` matches executed indicator id
- `webhook.providerConfig.monitor.listingKey` matches current marketSeries listing key
- `webhook.providerConfig.monitor.interval` matches execute interval when interval is provided
4. Dispatch user attribution uses workflow pinned API key owner via existing queue path.
5. Run existing gates before queue:
- `checkRateLimits(...)`
- `checkUsageLimits(...)`
- `blockExistsInDeployment(...)` only for `executionTarget === 'deployed'`
6. Gate failure is non-fatal: skip target + warning.
7. Queue with `headerOverrides['x-event-id'] = payload.eventId`.
8. Internal gate contract must be non-HTTP:
- internal dispatch paths (manual execute + socket runtime) must not consume `NextResponse` objects directly
- add an adapter/wrapper that returns a plain gate result shape (e.g. `{ allowed: boolean; code?: string; message?: string }`)
- HTTP routes may continue to map gate results to `NextResponse`, but core internal dispatch logic uses the plain result shape

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
- expose degraded status in `/health` for visibility
4. Expose monitor runtime stats in `/health`.

### Discovery and reconcile
1. Reconcile on startup and fixed interval (30s).
2. Source query joins:
- active `webhook` rows where `provider = 'indicator'`
- linked `workflow` rows
- deployed workflow state
3. Trigger immediate reconcile via socket-server internal HTTP notification on:
- indicator monitor create/update/delete
- workflow deploy/undeploy/revert
- webhook activate/deactivate
4. Internal reconcile endpoint contract:
- socket-server exposes `POST /internal/indicator-monitors/reconcile`
- monitor APIs and workflow deploy/undeploy/revert routes call this endpoint after successful state mutation
 - endpoint requires header `X-Internal-Secret: <INTERNAL_API_SECRET>`
 - caller reads secret from app env (`env.INTERNAL_API_SECRET`)
 - socket-server validates against its `INTERNAL_API_SECRET` value
 - unauthorized/missing secret requests return 401 and do not run reconcile
 - endpoint is internal-only and must not be exposed as unauthenticated public control plane
5. Reconcile notification failure semantics:
- calling routes treat reconcile notification as best-effort (do not rollback successful mutation/deploy/revert)
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
- cap to `max(warmupBars, 500)` with hard cap `2000`

### Compute and emission
1. Compute on each accepted stream bar update.
2. Provider event cadence decides recompute frequency:
- if provider emits interim in-bar updates, recompute on each update
- if provider emits closed bars only, recompute once per closed bar
3. Resolve indicator source by monitor config `indicatorId` (default map + custom workspace indicator).
4. Gather `trigger(...)` candidates from PineTS output.
5. Apply monitor filters:
- `eventAllowlist`
- `signalAllowlist`
6. Collapse to one emitted event per monitor + bar bucket.

### Dispatch
1. Build canonical payload with:
- full rolling `marketSeries`
- indicator settings/output
- normalized trigger marker
- monitor metadata (`monitorId`, `workflowId`, `blockId`, `listingKey`, `providerId`, `interval`, `indicatorId`)
2. Deterministic event id:
- `collapseKey = indicator_trigger_live|{monitorId}|{indicatorId}|{barBucketMs}`
- `eventId = SHA-256(collapseKey)`
3. Queue via `queueWebhookExecution` (no direct `executeWebhookJob`).
4. Set `x-event-id` via queue header overrides.
5. Gate failures skip affected dispatch and keep runtime alive.

## Runtime Mapping
1. `event` -> `payload.event`
2. `options.input` -> `payload.input`
3. `options.signal` -> `payload.signal`
4. `options.position` + `options.color` + `event` + `signal` -> `payload.triggerMarker`
5. emitted bar time -> `payload.time` and `payload.triggerMarker.time`
6. computed event id -> `payload.eventId`
7. rolling market series -> `payload.marketSeries`
8. execution settings -> `payload.indicator.settings`
9. normalized output -> `payload.indicator.output`
10. append `triggerMarker` into `payload.indicator.output.markers`
11. include monitor metadata in payload:
- `payload.monitor.id`
- `payload.monitor.workflowId`
- `payload.monitor.blockId`
- `payload.monitor.listingKey`
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

## Workflow Execution Reuse
Reuse existing webhook execution pipeline:
1. prechecks: rate + usage
2. deployment block check only for deployed target
3. queue: `apps/tradinggoose/lib/webhooks/processor.ts` (`queueWebhookExecution`)
4. execute: `apps/tradinggoose/background/webhook-execution.ts`
5. idempotency: `x-event-id` handled in `apps/tradinggoose/lib/idempotency/service.ts`

Webhook input formatting contract for `provider === 'indicator'`:
1. Add explicit formatter branch in `formatWebhookInput(...)` for internal indicator webhooks.
2. Return payload root as-is (passthrough), preserving root fields:
- `event`, `input`, `signal`, `monitor.*`, `marketSeries`, `indicator`, `triggerMarker`, `eventId`, `time`
3. Do not wrap indicator payload under `webhook.data.payload`.
4. Keep existing wrapped behavior for non-indicator providers unchanged.

Manual execute dispatch:
1. entrypoint remains `apps/tradinggoose/app/api/indicators/execute/route.ts`
2. dispatch scope resolved from active indicator monitor webhooks linked to requested workflow
3. queue through `queueWebhookExecution` with header override
4. do not call `executeWebhookJob` directly
5. do not re-enter external webhook route for internal dispatch

Logging metadata contract for monitor filtering:
1. `loggingSession.safeStart({ triggerData })` must include monitor metadata:
- `triggerData.source = 'indicator_trigger'` (stored under `trigger.data.source`)
- `triggerData.monitor.id` (webhook id)
- `triggerData.monitor.workflowId`
- `triggerData.monitor.blockId`
- `triggerData.monitor.listingKey`
- `triggerData.monitor.providerId`
- `triggerData.monitor.interval`
- `triggerData.monitor.indicatorId`
2. Keep existing `isTest` and `executionTarget` fields in trigger data.
3. Source semantics are explicit:
- `createTriggerObject` keeps `trigger.source = trigger.type`
- monitor trigger source selector must use `trigger.data.source` (`indicator_trigger`), not `trigger.source`

## Planned Implementation Steps
Execution gate:
1. Steps `9+` must not start until steps `1-8` are implemented and validated.
2. Studio implementation is blocked until PineTS `trigger(...)` support is implemented and the same build is pinned for root tooling + app runtime.

1. Hard prerequisite: PineTS prerequisite changes in `../PineTS`:
- add runtime/transpiler/type support for `trigger(...)`
2. Hard prerequisite: PineTS dependency rollout alignment in Studio:
- publish and pin same `pinets` build in root + app
- refresh lockfile and verify runtime/editor parity across:
  - app runtime dependency
  - root dependency used by cheat-sheet generator
3. Hard prerequisite: extend queue API for internal dispatch headers:
- `queueWebhookExecution` must support internal header overrides without requiring `NextRequest`-derived headers only
- internal dispatch must set deterministic `x-event-id` through this contract
 - refactor gate checks to an internal plain-result contract used by runtime/execute paths, with HTTP adapters only at route boundaries
4. Hard prerequisite: add indicator formatter passthrough:
- explicit `provider === 'indicator'` branch in `formatWebhookInput(...)`
- return root payload as-is for tag path compatibility
5. Hard prerequisite: logging metadata + logs filter plumbing:
- enrich `triggerData` with `source` and `monitor.*` metadata
- add monitor filters in `/api/logs`, hooks, `/api/v1/logs` filter parser, and logs query parser for parity
6. Hard prerequisite: make monitor trigger metadata durable in persisted logs:
- update execution logger completion path to preserve prior `executionData.trigger` content
- ensure monitor filters work after execution completion, not just at start
7. Hard prerequisite: scope singleton fail-closed behavior to monitor runtime only:
- do not change global `acquireLock(...)` semantics used by existing pollers
- add monitor-runtime-specific lock acquisition behavior that is fail-closed when Redis is unavailable
- Gmail/Outlook polling lock behavior remains unchanged
8. Hard prerequisite: Logs view-mode foundation migration:
- extend logs view mode from `logs|dashboard` to `logs|monitors|dashboard`
- make store URL init/sync parse and persist `view=monitors`
- align all existing view handlers (`logs.tsx` + dashboard components) to 3-state behavior
9. Indicator runtime extraction:
- collect trigger events in local and E2B paths
- keep warning channel for invalid trigger calls
10. Define webhook-backed monitor providerConfig schema and parser/validator.
11. Register `indicator_trigger` trigger config and block:
- keep block output schema tag-compatible
- remove trigger-side market config editing
12. Add monitor APIs (webhook-backed):
- list/create/update/delete/pause/activate monitor records
- validate workflow/block/provider/interval/indicator/listing/auth/provider params
 - monitor API validation depends on `indicator_trigger` block/registry existence from step 11
13. Add Logs `Monitors` tab UI:
- route `/workspace/[workspaceId]/logs` with `view=monitors`
- monitor table with required columns and row actions
- inline edit row with provider/auth/listing/indicator/workflow+interval controls
- 3-dot menu pause/activate toggle tied to `isActive`
14. Implement monitor drill-in panels:
- row click opens run logs panel
- run log click opens log detail panel
- reuse existing logs list/detail interaction patterns
15. Extend logs query contract:
- add optional monitor metadata filters to `/api/logs`
- add equivalent monitor metadata filters to `/api/v1/logs`
- add hook support for monitor logs panel queries
16. Implement monitor-driven dispatch in execute route from active indicator webhooks.
17. Implement deployed monitor runtime in socket-server:
- reconcile indicator monitor webhooks
- subscribe streams
- run backfill + live aggregation + indicator compute
- dispatch through queue/gates
18. Add lifecycle notifications for runtime reconcile:
- deploy/undeploy/revert/activate and monitor webhook CRUD/toggle events
 - call explicit socket-server endpoint `POST /internal/indicator-monitors/reconcile`
 - notification failures are non-blocking (log warning/error; do not fail primary mutation/deploy/revert response)
19. Keep verify route non-dispatching.
20. Update editor typings/docs to include `trigger(...)`.

## Planned File Touchpoints
1. PineTS prerequisite:
- `../PineTS/src/transpiler/settings.ts`
- `../PineTS/src/namespaces/Core.ts`
- `../PineTS/src/types/PineTypes.ts`
2. PineTS consumption alignment:
- `package.json`
- `apps/tradinggoose/package.json`
- `scripts/generate-pine-cheat-sheet.cjs`
- `bun.lock`
3. Monitor APIs (new, webhook-backed):
- `apps/tradinggoose/app/api/indicator-monitors/route.ts`
- `apps/tradinggoose/app/api/indicator-monitors/[id]/route.ts`
4. Logs page + Monitors tab UI:
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/logs.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/dashboard/dashboard.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/dashboard/components/controls.tsx`
- `apps/tradinggoose/app/workspace/[workspaceId]/logs/components/monitors/*`
- `apps/tradinggoose/stores/logs/filters/types.ts`
- `apps/tradinggoose/stores/logs/filters/store.ts`
5. Logs filtering + queries:
- `apps/tradinggoose/app/api/logs/route.ts`
- `apps/tradinggoose/app/api/v1/logs/route.ts`
- `apps/tradinggoose/app/api/v1/logs/filters.ts`
- `apps/tradinggoose/lib/logs/query-parser.ts`
- `apps/tradinggoose/hooks/queries/logs.ts`
 - `apps/tradinggoose/lib/logs/execution/logger.ts`
 - `apps/tradinggoose/lib/logs/execution/logging-factory.ts`
6. Indicator runtime:
- `apps/tradinggoose/lib/indicators/run-pinets.ts`
- `apps/tradinggoose/lib/indicators/execution/e2b-script-builder.ts`
- `apps/tradinggoose/lib/indicators/custom/compile.ts`
- `apps/tradinggoose/lib/indicators/normalize-context.ts`
- `apps/tradinggoose/lib/indicators/types.ts`
7. Trigger/block registration:
- `apps/tradinggoose/triggers/registry.ts`
- `apps/tradinggoose/triggers/index.ts`
- `apps/tradinggoose/blocks/registry.ts`
- `apps/tradinggoose/blocks/blocks/*` (new `indicator_trigger` block)
8. Dispatch and queue:
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
- `apps/tradinggoose/app/api/workflows/[id]/deploy/route.ts`
- `apps/tradinggoose/app/api/workflows/[id]/deployments/[version]/revert/route.ts`
- `apps/tradinggoose/app/api/workflows/[id]/deployments/[version]/activate/route.ts`
- monitor API routes above
11. Editor docs:
- `scripts/generate-pine-cheat-sheet.cjs`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet.ts`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-typings.ts`

## Validation Checklist
1. `trigger(...)` callable in local + E2B runtime (no undefined error).
2. Root/app/editor resolve same `pinets` build.
3. `indicator_trigger` ID consistency across block, registry, webhook linkage.
4. Tag paths resolve from trigger block outputs.
 - no `{ type: 'object' }` leaf nodes for branches that require nested tag paths
5. Monitor save validation:
- rejects invalid workflow/block/provider/interval/indicator/listing/auth
- rejects non-trigger-capable indicator
- enforces provider streaming capability
- writes deterministic internal webhook path (`indicator-monitor-{monitorId}`)
6. Logs Monitors tab behavior:
- table shows required columns and status tags
- row click opens logs panel for that monitor
- run log click opens log detail panel
- URL view mode supports and persists `view=monitors`
- all existing view-mode handlers are aligned to 3-mode behavior (`logs|monitors|dashboard`)
- `indicator_trigger` block is instruction-only in workflow editor and does not mutate webhook rows
- `indicator_trigger` subblocks do not use webhook-coupled component types (`short-input`, `trigger-save`, `webhookUrlDisplay`)
7. Row edit behavior:
- 3-dot menu switches to edit mode
- edit row replaces cells with required selectors/editors
- actions cell switches to check/cross and saves/discards correctly
8. Row activate/pause behavior:
- 3-dot menu shows `Pause` for active monitors and `Activate` for paused monitors
- toggle updates `webhook.isActive`
- paused monitors stop new runtime dispatch until re-activated
9. Internal webhook linkage:
- monitor id equals webhook id
- monitor edits update linked indicator webhook record
10. Runtime reconcile:
- add/update/remove subscriptions on indicator monitor webhook changes
- remove subscriptions on workflow undeploy
- does not run monitor dispatch loop without Redis lock (fail-closed)
11. Emission collapse/idempotency:
- max one emission per monitor + bar bucket
- deterministic `eventId` reused on retry
12. Queue dispatch:
- gate checks run before queue
- `x-event-id` passed via header override
- gate failures return warnings and do not kill runtime
13. Monitor logs filtering:
- logs panel returns only selected monitor runs via monitor metadata filters
- log detail view remains identical to Logs page behavior
 - `/api/logs` and `/api/v1/logs` monitor filters are parity-aligned
 - logs query parser supports monitor filter expressions used by Logs Monitors tab
 - monitor metadata remains queryable after completion updates
14. Indicator webhook formatting:
- indicator payload remains root passthrough after webhook formatting
- expected root tag paths stay intact (`event`, `input`, `monitor.*`, etc.)
15. Runtime singleton behavior:
- monitor runtime is fail-closed when Redis is unavailable (no dispatch loop)
 - existing Gmail/Outlook polling behavior is unchanged by monitor-runtime lock changes
16. Logging metadata enrichment:
- trigger logs include `triggerData.source` + `triggerData.monitor.*` for monitor drill-in filters
 - source selector uses `trigger.data.source` (`indicator_trigger`)

## Test Touchpoints
Note: several tests below are planned new files and do not exist yet in current codebase.
1. `apps/tradinggoose/app/api/indicator-monitors/route.test.ts` (new):
- create/update/delete monitor validation and persistence (webhook-backed)
- pause/activate toggle updates `isActive`
- workflow/block permission and ownership checks
2. `apps/tradinggoose/app/api/indicators/execute/route.test.ts`:
- dispatch target validation
- webhook-backed monitor lookup
- header override + warning behavior
3. `apps/tradinggoose/lib/webhooks/utils.indicator.test.ts` (new):
- `provider === 'indicator'` returns root payload passthrough
- non-indicator providers remain wrapped
4. `apps/tradinggoose/app/api/logs/route.test.ts`:
- monitor metadata filters (`monitorId`, `listingKey`, `indicatorId`, `providerId`, `interval`)
5. `apps/tradinggoose/app/api/v1/logs/filters.test.ts` (new):
- monitor metadata filter parsing parity with `/api/logs`
6. `apps/tradinggoose/lib/logs/query-parser.test.ts` (new):
- monitor filter query parsing parity with API filter contracts
7. `apps/tradinggoose/lib/logs/execution/logger.test.ts` (new):
- completion update preserves existing `executionData.trigger` metadata
8. `apps/tradinggoose/app/workspace/[workspaceId]/logs/logs.test.tsx` (new):
- view toggle supports `Logs` / `Monitors` / `Dashboard`
- `view=monitors` URL initialization and sync
9. `apps/tradinggoose/blocks/blocks/indicator_trigger.test.ts` (new):
- block subblocks are instruction-only
- block excludes `triggerSave` and `webhookUrlDisplay`
- block excludes `short-input`-based webhook wiring
10. `apps/tradinggoose/socket-server/market/indicator-trigger-runtime.test.ts` (new):
- reconcile from indicator webhook records
- startup backfill + live-only updates
- collapse per monitor + bar
- deterministic event id + queue payload
11. `apps/tradinggoose/socket-server/routes/http.test.ts`:
- internal runtime reconcile notification endpoint
12. `apps/tradinggoose/app/api/webhooks/trigger/[path]/route.test.ts`:
- non-regression for external webhook behavior
13. `apps/tradinggoose/executor/handlers/trigger/trigger-handler.test.ts`:
- non-regression on trigger payload pass-through

## Backout Plan
1. Disable monitor runtime dispatch service.
2. Keep indicator webhooks intact but stop reconciling subscriptions.
3. Keep `trigger(...)` collector behavior but disable workflow dispatch.
4. Hide Logs `Monitors` tab view entry.
5. Remove `indicator_trigger` registry/block entries if rollback requires full disable.
