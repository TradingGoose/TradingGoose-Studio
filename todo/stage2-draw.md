# Stage 2: Custom `draw.*` API for Indicator-Owned Drawings

## Goal
Add a TradingGoose-owned `draw.*` API for user indicators so they can render line-tools under `apps/tradinggoose/widgets/widgets/data_chart/plugins/*`, while keeping PineTS native `plot.*` focused on series and markers.

## Why this design (locked)
1. `plot.*` and `draw.*` solve different UX problems:
- `plot.*` is data-series and marker output.
- `draw.*` is geometric/chart-object output.
2. PineTS future support for `line.new/label.new/box.new` is no longer a blocker.
3. Indicator drawings become deterministic and aligned with our vendored line-tools plugin contracts.

## Separation Contract (locked)
1. PineTS native path remains unchanged for:
- `plot`, `plotshape`, `plotchar`, `plotarrow`, `hline`, `fill`, `bgcolor`, `barcolor`
- Output targets: `NormalizedPineOutput.series` and `NormalizedPineOutput.markers` only.
2. Custom TradingGoose path:
- `draw.*` is runtime-provided by our indicator executor.
- Output target: `NormalizedPineOutput.drawings` only.
3. No translation layer from PineTS drawing-like APIs:
- Do not normalize `line.new`, `label.new`, `box.new`, `polyline.new`, `chart.point`, `vline`.
- Stage 2 relies only on `draw.*`.
4. No generic draw entry:
- Do not expose `draw.tool(...)`.
- Public indicator API must use explicit `draw.{tool}` methods only.

## Scope
1. Add draw recorder/runtime API in `apps/tradinggoose/lib/indicators`.
2. Normalize draw instructions server-side to plugin-ready points.
3. Render indicator-owned drawings via line-tools plugin instances.
4. Keep manual drawing ownership (`view.drawTools[]`) fully isolated.

## Non-goals
1. No Stage 3 `signal.*` work.
2. No manual draw UX redesign.
3. No legacy support.
4. No `server-only` package usage.
5. No migration file edits.

## Reviewed Surfaces
1. Indicator runtime/normalization:
- `apps/tradinggoose/lib/indicators/custom/compile.ts`
- `apps/tradinggoose/lib/indicators/run-pinets.ts`
- `apps/tradinggoose/lib/indicators/normalize-context.ts`
- `apps/tradinggoose/lib/indicators/types.ts`
- `apps/tradinggoose/app/api/indicators/execute/route.ts`
- `apps/tradinggoose/app/api/indicators/verify/route.ts`
2. Chart rendering/ownership:
- `apps/tradinggoose/widgets/widgets/data_chart/hooks/use-indicator-sync.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/chart-body.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/drawings/*`
- `apps/tradinggoose/widgets/widgets/data_chart/plugins/*`
3. Editor typings/docs:
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-indicator-code-panel.tsx`
- `scripts/generate-pine-cheat-sheet.cjs`

## API Design (locked)
### Core model
1. All draw calls are idempotent upserts keyed by `id`.
2. `id` is required and must be stable across runs.
3. Per-run dedupe rule: last write wins for same `id`.
4. Missing `id` in current run means that drawing is removed on the client diff pass.

### Coordinates
```ts
export type DrawX = { xType: 'bar_index' | 'time'; x: number }
export type DrawPointXY = DrawX & { y: number }
```

### Draw envelope
```ts
export type DrawBase = {
  id: string
  pane?: 'price' | 'indicator'
  visible?: boolean
  locked?: boolean
  options?: Record<string, unknown>
}
```

### Tool-specific calls (only supported entrypoints)
```ts
draw.trendLine({ id, from, to, pane?, visible?, locked?, options? })
draw.ray({ id, from, to, pane?, visible?, locked?, options? })
draw.extendedLine({ id, from, to, pane?, visible?, locked?, options? })
draw.horizontalLine({ id, price, at?, pane?, visible?, locked?, options? })
draw.horizontalRay({ id, from, pane?, visible?, locked?, options? })
draw.verticalLine({ id, at, price?, pane?, visible?, locked?, options? })
draw.rectangle({ id, from, to, pane?, visible?, locked?, options? })
draw.circle({ id, from, to, pane?, visible?, locked?, options? })
draw.path({ id, points, pane?, visible?, locked?, options? })
draw.text({ id, at, text, pane?, visible?, locked?, options? })
```

### Aliases
```ts
draw.hLine -> draw.horizontalLine
draw.hRay -> draw.horizontalRay
draw.vLine -> draw.verticalLine
draw.rect -> draw.rectangle
```
No generic entrypoint is supported. Indicators must call concrete methods (`draw.trendLine`, `draw.hLine`, etc.).

## Normalized Drawing Contract
```ts
export type NormalizedDrawTool =
  | 'TrendLine'
  | 'Ray'
  | 'ExtendedLine'
  | 'HorizontalLine'
  | 'HorizontalRay'
  | 'VerticalLine'
  | 'Rectangle'
  | 'Circle'
  | 'Path'
  | 'Text'

export type NormalizedDrawInstruction = {
  id: string
  tool: NormalizedDrawTool
  points: Array<{ timestamp: number; price: number }> // timestamp in seconds
  pane: 'price' | 'indicator'
  visible: boolean
  locked: boolean
  options?: Record<string, unknown>
}
```

### Normalization rules (locked)
1. `bar_index` uses execution bars only (`executionBars[barIndex].openTime`), never full chart history.
2. `time` is input milliseconds and is converted to seconds at normalization output.
3. Invalid coordinate resolution drops the drawing and emits a warning.
4. Pane default is `'indicator'` for all `draw.*` calls unless explicitly overridden.
5. `verticalLine.price` fallback:
- use close at resolved time if available;
- else use last execution bar close.
6. `horizontalLine.at` fallback:
- use last execution bar time.
7. `text` maps `text` into nested option payload (`options.text.value`) expected by line-tools.

## Ownership and Routing (locked)
1. Indicator-owned namespace:
- `ownerId = indicator:${indicatorId}`
2. Manual namespace remains unchanged:
- `ownerId = manual:${drawToolsId}`
3. Domain isolation:
- Indicator flow never mutates `view.drawTools[]`.
- Manual flow never mutates indicator drawing state.
4. Routing:
- `pane === 'price'` -> attach to main series.
- `pane === 'indicator'` -> attach to `IndicatorRuntimeEntry.paneAnchorSeries`.
5. Plugin lifecycle:
- Keep one plugin instance per `seriesAttachmentKey` across both domains.
- Reuse Stage 1 attachment keys and refcount model.

## Runtime and Execution Design
1. Add draw recorder:
- `createDrawRecorder(): { api, clear, getInstructions }`
2. Expose `draw` as a global without adding user-code preamble lines.
3. Keep error line mapping stable (`parseExecutionError` offset remains unchanged).
4. Node and E2B parity:
- both runtimes must expose `draw` and capture draw output.
- E2B context payload must include drawings, not only `plots` and `indicator`.

## Rendering Design in `data_chart`
1. Create indicator drawing reconciliation pass after series/marker updates.
2. Use `createOrUpdateLineTool(...)` for deterministic id-based updates.
3. Remove stale tool ids not present in current run output.
4. Apply `visible` and `locked` through line-tool options/update path.
5. Build runtime signature to include drawings hash so re-render is triggered when only drawings change.

## File Changes (planned)
1. Indicator library:
- `apps/tradinggoose/lib/indicators/draw.ts` (new)
- `apps/tradinggoose/lib/indicators/normalize-drawings.ts` (new)
- `apps/tradinggoose/lib/indicators/types.ts`
- `apps/tradinggoose/lib/indicators/normalize-context.ts`
- `apps/tradinggoose/lib/indicators/run-pinets.ts`
- `apps/tradinggoose/lib/indicators/custom/compile.ts`
2. API routes:
- `apps/tradinggoose/app/api/indicators/execute/route.ts`
- `apps/tradinggoose/app/api/indicators/verify/route.ts`
3. Chart client:
- `apps/tradinggoose/widgets/widgets/data_chart/hooks/use-indicator-sync.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/drawings/*` (shared plugin owner flow extensions)
- `apps/tradinggoose/widgets/widgets/data_chart/components/chart-body.tsx` (wiring only)
4. Editor docs/typings:
- `apps/tradinggoose/widgets/widgets/editor_indicator/components/pine-indicator-code-panel.tsx`
- `scripts/generate-pine-cheat-sheet.cjs`

## Sequence and Rollout
1. Define types + recorder + normalization in `lib/indicators`.
2. Wire runtime exposure for local + E2B execution.
3. Return typed `drawings` from compile and execute APIs.
4. Add indicator-owned draw reconciliation in client with shared plugin ownership.
5. Update editor guidance and cheat-sheet typings.
6. Add tests and verify route behavior for draw-only indicators.

## Validation Matrix
1. API behavior:
- stable id upsert
- last-write-wins dedupe
- alias methods parity (`hLine`, `vLine`, `rect`)
- no `draw.tool(...)` exposure
2. Coordinate normalization:
- `bar_index` and `time` resolution
- fallback rules for horizontal/vertical lines
- invalid point drop + warnings
3. Routing:
- price pane attach
- indicator pane attach via `paneAnchorSeries`
- pane migration when indicator runtime anchor changes
4. Isolation:
- manual drawings unchanged
- indicator drawings unaffected by manual sidebar actions
5. Runtime parity:
- local VM path and E2B path produce same drawing output
6. Verify endpoint:
- draw-only script passes verification when plots/markers are zero and drawings are non-zero

## Risks and Mitigations
1. Risk: drawing churn/flicker from unstable ids.
- Mitigation: require `id`, document stable-id rule, enforce dedupe.
2. Risk: plugin ownership conflicts across manual/indicator domains.
- Mitigation: shared `seriesAttachmentKey` registry and strict domain prefixes.
3. Risk: E2B/local behavior mismatch.
- Mitigation: identical recorder contract + parity tests.
4. Risk: expensive redraw loops.
- Mitigation: id-based diff and create-or-update path instead of remove-all rebuild.

## Backout Plan
1. Disable indicator drawing reconciliation while keeping manual adapter untouched.
2. Return `drawings: []` from normalization.
3. Remove `draw` global exposure from compile/runtime paths.
4. Keep `plot.*` pipeline unchanged (series/markers continue to work).
