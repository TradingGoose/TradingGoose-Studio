# PineTS + Lightweight Charts + Plugins Migration Plan (Parallel Build)

## Stage plans
- Stage 1: Build `new_data_chart` (LWC + data pipeline) -> `./stage_1.md`
- Stage 2: Build `new_indicators` + `new_editor_indicator` -> `./stage_2.md`
- Stage 3: Drawings/signals + hardening -> `./stage_3.md`

## System standards cross-check
- AGENTS.md: no migration file edits; no legacy support. This plan keeps legacy widgets untouched and avoids dual-run inside a single widget.
- README.md: project is Apache-2.0; PineTS is AGPL-3.0. Confirm legal approval before any public release.
- Timezones: new chart must never fall back to browser-local timezone; use selected timezone or explicit UTC.
- UX change: legacy chart falls back to browser-local timezone (see `apps/tradinggoose/widgets/widgets/data_chart/components/chart-styles.ts`); this new behavior requires explicit sign-off before rollout.
- Cross-verify: new implementations must mirror existing data/UX logic where applicable (legacy files are reference only).

## 1) Goal (changed direction)
Build a parallel LWC + PineTS system without modifying the existing KLineCharts-based widgets or indicator pipeline. New code lives under:
- `apps/tradinggoose/widgets/widgets/new_data_chart`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator`
- `apps/tradinggoose/lib/new_indicators`

Legacy system remains intact while the new system is developed, validated, and optionally rolled out later.

## 2) Constraints / ground rules
- Do not edit any existing files under:
  - `apps/tradinggoose/widgets/widgets/data_chart/**`
  - `apps/tradinggoose/widgets/widgets/editor_indicator/**`
  - `apps/tradinggoose/lib/indicators/**`
- Do not edit any `*/migration/*` or `*/migrations/*` files by hand.
- No dual-run or fallback inside a single widget; new widgets are separate registry entries.
- Reuse `MarketSeries` types from `apps/tradinggoose/providers/market/types/sereis.ts`.
- Internal timestamps remain UTC epoch ms; LWC uses seconds; UI formats use selected timezone or UTC.

## 3) Target stack (new system only)
- PineTS engine (JS API) for indicator logic.
- TradingView Lightweight Charts (LWC) for rendering.
- Indicator-driven drawings + signals (Stage 3), mapped to difurious line-tools-core.

## 4) Architecture summary (parallel)
### Legacy (unchanged)
- `data_chart` widget uses KLineCharts and the existing indicator pipeline.
- `editor_indicator` widget edits legacy indicators stored in legacy tables.

### New system (parallel)
- `new_data_chart` widget uses LWC and PineTS output rendering.
- `new_editor_indicator_new` widget edits PineTS JS indicators stored separately.
- `new_indicators` library contains PineTS runtime + normalization + storage operations.
- New API routes handle create/update/delete + verify for PineTS indicators.

## 5) Decisions (locked)
- LWC version: v5.1.x via the published npm package (`lightweight-charts@^5.1.x`). Local `../lightweight-charts` is reference-only.
- PineTS runtime: `pinets@^0.8.x` via npm (local `../PineTS` is reference-only).
- PineTS JS syntax for user indicators (no Pine Script strings in v1).
- Indicator-driven drawings and signals are in scope, but only in the new system.
- `request.security` on array sources does not resample to higher/lower timeframes; treat multi-timeframe as unsupported in v1.

## 6) Data + time contract (new system)
- MarketSeries `timeStamp` parses to epoch ms (UTC).
- PineTS operates on ms fields: `openTime`, `closeTime`.
- LWC uses seconds for candle series and markers.
- UI formatting uses selected timezone or explicit UTC; never browser-local fallback.

## 7) PineTS runtime behavior (verified reference)
- `ctx.plots` keyed by plot title; each entry is `{ title, options, data: [...] }`.
- Each `data` point is `{ time: openTimeMs, value, options? }`.
- `plotshape` -> options style `shape` + `shape` property.
- `plotarrow` -> options style `shape`, per-point `shape` arrow up/down with colorup/colordown.
- `plotchar` -> style `char` (PineTS 0.8.4 does not emit per-point char/text; treat as marker with fallback text).
- `plotbar` / `plotcandle` -> style `bar` / `candle`, values are `[open, high, low, close]`.
- `bgcolor`, `barcolor`, `fill` -> styles `background`, `barcolor`, `fill` (deferred in v1).
- `pine.input.*` resolves by `context.inputs[title]` (no metadata stored by default).

## 8) Dependency posture
- Keep `klinecharts` for legacy widgets.
- Add npm `lightweight-charts@^5.1.x` and `pinets@^0.8.x` for the new system (local `../lightweight-charts` and `../PineTS` are reference-only).
- Line-tools source: `difurious line-tools-core` (npm), vendored into `apps/tradinggoose/widgets/widgets/new_data_chart/plugins/line-tools/**`.

## 9) Stage scope mapping
### Stage 1 (new_data_chart)
- New remapping utilities (ms -> sec) under `new_data_chart`.
- New LWC chart hook, data loader, live updates, scroll-back, rescale.
- New widget registration in `apps/tradinggoose/widgets/registry.tsx`.

### Stage 2 (new_indicators + new_editor_indicator)
- New PineTS runtime and normalization utilities.
- New DB table + new API routes for PineTS indicators.
- New editor widget for PineTS JS.
- Optional indicator sync integration into `new_data_chart`.

### Stage 3 (drawings + signals)
- Draw/signal APIs in new_indicators.
- Mapping to difurious line-tools-core in new_data_chart.
- Hardening + telemetry + large-data checks.

## 10) Phase 0 — Decisions & compatibility (new system)
1) Lock LWC version
- Align to **v5.1.x** using the npm package (local `../lightweight-charts` is reference-only). OpenAlgo-Chart is reference-only for LWC usage patterns (`addPane`, `createSeriesMarkers`) and is **not** a line-tools source.

2) Licensing & runtime
- PineTS is AGPL-3.0; confirm legal approval before release.
- Use PineTS JS syntax for user-authored indicators.

3) Drawings & tools
- Indicator-driven drawings are in scope (Stage 3).
- Manual drawing tools UI remains post-v1.

4) PineTS runtime shape (verified)
- PineTS JS context is `(context) => { const { data, pine } = context }`.
- Use `context.pine` namespace (avoid deprecated `context.core`).
- Plot APIs resolve to `pine.plot.any`, `pine.plotshape`, `pine.plotchar`, `pine.plotarrow`, `pine.plotbar`, `pine.plotcandle`, `pine.bgcolor`, `pine.barcolor`, `pine.hline.any`, `pine.fill.any`.

5) Dependencies
- Add `lightweight-charts@^5.1.x` (npm) and `pinets@^0.8.x` (npm). Do not link or import from local `../lightweight-charts` or `../PineTS`.
- Keep `klinecharts` only for legacy widgets.

## 11) Phase 1 — Data shape and conversion layer (new system)
0) Time-unit contract
- Source: `MarketSeries.timeStamp` -> epoch ms (UTC).
- PineTS: epoch ms only.
- LWC: seconds only.

1) New remapping utilities (parallel)
- File: `apps/tradinggoose/widgets/widgets/new_data_chart/remapping.ts`.
- Build one canonical `barsMs` list used by PineTS and derive `candlesSec` for LWC.
- Preserve legacy fallback rules (open/high/low default to close) to avoid NaNs.
- `openTimeMs = Date.parse(bar.timeStamp)`.
- `closeTimeMs = next bar openTime` or `openTimeMs + intervalMs` if known.
- Keep `barsMs` sorted by `openTimeMs`.
- Maintain `indexByOpenTimeMs` + `openTimeMsByIndex` to support plot offsets.
- Dedupe by `openTimeMs` (replace existing bar on live updates).

2) Timezone handling
- Internal timestamps are UTC epoch only.
- UI formatting uses selected timezone or explicit UTC; no local fallback.
- Implement `localization.timeFormatter` and `timeScale.tickMarkFormatter`.
- Use `apps/tradinggoose/lib/time-format.ts` and `components/timezone-selector/fetchers.ts` for offset normalization.

## 12) Phase 2 — Chart instance + lifecycle (new system)
1) Create LWC chart hook
- File: `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-chart-instance.ts`.
- Use `createChart(container)` and add a main series via a series factory.
- Keep refs: `chartRef`, `mainSeriesRef`, `containerRef`.
- Resize via `ResizeObserver` + `chart.resize()`.

2) Style and appearance mapping
- File: `apps/tradinggoose/widgets/widgets/new_data_chart/components/chart-styles.ts`.
- Map view settings to LWC options (layout, grid, crosshair, price scale).
- Map `pricePrecision` / `volumePrecision` to `priceFormat` options.
- Map `priceAxisType` -> LWC `PriceScaleMode`.
- Translate `stylesOverride` into `chart.applyOptions`; warn on unsupported keys.
- Candle type mapping:
  - `candle_solid` -> `CandlestickSeries`.
  - `ohlc` -> `BarSeries`.
  - `area` -> `AreaSeries` (use close as value).

3) Symbol + interval display
- Keep existing `ListingOverlay` UI for symbol/interval display.
- Add a custom crosshair legend via `chart.subscribeCrosshairMove`.
- Use selected timezone formatter; handle `UTCTimestamp` vs `BusinessDay`.

## 13) Phase 3 — Data loading + live updates (new system)
1) Direct series updates
- Initial load: `mainSeries.setData(candlesSec)` (seconds).
- Live updates: `mainSeries.update(candleSec)` (seconds).
- Canonical data: update `barsMs` first, then derive `candlesSec`.
- Replace all KLineData usage with new remappers.

2) Historical backfill (scroll-left)
- Use `timeScale().subscribeVisibleLogicalRangeChange`.
- Define `PREFETCH_THRESHOLD` (50–100 bars).
- Fetch older data when `logicalRange.from <= threshold`.
- Use `mergeBarsMs` for both live + backfill.
- After backfill, recompute `candlesSec` and call `setData` once.
- Preserve view by shifting visible range by `prependCount`.

3) Rescale behavior
- Use `timeScale().fitContent()`.
- Use `setVisibleRange()` after backfill if needed to avoid jumps.

## 14) Phase 4 — PineTS indicators (new system)
1) Unified PineTS pipeline
- New pipeline lives under `apps/tradinggoose/lib/new_indicators`.
- Custom indicator code is PineTS JS function body evaluated in a sandbox.
- Pre-step: `normalizeIndicatorCode(code)` wraps non-function bodies.

2) Inputs
- Use `pine.input.*` inside PineTS JS to define parameters.
- Persist input values and feed as `inputsMap = { [title]: value }`.
- Capture metadata (title, defval, minval, maxval, step, options, type).

3) PineTS -> LWC mapping (`normalizeContext`)
- `ctx.plots` -> series + markers + unsupported lists.
- Plot styles mapping:
  - `style_histogram` / `style_columns` -> `HistogramSeries`
  - `style_area` / `style_areabr` -> `AreaSeries`
  - `style_line` / `style_linebr` -> `LineSeries`
  - `style_stepline*` -> `LineSeries` with steps
  - `style_circles` -> `LineSeries` + point markers
  - `style_cross` -> fallback to circles + warning
  - default -> `LineSeries`
- `plotbar` -> `BarSeries` (optional v1)
- `plotcandle` -> `CandlestickSeries` (optional v1)
- `bgcolor` / `barcolor` / `fill` -> deferred (warn)
- Overlay rule: `plot.options.overlay ?? plot.options.force_overlay ?? ctx.indicator?.overlay`.
- Marker extraction from `shape` / `char` plots:
  - Apply `offset` using `openTimeMsByIndex`.
  - Map shapes: `arrowup`, `arrowdown`, `circle`, `square`.
  - Map locations: `abovebar`, `belowbar`, `absolute`.

4) Indicator sync in new_data_chart
- Add a new indicator sync hook in `new_data_chart`.
- Create/update series per plot title.
- Aggregate markers and call `createSeriesMarkers` once.

## 15) Phase 5 — Editor + verification (new system)
1) New editor widget
- `apps/tradinggoose/widgets/widgets/new_editor_indicator_new`.
- PineTS JS prompt and Monaco typings.

2) New verify endpoint
- `apps/tradinggoose/app/api/new_indicators/verify/route.ts`.
- Execute PineTS against mock bars and return counts + unsupported lists.

3) New data model
- New DB table for PineTS indicators (parallel to legacy table).
- Use migration tooling to generate migration; do not edit migrations by hand.

## 16) Phase 6 — Drawings + signals (new system)
1) Draw API
- Add `draw` recorder to PineTS context (Stage 3).
- Map `DrawInstruction` to difurious line-tools-core.

2) Signal API
- Add `signal.emit`, `signal.buy`, `signal.sell`, `signal.value`.
- Apply `edge` and `cooldownBars` after execution.
- Optionally render markers (opt-in per indicator).

## 17) PineTS Context adapter (TypeScript-ish)
```ts
type PinePlotPoint = {
  time: number // epoch ms
  value: number | null | [number, number, number, number] | boolean
  options?: {
    color?: string
    offset?: number
    shape?: string
    location?: string
    size?: string
    text?: string
    textcolor?: string
    height?: number
    wickcolor?: string
    bordercolor?: string
  }
}

type PinePlot = {
  title: string
  options?: {
    style?: string
    color?: string
    linewidth?: number
    force_overlay?: boolean
    overlay?: boolean
    offset?: number
    shape?: string
    location?: string
    size?: string
  }
  data: PinePlotPoint[]
}

type DrawPointXY = { axis: 'xy'; xType: 'bar_index' | 'time'; x: number; y: number }
type DrawPointX = { axis: 'x'; xType: 'bar_index' | 'time'; x: number }
type DrawPointY = { axis: 'y'; y: number }
type DrawPoint = DrawPointXY | DrawPointX | DrawPointY

type DrawInstruction = {
  id?: string
  tool:
    | 'TrendLine'
    | 'Ray'
    | 'ExtendedLine'
    | 'HorizontalLine'
    | 'HorizontalRay'
    | 'VerticalLine'
    | 'Rectangle'
    | 'Text'
    | 'Circle'
    | 'Path'
  pane?: 'price' | 'indicator'
  points: DrawPoint[]
  options?: Record<string, unknown>
  visible?: boolean
  locked?: boolean
}

type SignalEvent = {
  id?: string
  type: 'buy' | 'sell' | 'value'
  active?: boolean
  barIndex?: number
  timeMs?: number
  price?: number
  text?: string
  color?: string
  shape?: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  position?: 'aboveBar' | 'belowBar' | 'inBar' | 'atPriceTop' | 'atPriceBottom' | 'atPriceMiddle'
  size?: number
  edge?: boolean | 'rising' | 'falling' | 'both'
  cooldownBars?: number
}

type PineContext = {
  plots: Record<string, PinePlot>
  indicator?: { overlay?: boolean }
  draw?: DrawInstruction[]
  signal?: SignalEvent[]
}

type NormalizedPineOutput = {
  series: Array<{ plot: PinePlot; points: Array<{ time: number; value: number | null; color?: string }> }>
  markers: Array<{ time: number; position: 'aboveBar' | 'belowBar' | 'inBar' | 'atPriceTop' | 'atPriceBottom' | 'atPriceMiddle'; shape: string; color?: string; text?: string; price?: number }>
  drawings: DrawInstruction[]
  signals: SignalEvent[] // preserved for alert/automation hooks
  unsupported: { plots: string[]; styles: string[] }
}
```

## 18) Draw API interface (new system)
```ts
type DrawPointXY = { axis: 'xy'; xType: 'bar_index' | 'time'; x: number; y: number }
type DrawPointX = { axis: 'x'; xType: 'bar_index' | 'time'; x: number }
type DrawPointY = { axis: 'y'; y: number }
type DrawPoint = DrawPointXY | DrawPointX | DrawPointY

type DrawInstruction = {
  id?: string
  tool:
    | 'TrendLine'
    | 'Ray'
    | 'ExtendedLine'
    | 'HorizontalLine'
    | 'HorizontalRay'
    | 'VerticalLine'
    | 'Rectangle'
    | 'Text'
    | 'Circle'
    | 'Path'
  pane?: 'price' | 'indicator'
  points: DrawPoint[]
  options?: Record<string, unknown>
  visible?: boolean
  locked?: boolean
}

draw.tool(type: ToolType, args: { id?: string; points: DrawPoint[]; pane?: 'price' | 'indicator'; options?: Record<string, unknown>; visible?: boolean; locked?: boolean })
// pane: 'price' | 'indicator' (symbolic target, not a pane id)

// Standard lines
 draw.trendLine({ id, points: [p1, p2], options })       // XY + XY
 draw.ray({ id, points: [p1, p2], options })             // XY + XY
 draw.extendedLine({ id, points: [p1, p2], options })    // XY + XY
 draw.horizontalLine({ id, points: [{ axis: 'y', y: price }], options })
 draw.horizontalRay({ id, points: [p1], options })       // XY anchor
 draw.verticalLine({ id, points: [{ axis: 'x', xType: 'time'|'bar_index', x }], options })

// Shapes
 draw.rectangle({ id, points: [p1, p2], options })       // XY + XY
 draw.circle({ id, points: [p1, p2], options })          // XY + XY
 draw.path({ id, points: pathPoints, options })          // XY list

// Text
 draw.text({ id, points: [p1], text, options })          // XY anchor + options.text
```

## 19) Signal API interface (new system)
```ts
type SignalEvent = {
  id?: string
  type: 'buy' | 'sell' | 'value'
  active?: boolean
  barIndex?: number
  timeMs?: number
  price?: number
  text?: string
  color?: string
  shape?: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  position?: 'aboveBar' | 'belowBar' | 'inBar' | 'atPriceTop' | 'atPriceBottom' | 'atPriceMiddle'
  size?: number
  edge?: boolean | 'rising' | 'falling' | 'both'
  cooldownBars?: number
}

signal.emit({ id?, type, active?, barIndex?, timeMs?, price?, text?, color?, shape?, position?, size?, edge?, cooldownBars? })
signal.buy({ ...opts })   // defaults to arrowUp + belowBar
signal.sell({ ...opts })  // defaults to arrowDown + aboveBar
signal.value({ ...opts }) // defaults to circle + inBar
```

## 20) Detailed file impact map (new system)
### New chart widget
- `apps/tradinggoose/widgets/widgets/new_data_chart/index.tsx`
- `apps/tradinggoose/widgets/widgets/new_data_chart/types.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/remapping.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/chart-styles.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-chart-instance.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-chart-styles.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-chart-data-loader.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-live-bars.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-chart-rescale.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/body.tsx`

### New indicator system
- `apps/tradinggoose/lib/new_indicators/types.ts`
- `apps/tradinggoose/lib/new_indicators/normalize-indicator-code.ts`
- `apps/tradinggoose/lib/new_indicators/run-pinets.ts`
- `apps/tradinggoose/lib/new_indicators/normalize-context.ts`
- `apps/tradinggoose/lib/new_indicators/custom/compile.ts`
- `apps/tradinggoose/lib/new_indicators/custom/operations.ts`
- `apps/tradinggoose/lib/new_indicators/default/index.ts`

### New editor widget
- `apps/tradinggoose/widgets/widgets/new_editor_indicator_new/index.tsx`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator_new/editor-indicator-body.tsx`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator_new/components/indicator-code-panel.tsx`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator_new/components/indicator-editor-header.tsx`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator_new/editor-indicator-types.ts`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator_new/editor-indicator-helpers.ts`

### New store + queries
- `apps/tradinggoose/stores/new-indicators/types.ts`
- `apps/tradinggoose/stores/new-indicators/store.ts`
- `apps/tradinggoose/hooks/queries/new-indicators.ts`

### New API routes
- `apps/tradinggoose/app/api/new_indicators/custom/route.ts`
- `apps/tradinggoose/app/api/new_indicators/verify/route.ts`
- `apps/tradinggoose/app/api/new_indicators/execute/route.ts`

### Widget registry
- `apps/tradinggoose/widgets/registry.tsx` (add new widget definitions)

## 21) Implementation details to decide early
- New indicator storage: new table vs alternate storage (recommended: new table).
- Whether to create a new list widget for PineTS indicators.
- Whether to reuse existing UI components or duplicate minimal UI into new widgets.
- Whether signal markers are opt-in per indicator (recommended: opt-in).

## 22) Testing plan
- Unit tests:
  - remapping (MarketSeries -> barsMs -> candlesSec)
  - normalizeContext plot/marker mapping
  - PineTS execution with a minimal indicator
- Integration tests:
  - new_data_chart: load, scroll-back, live updates
  - new_editor_indicator_new: create/verify/save

## 23) Rollout (parallel)
- Keep legacy widgets as default.
- Expose new widgets as opt-in for internal users.
- Track telemetry for PineTS execution time, marker count, draw/signal counts.

## 24) Cross-verified references (read-only)
- Registry/events/utilities: `apps/tradinggoose/widgets/registry.tsx`, `apps/tradinggoose/widgets/events.ts`, `apps/tradinggoose/widgets/utils/chart-params.ts`, `apps/tradinggoose/widgets/utils/indicator-selection.ts`, `apps/tradinggoose/widgets/utils/indicator-editor-actions.ts`
- Legacy chart logic (reference only): `apps/tradinggoose/widgets/widgets/data_chart/**`
- Legacy indicator system (reference only): `apps/tradinggoose/lib/indicators/**`, `apps/tradinggoose/widgets/widgets/editor_indicator/**`
- Legacy APIs/stores (reference only):
  - `apps/tradinggoose/app/api/indicators/custom/route.ts`
  - `apps/tradinggoose/app/api/indicators/verify/route.ts`
  - `apps/tradinggoose/stores/custom-indicators/types.ts`
  - `apps/tradinggoose/hooks/queries/custom-indicators.ts`

## 25) External local references
- `../openalgo-chart` (reference-only; LWC usage patterns, not line-tools source)
- `../openalgo-pinets` (reference-only)
- `../PineTS` (reference-only; do not import in app code)
- `../lightweight-charts`
