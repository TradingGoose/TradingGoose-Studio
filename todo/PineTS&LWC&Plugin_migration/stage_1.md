# Stage 1: Build new_data_chart (LWC + data pipeline) (v0.1 internal)

## Goal
Deliver a working LWC chart widget under `apps/tradinggoose/widgets/widgets/new_data_chart` without modifying the legacy `data_chart` widget. This stage establishes the **new data pipeline** (market series + live bars + scroll‑back) and LWC rendering core for the new system.

## Scope
- New widget + hooks + utils/options for the parallel LWC chart system.
- LWC chart instance, data loading, live updates, scroll‑back, rescale, and visible‑range persistence.
- Timezone formatting using explicit selected timezone or UTC (no browser‑local fallback) + timezone selector UI.
- Header controls (provider/listing/interval/candle) + footer controls (range presets, market session, normalization).
- Listing overlay + crosshair legend.
- Provider settings (required params + auth) scoped to the widget.
- Register the new widget in the global widget registry.
- **Do not** expose legacy indicators in this stage.

## Non‑goals
- PineTS indicator execution (Stage 2).
- Draw/signal APIs (Stage 3).
- Any changes to legacy `data_chart` files.
- Any edits to `*/migration/*` or `*/migrations/*` files.

## System standards alignment (must stay true)
- **AGENTS.md**: no migration edits; no legacy support; minimal, readable changes.
- **overview.md**: no browser‑local timezone fallback; internal timestamps are UTC epoch ms; LWC uses seconds; legacy widgets remain untouched.
- **No dual‑run**: new widget is a separate registry entry; no fallback inside legacy widgets.

## References (verified, read‑only)
### Widget registry & params/events
- `apps/tradinggoose/widgets/registry.tsx`
- `apps/tradinggoose/widgets/events.ts`
- `apps/tradinggoose/widgets/utils/chart-params.ts`

### Legacy chart for parity (do not edit)
- `apps/tradinggoose/widgets/widgets/data_chart/index.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/types.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/utils.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/remapping.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/chart-utils.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/chart-styles.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/listing.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-chart-instance.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-chart-defaults.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-chart-data-loader.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-live-bars.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-chart-rescale.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-chart-styles.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-theme-version.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/chart-state-overlays.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/components/header.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/components/chart-controls.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/components/provider-controls.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/components/listing-control.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/components/footer.tsx`
- `apps/tradinggoose/widgets/widgets/components/indicator-dropdown.tsx`

### Market types, windows, series planning
- `apps/tradinggoose/providers/market/types/sereis.ts`
- `apps/tradinggoose/providers/market/series-window.ts`
- `apps/tradinggoose/providers/market/series-planner.ts`
- `apps/tradinggoose/providers/market/providers.ts`
- `apps/tradinggoose/lib/market/mock-series.ts`

### Timezone helpers
- `apps/tradinggoose/lib/time-format.ts`
- `apps/tradinggoose/components/timezone-selector/fetchers.ts`
- `apps/tradinggoose/lib/timezone/timezone-resolver.ts`

### LWC references
- `../lightweight-charts/package.json` (v5.1.0)
- `../lightweight-charts/src/model/localization-options.ts`
- `../lightweight-charts/src/model/horz-scale-behavior-time/time-based-chart-options.ts`
- `../lightweight-charts/src/model/price-scale.ts`
- `../openalgo-chart/src/components/Chart/ChartComponent.jsx`
- `../openalgo-chart/src/components/Chart/utils/seriesFactories.js`
- `../openalgo-chart/src/components/Chart/utils/chartConfig.js`

### lightweight-charts-react-components (reference only)
- **Required reference checkpoints (Stage 1 only):**
  - **Step 5.1 (chart setup):** check `../lightweight-charts-react-components/lib/README.md` "Chart Container Sizing" to confirm explicit sizing expectations; use this to validate the ResizeObserver + container sizing in `use-chart-instance.ts`.
  - **Step 5.2 (chart options):** check `../lightweight-charts-react-components/lib/src/chart/types.ts` and `../lightweight-charts-react-components/lib/src/chart/useChart.ts` to confirm option/event names (onClick, onCrosshairMove). Only use as naming validation; do not add new events in Stage 1.
  - **Step 6.1 (style mapping):** check `../lightweight-charts-react-components/lib/src/series/types.ts` to verify series option shapes passed to LWC; use it to validate `buildSeriesOptions` output.
  - **Step 9.3 + 10.3 (data updates):** check `../lightweight-charts-react-components/lib/src/series/types.ts` and `useSeries` logic to confirm when to replace data vs incremental update; use this to justify `setData` vs `update` in loader/live-bars hooks.
  - **Conceptual layout only:** if you need a mental model for panes/scales/markers, skim `../lightweight-charts-react-components/lib/README.md` examples, but do not mirror component usage in Stage 1.

---

## Data contracts & conversions (explicit)
1. **MarketSeries input**
   - `MarketBar.timeStamp` is ISO string. Parse with `Date.parse(bar.timeStamp)` or `new Date(bar.timeStamp).getTime()` (do **not** call `new Date().getTime()`).
   - Missing OHLC rules **must match** legacy `mapMarketBarToData`:
     - `open = bar.open ?? bar.close ?? 0`
     - `close = bar.close ?? bar.open ?? 0`
     - `high = bar.high ?? bar.close ?? 0`
     - `low = bar.low ?? bar.close ?? 0`

2. **Canonical internal timeline (ms)**
   - `barsMs` entries: `{ openTime, closeTime, open, high, low, close, volume?, turnover? }`.
   - `openTime = parsed timestamp (ms)`.
   - `closeTime`:
     - If next bar exists, use next bar’s `openTime`.
     - Else if interval known, use `openTime + intervalMs`.
     - Else fallback to `openTime` (avoid NaN).
   - **Merge rule:** whenever a bar is appended or inserted, recompute `closeTime` for the bar immediately before it (the previous bar’s `closeTime` must equal the new bar’s `openTime`).

3. **LWC timeline (seconds)**
   - LWC series time uses seconds: `time = Math.floor(openTime / 1000)`.
   - Conversion must be stable and monotonic (sorted ascending by `openTime`).

4. **Dedup & indexing**
   - Dedupe by `openTime` (incoming replaces existing).
   - Always sort ascending by `openTime` after merge.
   - Maintain index maps for later PineTS offsets:
     - `indexByOpenTimeMs: Map<number, number>`
     - `openTimeMsByIndex: number[]`

5. **Timezone formatting**
   - Resolve timezone: `params.view.timezone` → `series.timezone` → `'UTC'`.
   - **Never** fallback to browser‑local timezone.
   - Respect user locale: pass `params.view.locale` into LWC `localization.locale` and into `Intl.DateTimeFormat` when formatting ticks/crosshair (legacy uses `chart.setLocale`).
   - Stored timezone values may already be normalized to **offsets** for non‑DST zones (see `normalizeTimezoneValueForStorage` in `timezone-resolver.ts`).
   - If timezone is a **UTC offset** (`+HH:MM` or `UTC`), **shift** timestamps by the offset minutes and format in UTC (Intl does not accept offsets as `timeZone`). Use helpers in `apps/tradinggoose/lib/time-format.ts`.
   - Use `Intl.DateTimeFormat` with `timeZone` option for IANA zones:
     - `chart.applyOptions({ localization: { timeFormatter } })`
     - `chart.applyOptions({ timeScale: { tickMarkFormatter } })`

---

## Detailed implementation steps (maximum detail)

### 0) Dependency posture (new system only)
0.1 Ensure `lightweight-charts` is available to `apps/tradinggoose`.
- **Decision:** use the published npm package `lightweight-charts@^5.1.x` in `apps/tradinggoose/package.json` (do **not** link the local `../lightweight-charts` workspace).
  - Reason: local repo declares `engines.node >= 22.3`, which conflicts with `apps/tradinggoose` (node >= 20).
  - Local repo remains **reference-only** for API reading.
- **Do not** remove `klinecharts`; legacy still depends on it.

### 1) New widget scaffolding
1.1 Create directories:
- `apps/tradinggoose/widgets/widgets/new_data_chart/`
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/`
- `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/`
- `apps/tradinggoose/widgets/widgets/new_data_chart/utils/`

1.2 Create `apps/tradinggoose/widgets/widgets/new_data_chart/index.tsx`:
- Export `newDataChartWidget` with key `new_data_chart`.
- Category `utility` (matches legacy data_chart).
- Description should explicitly state this is the LWC/PineTS migration path.

Pseudocode:
```ts
export const newDataChartWidget: DashboardWidgetDefinition = {
  key: 'new_data_chart',
  title: 'New Data Chart',
  icon: CandlestickChart,
  category: 'utility',
  description: 'Parallel LWC chart (migration path).',
  component: (props) => <NewDataChartWidgetBody {...props} />,
  renderHeader: renderNewDataChartHeader,
}
```

1.3 Register in `apps/tradinggoose/widgets/registry.tsx`:
- Import `newDataChartWidget`.
- Add to `widgetRegistry` map with key `new_data_chart`.

1.4 Create `apps/tradinggoose/widgets/widgets/new_data_chart/options.ts`:
- `providerOptions = getMarketProviderOptionsByKind('series')` for provider selector.
- `CANDLE_TYPE_OPTIONS` list (solid/hollow/up/down/ohlc/area) with icons for the candle dropdown.

### 2) Types + params wiring (avoid legacy indicator coupling)
2.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/types.ts`:
- Define **local** `DataChart*` types for the new widget (no re‑export of legacy `data_chart` types).
- `DataChartViewParams` includes: `locale`, `timezone`, `start`, `end`, `interval`, `marketSession`, `pricePrecision`, `volumePrecision`, `candleType`, `priceAxisType`, `rangePresetId`, `stylesOverride`, and `pineIndicators` (reserved for Stage 2).
- `DataChartDataParams` includes provider selection, `providerParams`, `auth`, and optional `live` config.
- `DataChartWidgetParams` includes `listing`, `data`, `view`, and `runtime.refreshAt`.
- `NewDataChartViewParams` and `NewDataChartWidgetParams` are **aliases** of these local types for readability; no legacy `view.indicators` field exists.

2.2 Params persistence (events):
- Use `useDataChartParamsPersistence({ onWidgetParamsChange, panelId, widget, params })`.
- **Note:** the hook does not accept `widgetKey`; it scopes by `widget.key`.
- All `emitDataChartParamsChange` calls pass a `widgetKey` derived from `widget.key` (fallback to `'new_data_chart'` when needed).

### 3) Widget body composition (parallel to legacy, but LWC)
3.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/chart-body.tsx`:
- Mirror `DataChartWidgetBody` structure without indicator sync.
- Use:
  - `useSocket()` for live bars.
  - `usePairColorContext()` + `pairColor` logic for listing (match legacy).
  - `resolveSeriesWindow()` + `intervalToMs()` for interval/window resolution.
  - `useChartDefaults()` to persist derived interval + default `marketSession`.
  - `useChartInstance()` to create the LWC chart + refs.
  - `useChartDataLoader()` to load series + scroll‑back + live bars.
  - `useChartVisibleRange()` to persist `view.start`/`view.end` from the visible range.
    - Debounce writes (~250ms) and also keep `view.interval` in sync when needed.
    - Range inference uses `openTimeMsByIndex` and `intervalMs` to extrapolate when the visible range extends beyond loaded bars.
  - `useChartLegend()` + `<ChartLegend />` overlay for crosshair values.
  - `useChartStyles()` + `useThemeVersion()` for options/series updates.
  - `useListingState()` to resolve listing details for the legend overlay.
  - Maintain a shared `dataContextRef` (bars/index maps/market sessions/intervalMs) and pass it to loader + live bars + legend.

3.2 Data handling state:
- Keep `dataVersion` and update it on initial load and throttled live updates (10s guard).
- Track `seriesTimezone` from data loader for formatting.
- **Also bump `dataVersion` after scroll‑back merges** so Stage‑2 PineTS sync recomputes indicators on backfill.

3.3 Empty/error state logic:
- No workspace → “Select a workspace to load chart data.”
- Missing provider/listing → show `Empty` overlay with:
  - “Select a provider and listing” / “Select a provider” / “Select a listing”
  - matching descriptions in `chart-body.tsx`.
- Errors (after provider + listing present) → “Failed to load data” with provider‑derived message.

### 4) Header/controls (avoid legacy indicator UI)
4.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/header.tsx`:
- Use the **new_data_chart** `DataChartProviderControls` and `DataChartListingControl` (mirrored from legacy logic).
  - Provider controls include settings popover (required params + auth), provider selector, and refresh button.
  - Listing control uses the listing selector store and pair‑color context for non‑gray widgets.
- Use `DataChartChartControls` from `components/chart-controls.tsx` to render:
  - Interval dropdown
  - Candle type dropdown
- **Do not** render legacy indicator dropdown in Stage 1.

4.2 Controls are implemented locally in `components/chart-controls.tsx` (not imported from legacy).

### 5) LWC chart instance
5.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/use-chart-instance.ts`:
- `createChart(container, options)` (no series created here).
- Keep refs: `chartRef`, `chartContainerRef`, `mainSeriesRef`, plus `chartReady` state.
- `ResizeObserver` to call `chart.resize(width, height)` when the container changes.
- Cleanup: `chart.remove()` and disconnect observer; clear refs.
- **Reference checkpoint (sizing):** confirm container sizing expectations in `../lightweight-charts-react-components/lib/README.md` ("Chart Container Sizing") before finalizing container styles and ResizeObserver behavior.

5.2 Initial chart options (baseline):
- `layout: { fontFamily, textColor, background, attributionLogo: false }` (derive from container computed styles; only set background when non‑transparent).
- `grid` line colors (match legacy tone: subtle, e.g., `#88888825`).
- **Right‑offset decision:** use `timeScale.rightOffset = DEFAULT_RIGHT_OFFSET (50)` to match the **applied default range** logic in `ChartComponent.jsx` (`applyDefaultCandlePosition`), which overrides the initial options. Treat `DEFAULT_RIGHT_OFFSET` as the source of truth to avoid UX drift.
- **Time scale visibility:** set `timeScale.timeVisible = true` (matches `ChartComponent.jsx`).
- **Scroll/scale defaults:** match `ChartComponent.jsx` unless we deliberately diverge:
  - `handleScroll: { mouseWheel: false, pressedMouseMove: true }`
  - `handleScale: { mouseWheel: true, pinch: true }`
  - `kineticScroll: { mouse: false, touch: false }` (openalgo disables both; LWC default enables touch)
- **Reference checkpoint (options naming):** verify option/event names in `../lightweight-charts-react-components/lib/src/chart/types.ts` and `../lightweight-charts-react-components/lib/src/chart/useChart.ts` to avoid typos (no new events added in Stage 1).

### 6) Style + series mapping (LWC)
6.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/utils/chart-styles.ts` and wire it in `hooks/use-chart-styles.ts`:
- Map `DataChartViewParams` → LWC options + formatters.
- Use `PriceScaleMode` mapping:
  - `normal` → `PriceScaleMode.Normal`
  - `percentage` → `PriceScaleMode.Percentage`
  - `log` → `PriceScaleMode.Logarithmic`
- **Reference checkpoint (series options shape):** confirm series option shape in `../lightweight-charts-react-components/lib/src/series/types.ts` when building `buildSeriesOptions` to keep option keys aligned with LWC.

6.2 Candle type mapping (complete):
- `candle_solid` → `CandlestickSeries` (solid body).
- `candle_stroke` → `CandlestickSeries` **full hollow** (both bodies transparent):
  - `upColor: 'transparent'`
  - `downColor: 'transparent'`
  - `borderVisible: true`, `borderUpColor`, `borderDownColor`
  - `wickUpColor`, `wickDownColor`
- `candle_up_stroke` → `CandlestickSeries` **up hollow, down solid**:
  - `upColor: 'transparent'`, `downColor` solid
  - `borderVisible: true`, `borderUpColor`, `borderDownColor`
- `candle_down_stroke` → `CandlestickSeries` **down hollow, up solid**:
  - `downColor: 'transparent'`, `upColor` solid
  - `borderVisible: true`, `borderUpColor`, `borderDownColor`
- `ohlc` → `BarSeries` (use `upColor` / `downColor`).
- `area` → `AreaSeries` (convert OHLC → `{ time, value }` using `close` as `value`, matching `../openalgo-chart/src/components/Chart/utils/seriesFactories.js`).
Note: LWC does **not** expose separate hollow‑candle series types; hollow variants are achieved via `CandlestickSeries` styling. `openalgo-chart` only demonstrates **up‑hollow** via `hollow-candlestick` (maps to `candle_up_stroke`). For `candle_stroke` (full hollow) and `candle_down_stroke`, apply the transparent body rules above using LWC candlestick options (`../lightweight-charts/src/model/series/candlestick-series.ts`) and the UI types in `apps/tradinggoose/widgets/widgets/new_data_chart/types.ts`.

6.2.a Candle type changes (resolved):
- LWC does **not** support in‑place type changes.
- On `candleType` change:
  1) `chart.removeSeries(mainSeriesRef.current)` if present.
  2) Recreate series with new type.
  3) Re‑apply priceFormat + style options.
  4) Re‑set current data via **type‑aware** mapping (`mapBarsMsToSeriesData` for OHLC vs area).

6.3 Precision:
- Use `priceFormat` on series:
  - `precision = pricePrecision ?? 2`
  - `minMove = 1 / 10^precision`
- If adding volume series later, set `priceFormat: { type: 'volume' }`.

6.4 `stylesOverride` handling (resolved whitelist):
- Only allow these keys to avoid silent mismatches:
  - `layout`, `grid`, `crosshair`, `rightPriceScale`, `leftPriceScale`, `timeScale`, `localization`.
- **Disallow** `localization.timeFormatter` and `timeScale.tickMarkFormatter` overrides (timezone formatting is centralized).
- Warn on any unsupported keys and ignore them.

6.5 Theme changes:
- Use `useThemeVersion()` to re‑apply styles when theme changes (same pattern as legacy).

### 7) Timezone formatting (no browser fallback)
7.0 **Explicit sign-off required** (UX change)
- Legacy chart falls back to browser-local timezone (see `apps/tradinggoose/widgets/widgets/data_chart/components/chart-styles.ts`).
- New system forbids local fallback; requires explicit product sign-off before rollout.

7.1 Create helper `formatLwcTime(time, tz, locale)`:
- If `time` is number: treat as seconds → `new Date(time * 1000)`.
- If `time` is `BusinessDay`: create date from `year, month, day` (UTC).
- If `time` is string (`YYYY‑MM‑DD`), parse as UTC date (`${time}T00:00:00Z`), no local timezone.
- **Offset handling:**
  - If `tz` is a UTC offset (`isUtcOffset(tz)`), compute `offsetMinutes = parseUtcOffsetMinutes(tz)`.
  - Shift the UTC date by `offsetMinutes * 60_000` and format with `Intl.DateTimeFormat(locale, { timeZone: 'UTC', ... })`.
  - This mirrors existing offset helpers and avoids Intl rejecting offsets.
- **IANA handling:**
  - If `tz` is not an offset, format with `Intl.DateTimeFormat(locale, { timeZone: tz, ... })`.

7.2 Apply to chart:
```ts
chart.applyOptions({
  localization: { locale, timeFormatter: (t) => formatLwcTime(t, tz, locale) },
  timeScale: { tickMarkFormatter: (t, tickType) => formatLwcTick(t, tickType, tz, locale) },
})
```

7.3 Resolve timezone order:
1) `params.view.timezone` (trimmed)
2) `series.timezone` from provider
3) `'UTC'`

7.4 Tick mark formatting (avoid overlap):
- Implement `formatLwcTick(time, tickType, tz, locale)` using **short, tickMarkType‑aware formats** instead of the full crosshair format:
  - `Year` → `YYYY`
  - `Month` → `MMM`
  - `DayOfMonth` → `MMM d`
  - `Time` → `HH:mm`
  - `TimeWithSeconds` → `HH:mm:ss`
- Reuse the same offset/IANA timezone handling as `formatLwcTime` (shift offsets, format in UTC).

### 8) Series data utilities (ms → sec, merge, index)
8.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/series-data.ts`:
- `DEFAULT_BAR_COUNT = 500` and `DEFAULT_RANGE_PRESETS` (1D/5D/1W/1M/3M/6M/1Y/5Y/ALL with default intervals).
- `intervalToMs()` + `formatIntervalLabel()` for interval handling.
- `mapMarketBarToBarMs(bar, intervalMs)` → `BarMs | null`.
- `mapMarketSeriesToBarsMs(series, intervalMs)` → sorted/deduped array.
- **Type‑aware mappers**:
  - `mapBarsMsToOhlcSec(barsMs)` → `{ time, open, high, low, close }[]` for Candlestick/Bar.
  - `mapBarsMsToLineSec(barsMs)` → **OHLC → `{ time, value }`** for Area (`value = close`).
  - `mapBarsMsToSeriesData(barsMs, candleType)` → routes to the correct mapper.
  - `mapBarMsToSeriesDatum(bar, candleType)` for incremental updates.
- `mergeBarsMs(base, incoming)` → dedupe + sorted merge.
- **After merge:** recompute `closeTime` for adjacent bars (previous bar’s `closeTime` becomes next bar’s `openTime`).
- `buildIndexMaps(barsMs)` → index map + reverse list.
- Range helpers: `addRangeToDate` / `subtractRangeFromDate` for presets.

8.2 Fallback alignment (critical):
- Use legacy `mapMarketBarToData` fallback rules (see “Data contracts” section).

8.3 **Stage 2 handoff contract (explicit):**
- Define a shared data context owned by `new_data_chart` body and passed to all data‑consuming hooks.
- Suggested type (declare in `apps/tradinggoose/widgets/widgets/new_data_chart/types.ts` or a local `data-context.ts`):
```ts
export type NewDataChartDataContext = {
  barsMsRef: MutableRefObject<BarMs[]>
  indexByOpenTimeMsRef: MutableRefObject<Map<number, number>>
  openTimeMsByIndexRef: MutableRefObject<number[]>
  marketSessionsRef: MutableRefObject<MarketSessionWindow[]>
  intervalMs: number | null
  dataVersion: number
}
```
- Populate the index refs from `buildIndexMaps(barsMs)` whenever `barsMsRef` changes.
- `NewDataChartWidgetBody` must pass this context to:
  - `use-chart-data-loader` (producer)
  - `use-live-bars` (producer)
  - Stage‑2 `use-new-indicator-sync` (consumer)
- Stage 2 must not recompute index maps **in the browser**. Server execution may recompute from `barsMs` (deterministic) or accept maps in the request payload if needed for offsets.
  - **Consistency requirement:** if the server recomputes, it must use the exact same dedupe/sort/indexing logic as `buildIndexMaps(barsMs)` in this stage (sort by `openTime`, dedupe by `openTime`).

8.4 Series window helpers (`apps/tradinggoose/widgets/widgets/new_data_chart/series-window.ts`):
- Resolve `seriesWindow` using provider capabilities (`intervals`, `windowModes`, `supportsInterval`).
- Honor `view.rangePresetId` by mapping to `DEFAULT_RANGE_PRESETS`.
- Choose intervals via `chooseIntervalForRange()` (targets `DEFAULT_BAR_COUNT`).
- Expose `sanitizeNormalizationMode()` and `coerceProviderParams()` helpers.

### 9) Data loader (LWC)
9.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/use-chart-data-loader.ts`:
- Mirror the lifecycle of legacy `useChartDataLoader`, adjusted for LWC.
- Inputs: `chartRef`, `chartContainerRef`, `mainSeriesRef`, `socket`, `providerId`, `listing`, `seriesWindow`, `dataParams`, **`dataContext` refs** (`barsMsRef`, `indexByOpenTimeMsRef`, `openTimeMsByIndexRef`, `marketSessionsRef`).
- State: `chartError`, `seriesTimezone`.
- Refs: `barsMsRef`, `lastProviderRef`, `lastListingKeyRef`, `lastWindowSpanRef`, `expectedBarsRef`, `loaderVersionRef`, `lastRefreshAtRef`, `rescaleKeyRef`.

9.2 Provider params & normalization:
- Build `providerParams` using `coerceProviderParams` and **remove** API credentials.
- If `view.marketSession` is set, include `marketSession` in the provider params before coercion.
- Resolve `normalizationMode` like legacy:
  - From `providerParams.normalization_mode` (trimmed)
  - Fallback to provider’s first supported mode
  - `sanitizeNormalizationMode()` before use
- Footer normalization dropdown auto-sets `providerParams.normalization_mode` to the provider’s first supported mode when unset.

9.3 Fetch series:
- POST `/api/providers` with body:
```json
{ "provider": "…", "providerNamespace": "market", "auth": {…}, "kind": "series", "listing": {…}, "interval": "…", "normalizationMode": "…", "providerParams": {…}, "windows": [...] }
```
- Use `seriesWindow.requestInterval` (legacy pattern) for the request `interval` so providers that set `supportsInterval: false` don’t receive an unsupported interval.
- If a pending absolute range (`view.start`/`view.end`) exists, fetch that range once; otherwise use `seriesWindow.windows`.
- Parse with `assertMarketSeries` (legacy helper).
- Convert to `barsMs` → **type‑aware series data** → `mainSeries.setData()`.
- Merge `series.marketSessions` into `dataContext.marketSessionsRef` (dedupe by `start|type`, sorted).
- Store `series.timezone` (trim) for timezone formatting.
- If `expectedBars` is set and the seed response is short, call `fetchSeriesRange()` in a loop to **ensure a minimum bar count** (bounded attempts + retention limits).
- **Reference checkpoint (replace vs update):** consult `../lightweight-charts-react-components/lib/src/series/types.ts` (`alwaysReplaceData`) and `useSeries` behavior before locking `setData` usage for full reloads.

9.4 Reset conditions:
- When provider/listing changes or `dataParams.runtime.refreshAt` changes:
  - Snapshot `view.start`/`view.end` into a pending absolute range (if valid) for the next load.
  - Clear `barsMsRef` and LWC series data; reset errors/timezone.
  - Reset rescale scheduling and `lastWindowSpanRef`.
- When interval/window changes (via `rescaleKey`), reset series data + expected bars tracking.

9.5 Scroll‑back (prefetch older bars):
- Subscribe to `timeScale().subscribeVisibleLogicalRangeChange`.
- **Decision:** `PREFETCH_THRESHOLD = 126` (matches `../openalgo-chart/src/components/Chart/utils/chartConfig.js`).
- When `range.from <= threshold`, fetch older bars:
  - Use absolute window (`startMs` → `endMs`) based on `resolveForwardSpanMs` and provider retention rules.
  - Pass `allowEmpty: true` for backfill requests to avoid hard failures when no data.
  - Guard with `isLoadingOlderDataRef` + `hasMoreHistoricalDataRef` + `historicalCursorRef`.
  - Merge into `barsMsRef`, recompute index maps, call `setData` once.
  - Preserve view using `getVisibleLogicalRange` + `setVisibleLogicalRange` shifted by prepend count.
  - If retention or capability limits exist, trim merged `barsMs` to max allowed bars.
  - Trigger `onDataBackfill` after a successful merge.

9.6 Retention rules:
- Use `getMarketSeriesCapabilities(providerId)?.retention` (legacy logic).
- Do not request data before retention start.
- If `retention.maxBars` is set, trim merged history to the most recent `maxBars`.

### 10) Live bars (LWC)
10.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/use-live-bars.ts`:
- Adapt from legacy `use-live-bars`.
- Subscribe to `market-subscribe`, `market-bar`, `market-subscribed`, `market-subscribe-error`, and `connect` socket events.
- Accept **`dataContext` refs** so live updates mutate the canonical `barsMsRef` and index maps used later by PineTS.
- **Gate by provider** exactly like legacy:
  - `const liveProvider = providerId?.split('/')[0]`.
  - Only subscribe if `liveProvider` is `alpaca` or `finnhub`.
  - Otherwise skip subscription (avoid unsupported providers).
- Filter by provider/listing/interval/subscriptionId (same as legacy).

10.2 Aggregation:
- If `intervalToMs(interval)` is available, bucket live bars to interval start:
  - `bucketStartMs = floor(ts / intervalMs) * intervalMs`
  - Merge open/high/low/close/volume/turnover like legacy.

10.3 Update series:
- Convert incoming bar to `BarMs` and merge into `barsMsRef`.
- Use **type‑aware updates**:
  - OHLC series: `update({ time, open, high, low, close })`
  - Area series: `update({ time, value: close })`
- If out‑of‑order (incoming openTime < last openTime) → re‑merge and `setData()` with the correct shape.
- **Reference checkpoint (incremental updates):** review `../lightweight-charts-react-components/lib/src/series/types.ts` and `useSeries` to confirm when incremental updates are preferred over full replace; mirror that decision here.

### 11) Rescale behavior
11.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/use-chart-rescale.ts`:
- Schedule rescale via `requestAnimationFrame` until the chart width is non‑zero (max 30 attempts).
- When data is available:
  - `timeScale.resetTimeScale()`
  - `timeScale.applyOptions({ rightOffset: DEFAULT_RIGHT_OFFSET })`
  - If `expectedBars` is known, set `visibleLogicalRange` to `lastIndex - (expectedBars - 1)` → `lastIndex + DEFAULT_RIGHT_OFFSET`.
  - Otherwise use `timeScale.fitContent()`.
- Expose `resetRescale`, `scheduleRescale`, `cancelRescale`.

### 12) Widget UI wiring
12.1 `components/chart-body.tsx` renders:
- Chart container `<div ref={chartContainerRef} className='... bg-background text-foreground' />`.
- `<ChartLegend />` overlay (internally uses `ListingOverlay`).
- `Empty` overlays for missing workspace/provider/listing and errors.
- Footer with `DataChartFooter` (range presets + timezone + market session + normalization).

12.2 Header:
- `renderNewDataChartHeader` returns provider + listing + interval/candle controls (no indicators).

### 13) Acceptance & validation checks
- **Gate:** Add widget from selector, verify it renders with provider + listing.
- **Gate:** Initial load shows candles and no errors.
- **Gate:** Live bars update the latest candle (observe within 10–20s).
- **Gate:** Scroll left to trigger backfill (no visual jump; dataVersion bumps so PineTS sync can re-run).
- **Gate:** Timezone dropdown changes crosshair/time scale labels (including UTC offsets).
- **Gate:** Range preset tabs update interval + range (and clear custom start/end).
- **Gate:** Market session + normalization dropdowns update provider params and reload without errors.
- **Gate:** Panning/zooming persists `view.start`/`view.end` in widget params.
- **Gate:** Legacy `data_chart` behavior remains unchanged.

---

## Resolved decisions & mitigations
- **Time formatting:** handle `Time` union (`UTCTimestamp | BusinessDay | string`) explicitly; never use browser‑local timezone; if timezone is a UTC offset, shift by offset minutes and format in UTC.
- **Candle type changes:** re‑create series on change and re‑set data (documented in §6.2.a).
- **Scroll‑back:** use `PREFETCH_THRESHOLD = 126`; merge once and call `setData()` once per backfill; guard with `isLoadingOlderDataRef` / `hasMoreHistoricalDataRef` / retention limits.
- **Right‑offset:** set `timeScale.rightOffset = DEFAULT_RIGHT_OFFSET (50)` to match `ChartComponent.jsx` default range behavior (see §5.2).
- **Styles override:** whitelist `layout`, `grid`, `crosshair`, `rightPriceScale`, `leftPriceScale`, `timeScale`, `localization` and ignore others; disallow time formatter overrides.
- **Rescale:** use `visibleLogicalRange` based on `expectedBars` + `DEFAULT_RIGHT_OFFSET`, fallback to `fitContent()` when expected bars are unknown.
- **Visible range persistence:** debounce `view.start`/`view.end` updates from `subscribeVisibleLogicalRangeChange` to keep params in sync.
