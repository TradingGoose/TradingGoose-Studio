# Stage 3: Drawings + signals + hardening (v1 candidate)

## Goal
Add PineTS draw/signal APIs to the **new** LWC/PineTS system, map draw instructions to line-tools, add signal markers + alert hooks, and harden performance/telemetry. Legacy widgets remain untouched.

## Scope
- Draw + signal APIs in `apps/tradinggoose/lib/new_indicators`.
- Normalize draw instructions + signals alongside PineTS plots.
- Map draw instructions to line-tools in `apps/tradinggoose/widgets/widgets/new_data_chart`.
- Signal filtering (edge/cooldown) and optional marker rendering via LWC markers.
- Performance guardrails + telemetry around PineTS execution + rendering.

## Non-goals
- Removing or modifying legacy KLineCharts widgets or indicator pipeline.
- Manual drawing UI (toolbars, persistence, import/export) beyond what is already planned.
- Any edits to `*/migration/*` or `*/migrations/*` files.

## System standards alignment (must stay true)
- **AGENTS.md**: no migration edits; no legacy support; minimal, readable changes.
- **overview.md**: new widgets are parallel; no dual-run inside legacy; timezone rules unchanged.
- **Stage 1/2**: client dataContext keeps `barsMs` + `openTimeMsByIndex` for UI needs (anchor series, visible range). Server execution recomputes index maps from the execution bars; PineTS runs on ms; LWC uses seconds.

## Dependencies / sequencing
- Stage 1 (`new_data_chart`) provides `barsMs`, `openTimeMsByIndex`, and LWC series/marker plumbing.
- Stage 2 (`new_indicators`) provides PineTS runtime + `normalizeContext` output plumbing.
- LWC markers API is available (`createSeriesMarkers` in `lightweight-charts` v5.x).
- Line-tools primitives are available from difurious line-tools-core (see references).

## References (verified, read-only)
### Legacy parity (do not edit)
- Signal overlay: `apps/tradinggoose/widgets/widgets/data_chart/components/body/signal-overlay.ts`
- Indicator sync (pattern only): `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-indicator-sync.ts`

### PineTS runtime shapes (reference-only; do **not** import from `../PineTS`)
- Context fields (`bar_index`, `last_bar_time`): `../PineTS/src/Context.class.ts`
- `alertcondition` no-op: `../PineTS/src/namespaces/Core.ts`
- Plot output shapes: `../PineTS/src/namespaces/Plots.ts`
- Legacy sandbox pattern (vm): `apps/tradinggoose/app/api/indicators/verify/route.ts`
- Legacy `new Function` usage: `apps/tradinggoose/lib/indicators/custom/compile.ts`
- Existing sandbox runner: `apps/tradinggoose/lib/execution/e2b.ts`

### LWC marker types (reference-only; use npm `lightweight-charts`)
- `SeriesMarkerPosition`/`SeriesMarkerShape`: `../lightweight-charts/src/plugins/series-markers/types.ts`

### Line-tools (difurious line-tools-core)
- Plugin package: `difurious line-tools-core` (npm).
- Uses its own plugin API surface (per-series/pane instances + tool registration).

---

## Decisions to lock early
1) **Where line-tools live for new_data_chart (decision locked)**
- **Decision:** use difurious line-tools-core via npm (no vendoring).
- **Integration model:** one plugin instance per target series/pane (main price series + each indicator pane anchor series).
- OpenAlgo-Chart is reference-only for LWC usage patterns and is **not** a line-tools source.
- Rationale: aligns to difurious API surface and avoids OpenAlgo manager flow.

2) **Draw API shape**
- Keep a minimal API that mirrors Pine usage but is explicit:
  - `draw.tool(type, { id?, points, options?, pane?: 'price' | 'indicator', locked?, visible? })`
  - Convenience wrappers (canonical names): `draw.trendLine`, `draw.ray`, `draw.rectangle`, `draw.text`, `draw.horizontalLine`, `draw.verticalLine`.
    - Allowed aliases: `draw.rect` -> `draw.rectangle`, `draw.hLine` -> `draw.horizontalLine`, `draw.vLine` -> `draw.verticalLine`.
  - Accept `lock` as an alias for `locked` (normalize to `locked` in the recorder).
- Points accept **bar index** or **bar time (ms)** to match PineTS (`bar_index`, `last_bar_time`), but **not all tools require both axes** (see DrawPoint types).
- **Usage contract:** `draw` is **not** a global PineTS symbol; indicator code must use `context.draw` or `const { draw } = context`.

3) **Signal API shape**
- Event-style emit with optional edge/cooldown filtering (no full Pine `alertcondition` reimplementation):
  - `signal.emit({ id?, type, active?, barIndex?, timeMs?, price?, text?, color?, edge?, cooldownBars? })`
  - Helpers: `signal.buy`, `signal.sell`, `signal.value`.
- **Usage contract:** `signal` is **not** a global PineTS symbol; indicator code must use `context.signal` or `const { signal } = context`.

4) **Indicator drawings are read-only**
- Indicator-driven drawings are locked and non-persistent; do not mix with user drawings.

5) **Line-tools integration model (decision locked)**
- **Decision:** use the difurious line-tools-core plugin API only (no LineToolManager flow).
- Drawings attach/detach via plugin instances; no interactive UI for indicator drawings.

6) **Tool registration + supported tool set (decision locked)**
- **Decision:** register tool classes with difurious line-tools-core before creating tools.
- **Supported tools (v1):** `TrendLine`, `Ray`, `ExtendedLine`, `HorizontalLine`, `HorizontalRay`, `VerticalLine`, `Rectangle`, `Text`, `Circle`, `Path`.
- Any `DrawInstruction.tool` outside this set is dropped with a warning in normalization.

7) **Marker strategy is fixed**
- Markers attach to the **series in the same pane** as their indicator (non-overlay) per Stage 2.
- Stage 2 already applies a **global per-render** cap after collecting markers (keep most recent by time, log once to console).
- Stage 3 adds visible‑range filtering **before** truncation to preserve in‑view markers when possible.

8) **PineTS execution is server-only and sandboxed (decision locked)**
- **Decision:** E2B sandbox for production; Node `vm` allowlist only for local/dev fallback.

---

## Data contracts (new system)
### Draw instructions (recorded in `new_indicators`)
```ts
export type DrawPointXY = { axis: 'xy'; xType: 'bar_index' | 'time'; x: number; y: number }
export type DrawPointX = { axis: 'x'; xType: 'bar_index' | 'time'; x: number }
export type DrawPointY = { axis: 'y'; y: number }
export type DrawPoint = DrawPointXY | DrawPointX | DrawPointY

export type DrawInstruction = {
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
  points: DrawPoint[]
  options?: Record<string, unknown>
  pane?: 'price' | 'indicator'
  locked?: boolean
  visible?: boolean
}
```

**Point requirements by tool (enforced in recorder):**
- `TrendLine`, `Ray`, `ExtendedLine`, `Rectangle`, `Circle`, `Text`, `Path`, `HorizontalRay`: require **XY** points.
- `HorizontalLine`: requires a single **Y** point.
- `VerticalLine`: requires a single **X** point.

### Signal events (recorded in `new_indicators`)
```ts
export type SignalEvent = {
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
```

### Normalized outputs (used by new_data_chart)
- `drawings`: **normalized** `DrawInstruction[]` with points resolved to logical indices (server-side) and ready for UI conversion into tool classes.
- `signals`: **preserve raw `SignalEvent[]`** for alert/automation hooks.
- `markers`: **render-only** `SeriesMarker<UTCTimestamp>[]` derived from signals (and plots) for LWC rendering.
  - `NormalizedPineOutput` already contains `drawings` + `signals` arrays (empty in Stage 2); Stage 3 populates them.

### Tool option mapping (line-tools expectations)
Map `draw.options` directly to line-tool option names to avoid translation bugs:
- `TrendLine`: `lineColor`, `width`, `lineStyle`, `extendLeft`, `extendRight`, `leftEnd`, `rightEnd`.
- `Rectangle`: `lineColor`, `backgroundColor`, `width`, `lineStyle`.
- `Circle`: `lineColor`, `backgroundColor`, `width`, `lineStyle`.
- `HorizontalLine`: `lineColor`, `width`, `lineStyle`.
- `HorizontalRay`: `lineColor`, `width`, `lineStyle`.
- `VerticalLine`: `lineColor`, `width`, `lineStyle`, `showLabel`, `labelBackgroundColor`, `labelTextColor`.
- `Text`: `color`, `fontSize`, `fontFamily`, plus `options.text` for content.

---

## Detailed implementation steps (maximum detail)

### 1) Draw recorder in `apps/tradinggoose/lib/new_indicators`
1.1 Add `draw.ts` (or `draw-recorder.ts`).
- Provide `createDrawRecorder()` that returns:
  - `api`: `draw.tool`, `draw.trendLine`, `draw.ray`, `draw.rect`, `draw.text`, `draw.hLine`, `draw.vLine`, `draw.circle`, `draw.path`.
  - `clear()` to reset recorder per run.
  - `getInstructions()` to return deduped list.
  - **Wrapper mapping (required):**
    - `draw.rect` → `Rectangle`
    - `draw.hLine` → `HorizontalLine`
    - `draw.vLine` → `VerticalLine`
    - Canonical wrappers (`draw.rectangle`, `draw.horizontalLine`, `draw.verticalLine`) map to the same tool values.

1.2 Input validation + dedupe
- Validate minimum point counts per tool.
- Ensure points are finite numbers; drop invalid points.
- Dedupe by `id` **within a run** (last write wins). If `id` is absent, allow duplicates.

1.3 Normalize tool options
- Preserve options verbatim for now; do not invent new fields.
- For `Text`/`Callout`, store `options.text` to align with line-tool import behavior.

### 2) Signal recorder in `apps/tradinggoose/lib/new_indicators`
2.1 Add `signal.ts` with `createSignalRecorder()`.
- `signal.emit(event)` pushes a raw event.
- Helpers:
  - `signal.buy({...})` defaults to `shape: 'arrowUp'`, `position: 'belowBar'`.
  - `signal.sell({...})` defaults to `shape: 'arrowDown'`, `position: 'aboveBar'`.
  - `signal.value({...})` defaults to `shape: 'circle'`, `position: 'inBar'`.

2.2 Edge + cooldown post-processing
-- Track `lastActiveById` and `lastFiredIndexById` per indicator execution context.
-- `edge` behavior:
  - `true | 'rising'`: only emit when `active` transitions false -> true.
  - `'falling'`: only emit when `active` transitions true -> false.
  - `'both'`: emit on any transition.
-- `cooldownBars`: suppress emits for N bars after a fire (by **resolved barIndex**).
  - **If event only has `timeMs`, defer cooldown/edge evaluation until barIndex is resolved in normalization (Step 4.3).**
  - **Ordering:** after resolving indices, sort events by `barIndex` then apply edge/cooldown deterministically.

2.3 Default coordinates
-- If `barIndex` is missing but `timeMs` exists, resolve index later in normalization **before** edge/cooldown filtering.
-- If neither `barIndex` nor `timeMs` exists, drop the event and warn.

### 3) Inject draw/signal into PineTS execution
3.1 Extend runtime entry points:
- `apps/tradinggoose/lib/new_indicators/run-pinets.ts` (or `custom/compile.ts`) should:
  - Create draw/signal recorders per execution.
  - Attach to PineTS context as `context.draw` and `context.signal`.
  - Call `draw.clear()` and `signal.clear()` before each run.
  - **Editor prompt update (Stage 2):** include `const { draw, signal } = context;` so authors don’t assume globals.

3.2 Preserve PineTS patterns
- Keep `context.pine.*` as-is; do not modify PineTS core.
- Use `pine.bar_index` or `pine.last_bar_time` in user code for coordinates.

### 4) Normalize draw/signal outputs (new_indicators)
4.1 Extend `apps/tradinggoose/lib/new_indicators/types.ts`.
- Add `DrawInstruction`, `DrawPoint`, `SignalEvent`, `NormalizedSignal` types.

4.2 Add `normalize-drawings.ts` (or extend `normalize-context.ts`) **on the server**.
- Resolve points to **logical indices** using:
  - `barIndex` directly, or
  - `timeMs` -> `indexByOpenTimeMs` map computed **server‑side** from the execution bars.
- Drop points that resolve to `undefined` indices.
- Output **normalized drawings** still in `DrawInstruction` shape, but with points converted to logical index form:\n  - `DrawPointXY` keeps `xType: 'bar_index'` and `x = logicalIndex`.\n  - `DrawPointX` keeps `xType: 'bar_index'` and `x = logicalIndex`.\n  - `DrawPointY` unchanged.\n  - Keep `options`, `locked`, `visible`, `pane`.\n+- **Normalize options to line-tools**:
  - `draw.ray` -> `TrendLine` with `extendRight: true`.
  - `draw.extendedLine` -> `TrendLine` with `extendLeft: true`, `extendRight: true`.
  - `draw.arrow` (if added later) -> `TrendLine` with `rightEnd: 1` (or `leftEnd: 1`).
  - Avoid `extend`/`showArrow` option names (not used by tool classes).
 
4.2.a UI conversion (client)
- `new_data_chart` converts normalized `DrawInstruction` -> tool class instances (no server ToolState output).
- **No double-normalization:** client assumes `xType: 'bar_index'` already represents logical indices.

4.3 Add `normalize-signals.ts`.
- Convert `SignalEvent` -> `SeriesMarker` **without discarding the original signals**:
  - `time`: seconds (`Math.floor(timeMs / 1000)`) or derive from `openTimeMsByIndex[barIndex]` computed from execution bars.
  - `position`/`shape` validated against LWC marker types.
  - `price` required for `atPrice*` positions.
- Sort markers by time; **do not cap here**. Capping is applied during visible‑range rendering (Step 6.1.a) to avoid dropping in‑view markers.

### 5) Wire drawings + signals into `new_data_chart`
5.0 Hook location (align with Stage 1/2 structure)
- Prefer extending `use-new-indicator-sync` to handle drawings + signals alongside the existing series/marker pipeline.
- If a separate hook is used, it must share access to indicator pane anchor series (currently internal to `use-new-indicator-sync`).
- Invoke from `components/chart-body.tsx` alongside existing chart hooks.
5.1 Line-tools adapter (difurious plugin per series/pane)
- Add a new adapter under `apps/tradinggoose/widgets/widgets/new_data_chart/drawings/`.
- Create **one difurious line-tools-core plugin instance per target series/pane**:
  - Main price series.
  - Each indicator pane anchor series (from `indicatorPaneSeriesMap[indicatorId]` in Stage 2).
- **Required alignment with current code:** `indicatorPaneSeriesMap` is internal today. Expose the anchor series (e.g., extend `indicatorRuntimeRef` or add a new ref) so drawings can attach to the correct pane.
- Maintain a map `{ series -> pluginInstance }` and `{ indicatorId -> toolRefs[] }`.
- On indicator removal: detach/destroy that indicator’s tools; if a series has no remaining tools, dispose its plugin instance.
- Plugin attaches to **chart + series**; always choose the series that represents the target pane.
- **Pane handling (required):**
   - `DrawInstruction.pane` is a **symbolic target**, not an external pane id.
   - Allowed values: `'price'` or `'indicator'`.
   - Default: `pane` omitted → attach to main price series.
   - If `pane === 'indicator'`, attach to the **current indicator’s pane series** (from `indicatorPaneSeriesMap[indicatorId]` in Stage 2).
   - If the indicator pane is missing/unavailable, log a warning and fall back to main price series.
- **Visibility handling (required):**
   - If `visible === false`, do **not** attach the tool to the series (or detach if already attached).
   - If `visible !== false`, attach the tool normally.
   - Do **not** rely on `options.visible`; use attach/detach to hide/show.

5.1.a Tool registration (required)
- Register tool classes with difurious line-tools-core **before** creating any tools.
- Supported tool set (v1): `TrendLine`, `Ray`, `ExtendedLine`, `HorizontalLine`, `HorizontalRay`, `VerticalLine`, `Rectangle`, `Text`, `Circle`, `Path`.
- Registration is done once per plugin instance (or globally if the API is global); do **not** create tools before registration.

5.2 Draw instruction mapping
- Map `DrawInstruction.tool` -> difurious registered tool type key.
- Ensure minimum point counts:
  - TrendLine/Ray/ExtendedLine/Rectangle/Circle: 2 points.
  - HorizontalLine: 1 point (**Y** only).
  - HorizontalRay: 1 point (**XY** anchor with logical + price).
  - VerticalLine: 1 point (**X** only).
  - Text: 1 point + `options.text`.
  - Path: **at least 2** XY points.
- Respect `locked` flag for indicator drawings.
- **Ray/ExtendedLine/Arrow mapping resolution**:
  - Always map to `TrendLine` with `extendLeft`/`extendRight` and `leftEnd`/`rightEnd`.
  - Do **not** use `extend`/`showArrow` option names (difurious tools expect explicit fields).

5.3 Signal markers (per‑series, per‑pane)
- **Decision:** markers attach to the **series in the same pane** as their indicator (non‑overlay), not always the main series (align with Stage 2).
- Maintain a `seriesMarkersMap` keyed by series (e.g., `Map<ISeriesApi, SeriesMarkersPrimitive>`).
- Build marker groups per target series (merge signal markers with existing plot markers before capping):
  - Overlay indicators → attach markers to `mainSeries`.
  - Non‑overlay indicators → attach markers to that indicator’s **pane anchor series** (see Stage 2: `indicatorPaneSeriesMap`).
  - If an indicator has only shape/char markers and no numeric series, create a hidden line series in the pane to host markers.
    - Populate the anchor series with **whitespace data for every bar** (`{ time }` items aligned to `openTimeMsByIndex` **converted to seconds**) so markers can render in that pane.
- For each target series: `createSeriesMarkers(series, markers)` and `setMarkers(markers)`.
- Clear markers on listing/provider changes.
- When total markers exceed `MAX_MARKERS_TOTAL` (global per-render total):
  - Keep most recent by time (global cap) and log a one‑time console warning (match Stage 2).
  - Prefer range-based filtering (see Step 6.1) before truncation.

5.4 Alert/automation hooks
- Keep a callback surface (per indicator) to bridge `signals` into alert/automation pipeline.
- Do not implement full TradingView alertcondition; use event-based emit only.

### 6) Hardening + telemetry
6.1 Perf guards
- Add caps:
  - `MAX_DRAWINGS_PER_INDICATOR` (e.g., 200)
  - `MAX_MARKERS_TOTAL` (e.g., 2000; global per-render total across all panes/series)
- Warn + truncate when caps hit:
  - Client: console warning (use the Stage 2 warn‑once pattern).
  - Server: `createLogger` where applicable.

6.1.a Marker density control (LWC)
- Maintain **full marker list** in memory but **render only visible range** (new in Stage 3):
  - Use `chart.timeScale().subscribeVisibleLogicalRangeChange`.
  - Translate logical range -> time range via `openTimeMsByIndex` **converted to seconds**.
  - Filter markers by time **per target series** (marker times are in seconds), then call `seriesMarkersMap.get(series).setMarkers(visibleMarkers)` for each series.
- Throttle marker updates with `requestAnimationFrame` to avoid churn.
- If visible range still exceeds cap, keep most recent within range and warn.

6.2 Timing metrics
- Capture PineTS **execution** duration on the server (use `Date.now()` or high-res timers in the API route).
- Optionally capture **render** duration on the client (markers + drawings apply time).
- Track counts: plots, markers, drawings, signals.

6.3 Telemetry
- Use `trackPlatformEvent` (server) or `posthog` (client) if available to record:
  - `pinets.execution_ms`, `pinets.drawings_count`, `pinets.signals_count`.
- Keep telemetry optional; do not hard-fail if disabled.

### 7) PineTS sandboxing (security hardening)
7.1 **Server-only execution**
- Do not execute PineTS in the browser; route verify/execute through server-only endpoints.
- Align with the legacy verify pattern (`apps/tradinggoose/app/api/indicators/verify/route.ts`).

7.2 **Choose a sandbox strategy (lock one)**
- **Preferred (production)**: run PineTS execution inside E2B (`apps/tradinggoose/lib/execution/e2b.ts`) with strict timeouts and no secrets.
  - **Packaging requirement (decision locked):** E2B runs raw code, so `pinets` must be bundled into the payload.
    - **Decision:** bundle a single JS payload (PineTS runtime + indicator code + harness) via esbuild/rollup and send that to E2B.
  - Only pass input data + code; no credentials.
  - Enforce `MAX_EXECUTION_DURATION` and kill sandbox on timeout.
- **Fallback (dev/local)**: Node `vm` with a **hard allowlist** (`Math`, `Date`, `console`), frozen globals, and an execution timeout.
  - Reject access to `process`, `require`, `globalThis`, `fetch`, etc.
  - Run inside a worker thread or isolated process to enforce timeouts and memory ceilings.

7.3 **Audit + tests**
- Add a security test: a PineTS script attempting `process.env` or `require('fs')` must fail.
- Log sandbox violations with `createLogger` and return a safe error code (`runtime_error`).

### 8) Optional cutover readiness (no legacy changes)
- Keep new widgets behind a UI label or feature flag.
- Allow rollback by hiding the new widget registry entry; leave legacy untouched.

---

## Acceptance criteria
- Drawings and signals render end-to-end in **new** widgets only.
- Indicator drawings are read-only and do not pollute manual drawings.
- LWC markers show buy/sell signals with correct time/price placement.
- No changes to legacy widgets or migrations.
- Performance remains stable on large datasets (scroll-back + live updates).

## Validation
- Manual: create a PineTS indicator that calls `draw.*` and `signal.*`; verify:
  - correct placement (by bar_index and by timeMs)
  - edge/cooldown suppression
  - marker shapes/positions
- Regression: ensure legacy `data_chart` behaves identically.
- Stress: load large datasets and verify UI responsiveness; confirm caps + warnings.

## Residual risks (after mitigations)
- Tool option drift if line-tools are updated upstream; re-validate option mapping on upgrade.
- Marker storms from extremely chatty indicators; caps + range filtering reduce impact but do not eliminate UI overhead.
- Sandbox escape risk is reduced but depends on the chosen isolation strategy; production should default to E2B.

## Rollback / backout
- Disable `new_data_chart` entry in `apps/tradinggoose/widgets/registry.tsx` if issues arise.
- Remove indicator drawing/marker hooks without affecting legacy widgets.
