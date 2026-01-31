# Stage 1: Build new_data_chart (LWC + data pipeline) (v0.1 internal)

## Goal
Deliver a working LWC chart widget under `apps/tradinggoose/widgets/widgets/new_data_chart` without modifying the legacy `data_chart` widget. This stage establishes the **new data pipeline** (market series + live bars + scroll‑back) and LWC rendering core for the new system.

## Scope
- New widget + hooks + remapping utilities (parallel system).
- LWC chart instance, data loading, live updates, scroll‑back, rescale.
- Timezone formatting using explicit selected timezone or UTC (no browser‑local fallback).
- Register the new widget in the global widget registry.
- Reuse existing provider/listing controls where safe, but **do not** expose legacy indicators in this stage.

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
- `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/`

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

### 2) Types + params wiring (avoid legacy indicator coupling)
2.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/types.ts`:
- **Do not** alias `DataChartWidgetParams`; it includes `view.indicators` wired to legacy indicator selection.
- Define a new view type that **omits** legacy indicators and reserves a PineTS field:
```ts
type NewIndicatorRef = { id: string }
type NewDataChartViewParams = Omit<DataChartViewParams, 'indicators'> & {
  pineIndicators?: NewIndicatorRef[]
}
export type NewDataChartWidgetParams = Omit<DataChartWidgetParams, 'view'> & {
  view?: NewDataChartViewParams
}
```
- `new_data_chart` must ignore `view.indicators` entirely to prevent legacy mixing.
- **Compatibility decision:** when reusing legacy helpers/components typed to `DataChartWidgetParams` (e.g., `useChartDefaults`, provider/listing controls, footer), pass `NewDataChartWidgetParams` via an explicit boundary cast/adapter:
   - `const legacyParams = dataParams as unknown as DataChartWidgetParams`
   - Use `legacyParams` only for shared fields (data/view locale/timezone, etc.).
   - Do **not** read/write `view.indicators` in new code.

2.2 Params persistence (events):
- Use `useDataChartParamsPersistence({ onWidgetParamsChange, panelId, widget, params })`.
- **Note:** the hook does not accept `widgetKey`; it scopes by `widget.key`.
- All `emitDataChartParamsChange` calls must pass `widgetKey: 'new_data_chart'`.

### 3) Widget body composition (parallel to legacy, but LWC)
3.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/body.tsx`:
- Mirror `DataChartWidgetBody` structure without indicator sync.
- Use:
  - `useSocket()` for live bars.
  - `usePairColorContext()` and `pairColor` logic for listing (match legacy).
  - `resolveSeriesWindow()` for interval/window resolution.
  - `useChartDefaults()` to persist derived interval/window to params.
  - `useListingState()` + `ListingOverlay` for symbol display.
  - `ChartStateOverlays` for missing provider/listing/interval and error display.

3.2 Data handling state:
- Keep `dataVersion` and update it on initial load and occasional live updates (same debounce as legacy).
- Track `seriesTimezone` from data loader for formatting.
- **Also bump `dataVersion` after scroll‑back merges** so Stage‑2 PineTS sync recomputes indicators on backfill.

3.3 Missing state logic (same messages as legacy):
- Missing provider → “Select a market data provider.”
- Missing listing → “Select a listing to load data.”
- Missing interval → “Select a supported interval.”

### 4) Header/controls (avoid legacy indicator UI)
4.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/header.tsx`:
- **Reuse** `DataChartProviderControls` and `DataChartListingControl` (they are library‑agnostic).
- Provide a **new** chart controls component that only renders:
  - Interval dropdown
  - Candle type dropdown
- **Do not** render legacy indicator dropdown in Stage 1.

4.2 If reusing existing controls:
- Import `DataChartIntervalDropdown` + `DataChartCandleTypeDropdown` from legacy chart controls.
- Compose them into a new `NewDataChartChartControls` component.

### 5) LWC chart instance
5.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-chart-instance.ts`:
- `createChart(container, options)`.
- Create main series using `chart.addSeries(CandlestickSeries, options)`.
- Keep refs: `chartRef`, `containerRef`, `mainSeriesRef`.
- `ResizeObserver` to call `chart.resize(width, height)` (or `chart.applyOptions({ width, height })`).
- Cleanup: `chart.remove()` and disconnect observer.
- **Reference checkpoint (sizing):** confirm container sizing expectations in `../lightweight-charts-react-components/lib/README.md` ("Chart Container Sizing") before finalizing container styles and ResizeObserver behavior.

5.2 Initial chart options (baseline):
- `layout: { fontFamily, textColor, background }` (derive from container computed styles).
- `grid` line colors (match legacy tone: subtle, e.g., `#88888825`).
- `crosshair` settings default (can refine later).
- **Right‑offset decision:** use `timeScale.rightOffset = DEFAULT_RIGHT_OFFSET (50)` to match the **applied default range** logic in `ChartComponent.jsx` (`applyDefaultCandlePosition`), which overrides the initial options. Treat `DEFAULT_RIGHT_OFFSET` as the source of truth to avoid UX drift.
- **Time scale visibility:** set `timeScale.timeVisible = true` (matches `ChartComponent.jsx`).
- **Scroll/scale defaults:** match `ChartComponent.jsx` unless we deliberately diverge:
  - `handleScroll: { mouseWheel: false, pressedMouseMove: true }`
  - `handleScale: { mouseWheel: true, pinch: true }`
  - `kineticScroll: { mouse: false, touch: false }` (openalgo disables both; LWC default enables touch)
- **Reference checkpoint (options naming):** verify option/event names in `../lightweight-charts-react-components/lib/src/chart/types.ts` and `../lightweight-charts-react-components/lib/src/chart/useChart.ts` to avoid typos (no new events added in Stage 1).

### 6) Style + series mapping (LWC)
6.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/chart-styles.ts`:
- Map `DataChartViewParams` → LWC options.
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
Note: LWC does **not** expose separate hollow‑candle series types; hollow variants are achieved via `CandlestickSeries` styling. `openalgo-chart` only demonstrates **up‑hollow** via `hollow-candlestick` (maps to `candle_up_stroke`). For `candle_stroke` (full hollow) and `candle_down_stroke`, apply the transparent body rules above using LWC candlestick options (`../lightweight-charts/src/model/series/candlestick-series.ts`) and the UI types in `apps/tradinggoose/widgets/widgets/data_chart/types.ts`.

6.2.a Candle type changes (resolved):
- LWC does **not** support in‑place type changes.
- On `candleType` change:
  1) `chart.removeSeries(mainSeriesRef.current)` if present.
  2) Recreate series with new type.
  3) Re‑apply priceFormat + style options.
  4) Re‑set current data via **type‑aware** mapping (`candlesSec` for OHLC; `{time,value}` for area).

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

### 8) Remapping utilities (ms → sec, merge, index)
8.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/remapping.ts`:
- `mapMarketBarToBarMs(bar, intervalMs)` → `BarMs | null`.
- `mapMarketSeriesToBarsMs(series, intervalMs)` → sorted/deduped array.
- **Type‑aware mappers**:
  - `mapBarsMsToOhlcSec(barsMs)` → `{ time, open, high, low, close }[]` for Candlestick/Bar.
  - `mapBarsMsToLineSec(barsMs)` → **OHLC → `{ time, value }`** for Area (`value = close`, per `seriesFactories.js`).
  - `mapBarsMsToSeriesData(barsMs, candleType)` → routes to the correct mapper.
- `mergeBarsMs(base, incoming)` → dedupe + sorted merge.
- **After merge:** recompute `closeTime` for adjacent bars affected by insert/replace (especially the previous last bar when appending new data).
- `buildIndexMaps(barsMs)` → index map + reverse list.

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

### 9) Data loader (LWC)
9.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-chart-data-loader.ts`:
- Mirror the lifecycle of legacy `useChartDataLoader`, adjusted for LWC.
- Inputs: `chartRef`, `mainSeriesRef`, `containerRef`, `socket`, `providerId`, `listing`, `seriesWindow`, `dataParams`, **`dataContext` refs** (`barsMsRef`, `indexByOpenTimeMsRef`, `openTimeMsByIndexRef`).
- State: `chartError`, `seriesTimezone`.
- Refs: `barsMsRef`, `lastProviderRef`, `lastListingKeyRef`, `lastWindowSpanRef`, `expectedBarsRef`, `loaderVersionRef`, `lastRefreshAtRef`, `rescaleKeyRef`.

9.2 Provider params & normalization:
- Build `providerParams` using `coerceProviderParams` and **remove** API credentials.
- Resolve `normalizationMode` like legacy:
  - From `providerParams.normalization_mode` (trimmed)
  - Fallback to provider’s first supported mode
  - `sanitizeNormalizationMode()` before use

9.3 Fetch series:
- POST `/api/providers` with body:
```json
{ "provider": "…", "providerNamespace": "market", "auth": {…}, "kind": "series", "listing": {…}, "interval": "…", "normalizationMode": "…", "providerParams": {…}, "windows": [...] }
```
- Use `seriesWindow.requestInterval` (legacy pattern) for the request `interval` so providers that set `supportsInterval: false` don’t receive an unsupported interval.
- Parse with `assertMarketSeries` (legacy helper).
- Convert to `barsMs` → **type‑aware series data** → `mainSeries.setData()`.
- Store `series.timezone` (trim) for timezone formatting.
- **Reference checkpoint (replace vs update):** consult `../lightweight-charts-react-components/lib/src/series/types.ts` (`alwaysReplaceData`) and `useSeries` behavior before locking `setData` usage for full reloads.

9.4 Reset conditions:
- When provider/listing/interval/window changes or `dataParams.runtime.refreshAt` changes:
  - Clear `barsMsRef` and LWC series data.
  - Reset rescale scheduling and errors.

9.5 Scroll‑back (prefetch older bars):
- Subscribe to `timeScale().subscribeVisibleLogicalRangeChange`.
- **Decision:** `PREFETCH_THRESHOLD = 126` (matches `../openalgo-chart/src/components/Chart/utils/chartConfig.js`).
- **Decision:** enable scroll‑back only after at least `MIN_CANDLES_FOR_SCROLL_BACK = 50` loaded (also from `chartConfig.js`).
- When `range.from <= threshold`, fetch older bars:
  - Use absolute window (`startMs` → `endMs`) based on `resolveForwardSpanMs` and provider retention rules.
  - Merge into `barsMsRef`, recompute `candlesSec`, call `setData` once.
  - Preserve view using `getVisibleLogicalRange` + `setVisibleLogicalRange` shifted by prepend count.
  - Guard with `isLoadingOlderDataRef` + `hasMoreHistoricalDataRef` to avoid duplicate fetches.
  - If retention or capability limits exist, trim merged `barsMs` to max allowed bars.

9.6 Retention rules:
- Use `getMarketSeriesCapabilities(providerId)?.retention` (legacy logic).
- Do not request data before retention start.

### 10) Live bars (LWC)
10.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-live-bars.ts`:
- Adapt from legacy `use-live-bars`.
- Subscribe to `market-subscribe` and `market-bar` socket events.
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
- If out‑of‑order or type changed → re‑merge and `setData()` with the correct shape.
- **Reference checkpoint (incremental updates):** review `../lightweight-charts-react-components/lib/src/series/types.ts` and `useSeries` to confirm when incremental updates are preferred over full replace; mirror that decision here.

### 11) Rescale behavior
11.1 Create `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-chart-rescale.ts`:
- Mirror legacy **expected‑bars spacing** behavior from `apps/tradinggoose/widgets/widgets/data_chart/components/chart-utils.ts` and `use-chart-rescale.ts`:
  - Compute `expectedBars` via `resolveExpectedBars(...)` (already tracked in loader).
  - Derive `barSpacing` from container width and expected bars (legacy `fitChartToData` logic) instead of only `fitContent()`.
  - Apply via `timeScale().applyOptions({ barSpacing })` (or `chart.applyOptions({ timeScale: { barSpacing } })`).
- On initial load: set bar spacing using expected bars, ensure `rightOffset = DEFAULT_RIGHT_OFFSET` remains applied (re‑apply via `timeScale().applyOptions({ rightOffset })` if needed), then **scroll to real time** (LWC `timeScale().scrollToRealTime()`), mirroring legacy `chart.scrollToRealTime()` instead of showing full history.
- On backfill: shift visible range to avoid jumps.
- Retry scheduling similar to legacy `useChartRescale` if the chart size is not ready.

### 12) Widget UI wiring
12.1 `components/body.tsx` should render:
- `<div ref={chartContainerRef} className='relative z-0 h-full w-full' />`
- `<ListingOverlay ... />`
- `<ChartStateOverlays ... />`
- Footer with `DataChartFooter` (safe to reuse for timezone + normalization).

12.2 Header:
- `renderNewDataChartHeader` returns provider + listing + interval/candle controls (no indicators).

### 13) Acceptance & validation checks
- **Gate:** Add widget from selector, verify it renders with provider + listing.
- **Gate:** Initial load shows candles and no errors.
- **Gate:** Live bars update the latest candle (observe within 10–20s).
- **Gate:** Scroll left to trigger backfill (no visual jump; dataVersion bumps so PineTS sync can re-run).
- **Gate:** Timezone dropdown changes crosshair/time scale labels (including UTC offsets).
- **Gate:** Legacy `data_chart` behavior remains unchanged.

---

## Resolved decisions & mitigations
- **Time formatting:** handle `Time` union (`UTCTimestamp | BusinessDay | string`) explicitly; never use browser‑local timezone; if timezone is a UTC offset, shift by offset minutes and format in UTC.
- **Candle type changes:** re‑create series on change and re‑set data (documented in §6.2.a).
- **Scroll‑back:** use `PREFETCH_THRESHOLD = 126` and `MIN_CANDLES_FOR_SCROLL_BACK = 50`; merge once and call `setData()` once per backfill; guard against concurrent loads.
- **Right‑offset:** set `timeScale.rightOffset = DEFAULT_RIGHT_OFFSET (50)` to match `ChartComponent.jsx` default range behavior (see §5.2).
- **Styles override:** whitelist `layout`, `grid`, `crosshair`, `rightPriceScale`, `leftPriceScale`, `timeScale`, `localization` and ignore others; disallow time formatter overrides.
