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

## ProviderConfig Contract
```ts
type IndicatorWebhookProviderConfig = {
  triggerId: 'indicator_trigger'
  indicatorId: string
  eventAllowlist?: string[]
  signalAllowlist?: Array<'long' | 'short' | 'flat'>
}
```

Dispatch filter rules:
1. `payload.indicator.id === providerConfig.indicatorId`
2. if `eventAllowlist` exists, `payload.event` must be included
3. if `signalAllowlist` exists, `payload.signal` must be included

## Runtime Mapping
1. `event` arg -> `payload.event`
2. `options.input` -> `payload.input`
3. `options.signal` -> `payload.signal`
4. `options.position` + `options.color` + `event` -> `payload.triggerMarker`
5. resolved bar time -> `payload.time` and `payload.triggerMarker.time`
6. generated event id -> `payload.eventId`
7. execution `MarketSeries` -> `payload.marketSeries`
8. execution settings -> `payload.indicator.settings`
9. normalized output -> `payload.indicator.output`
10. append `payload.triggerMarker` to `payload.indicator.output.markers`

## Error Model
1. Trigger option validation errors:
- dropped trigger event
- warning recorded
- no throw
2. Non-trigger script/runtime errors:
- unchanged current behavior: indicator compile returns `output: null` with `executionError`.
3. Implementation requirement:
- implement `Core.trigger(...)` in PineTS as non-throwing for invalid trigger options.

## Workflow Execution Reuse
Reuse existing webhook execution pipeline:
- route: `apps/tradinggoose/app/api/webhooks/trigger/[path]/route.ts`
- queue: `apps/tradinggoose/lib/webhooks/processor.ts`
- execute: `apps/tradinggoose/background/webhook-execution.ts`
- idempotency: `x-event-id` -> `apps/tradinggoose/lib/idempotency/service.ts`

## Planned Implementation Steps
1. PineTS prerequisite changes (`../PineTS`):
- add `trigger` to transpiler/runtime-known vars
- add `Core.trigger(...)` implementation
- add trigger typing in PineTS types
2. Indicator runtime extraction changes:
- include trigger events from PineTS context in local and E2B paths
- include warnings channel for invalid trigger calls
3. Build payload + marker normalization:
- map trigger events to canonical payload
- append normalized marker to indicator output markers
4. Register `indicator_trigger` trigger config and add `indicator_trigger` block.
5. Define block outputs (tag-compatible nested schema) and keep consistent with trigger outputs.
6. Add `formatWebhookInput` provider branch for `indicator`.
7. Add indicator dispatcher to active webhooks with provider `indicator`.
8. Keep execute/verify routes non-dispatching unless explicit dispatch path invoked.
9. Add editor support:
- `trigger(...)` typing and docs in generated cheat-sheet artifacts.

## Planned File Touchpoints
1. PineTS (prerequisite, outside app workspace):
- `../PineTS/src/transpiler/settings.ts`
- `../PineTS/src/namespaces/Core.ts`
- `../PineTS/src/types/PineTypes.ts`
2. Indicator runtime:
- `apps/tradinggoose/lib/indicators/run-pinets.ts`
- `apps/tradinggoose/lib/indicators/execution/e2b-script-builder.ts`
- `apps/tradinggoose/lib/indicators/custom/compile.ts`
- `apps/tradinggoose/lib/indicators/normalize-context.ts`
- `apps/tradinggoose/lib/indicators/types.ts`
3. Trigger registration and block:
- `apps/tradinggoose/triggers/registry.ts`
- `apps/tradinggoose/triggers/index.ts`
- `apps/tradinggoose/blocks/registry.ts`
- `apps/tradinggoose/blocks/blocks/*` (new `indicator_trigger` block)
4. Webhook path:
- `apps/tradinggoose/lib/webhooks/utils.ts`
- `apps/tradinggoose/lib/webhooks/processor.ts`
- `apps/tradinggoose/background/webhook-execution.ts`
- `apps/tradinggoose/app/api/webhooks/trigger/[path]/route.ts`
5. Editor/docs:
- `scripts/generate-pine-cheat-sheet.cjs`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet.ts`
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-cheat-sheet-typings.ts`

## Validation Checklist
1. PineTS/runtime:
- `trigger(...)` callable in local VM and E2B
- no `trigger is not defined` runtime failure
2. API contract:
- `event`, `condition`, `input`, `signal` required
- invalid trigger options emit warnings and do not fail whole script
3. ID consistency:
- block type, trigger id, and providerConfig.triggerId all use `indicator_trigger`
4. Tag compatibility:
- expected nested tag paths resolve from trigger block outputs
5. Dispatch:
- provider `indicator` dispatches to webhook route with `x-event-id`
- idempotency works via existing webhook service
6. End-to-end:
- indicator trigger emits marker and workflow trigger payload
- workflow can branch on `<triggerBlock.signal>`

## Backout Plan
1. Disable indicator dispatch path.
2. Keep `trigger(...)` as no-op collector in runtime if needed.
3. Remove `indicator_trigger` from trigger registry/block registry until re-enabled.
