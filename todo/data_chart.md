# Data chart widget design (draft)

## Summary
- New widget key: `data_chart`
- Purpose: render OHLCV series using KLineCharts with data from `@/providers/market/*`.
- Listing selection happens in the widget header via `@/components/listing-selector`.
- Widget params must persist provider selection, listing identity, and series request details (window/interval/etc).
- UI composition: reuse existing system UI components for settings/provider/listing controls; the main widget body is the KLineCharts canvas (no custom chart UI beyond KLineCharts).
- Target chart engine: KLineCharts v10 (confirm style/axis API compatibility).

## References reviewed
- Widgets: `@/widgets/widgets/*` (headers, params sync, color pairing).
- Listing selector: `@/components/listing-selector/*` and `@/stores/market/selector/store`.
- Market providers + series tool: `@/providers/market/*`, `@/tools/market_data/series.ts`.
- Pair store + layout: `@/stores/dashboard/pair-store`, `@/widgets/layout`.
- KLineCharts docs via Context7 (init, data format, apply/update data, timezone/locale).

## KLineCharts usage notes
- Core lifecycle: `init(container)`, `setSymbol(...)`, `setPeriod(...)`, `setDataLoader(...)`, `applyNewData(...)`, `updateData(...)`, `resize()`, `dispose(...)`.
- Data item format (required fields):
  - `timestamp` (number, ms)
  - `open`, `high`, `low`, `close` (numbers)
  - `volume` (optional)
  - `turnover` (optional, needed for some indicators)
- Timezone/locale can be configured via `setTimezone(...)` and `setLocale(...)`.
- Custom indicators are supported via `klinecharts.registerIndicator(definition)` with a definition object (name + calc + figures, etc).
- Indicators are attached per chart using `chart.createIndicator(nameOrConfig, isStack?, paneOptions?)`.
- Chart styles are configurable via `init(..., { styles })` or `chart.setStyles(styles)`.
  - Candle type options: `candle_solid | candle_stroke | candle_up_stroke | candle_down_stroke | ohlc | area`.
  - Price axis type options (v9 styles): `normal | percentage | log` via `styles.yAxis.type`.
  - If targeting v10, confirm whether axis type is still under styles or requires custom axis registration.

## Widget params (required design)

### Proposed TypeScript shape
```ts
import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketInterval, NormalizationMode } from '@/providers/market/types'

type DataChartWidgetParams = {
  // Provider selection
  provider?: string // Market provider id (e.g. 'alpaca', 'finnhub')
  providerParams?: Record<string, unknown> // Provider-specific params (apiKey, apiSecret, feed, etc.)

  // Listing selection
  listing?: ListingIdentity | null // Canonical listing identity

  // Series request detail
  interval?: MarketInterval | string
  normalizationMode?: NormalizationMode | string
  // Window selection (primary + fallback)
  window?: { mode: 'range'; range: { value: number; unit: 'day' | 'week' | 'month' | 'year' } }
  fallbackWindow?: { mode: 'absolute'; start: string; end?: string }
  // Live mode preference (if provider supports it)
  live?: {
    enabled?: boolean
    interval?: MarketInterval | string
  }

  // Chart presentation (optional, klinecharts-specific)
  chart?: {
    locale?: string
    timezone?: string
    pricePrecision?: number
    volumePrecision?: number
    // Candle chart type (klinecharts styles.candle.type)
    candleType?: 'candle_solid' | 'candle_stroke' | 'candle_up_stroke' | 'candle_down_stroke' | 'ohlc' | 'area'
    // Price axis scale type (klinecharts styles.yAxis.type in v9)
    priceAxisType?: 'normal' | 'percentage' | 'log'
    // List of indicator DB row ids currently mounted on this chart
    // (used to fetch indicator definitions from DB at runtime)
    indicatorIds?: string[]
    // Optional styles override passthrough (advanced)
    stylesOverride?: Record<string, unknown>
  }
}
```

### Required fields to fetch data
- `provider`
- `listing`
- `window`
- `interval` when the provider supports/needs intervals (see `getMarketSeriesCapabilities`).

### Why this structure
- Aligns with `tools/market_data/series.ts` window-based parameter names.
- Keeps provider-specific params isolated in `providerParams` to avoid collisions with reserved keys.
- Listing identity is consistent with `PairColorContext.listing` and layout persistence.

## Pair color + listing sync rules
- If widget `pairColor` is not `gray`:
  - Read listing from `usePairColorContext(color).listing`.
  - On listing change, update pair store via `useSetPairColorContext`.
  - Do NOT write listing to widget params (pair store is the source of truth).
- If widget `pairColor` is `gray`:
  - Use `params.listing` as the source of truth.
  - On listing change, call `onWidgetParamsChange({ ...params, listing })`.
- Provider is always stored in widget params (pair store does not track provider).

## Header UI design
- Left:
  - [Icon only] Provider credential dropdown button (only if provider has required params), `widget-selector` dropdown button style.
    - Use provider param definitions (`getMarketProviderParamDefinitions`) to render required inputs (apiKey, apiSecret, feed, etc).
    - Save action persists into `params.providerParams`.
    - Consider masking sensitive fields in UI.
  - Provider selector dropdown (use `getMarketProviderOptionsByKind('series')`).
  - [Icon only] Refresh button (only if provider does NOT support live data).
- Center:
  - Listing dropdown selector using `ListingSelector`.
    - `instanceId` should be stable per widget/panel (e.g. `data-chart-${panelId}`).
    - Keep `ListingSelectorInstance.providerId` in sync with `params.provider` so search results are filtered by provider capabilities.
    - On provider change, clear listing selection (mirrors `ListingSelectorInput` behavior in workflow blocks).
- Right:
  - [Icon only] Interval selector dropdown, `widget-selector` dropdown button style.
  - [Icon only] Candle style dropdown, `widget-selector` dropdown button style.
  - Indicator selector (shared component similar to `workflow-dropdown` with same style [ indicator name [dropdown icon] ]).

## UI composition principles
- Settings/provider/listing UI should reuse existing system components (dropdowns, listing selector, date inputs).
- The rest of the widget UI is the KLineCharts chart surface; avoid bespoke chart UI outside of KLineCharts controls.

## Range selection layout
- Interval selection stays in the widget header (dropdown).
- Range selection is a bottom, full-width strip of predefined time ranges (TradingView-like).

## Data flow
1. User selects provider (header dropdown).
2. Listing selector updates its provider context to filter search.
3. User selects listing (header selector).
4. Widget builds a `MarketSeriesRequest` from params and calls `/api/providers` with:
   - `provider`, `kind: 'series'`, `listing`, `interval`, `windows`, `normalizationMode`, `providerParams`.
5. Transform `MarketSeries` bars into KLineCharts data:
   - `timeStamp` (ISO) -> `timestamp` (ms number)
   - map `open/high/low/close/volume`, optional `turnover` if present
6. If live is enabled and provider supports `live`, call `/api/providers` with `kind: 'live'` and update the chart via `updateData(...)`.
7. Register any workspace indicators referenced by `params.chart.indicatorIds` (see below), then chart rendering:
   - `chart.setSymbol({ ticker, pricePrecision, volumePrecision })`
   - `chart.setPeriod({ span, type })`
   - `chart.setStyles({ candle: { type: candleType }, yAxis: { type: priceAxisType } })` (v9; merge UI theme defaults)
   - For v10+: if `styles.yAxis.type` is unsupported, use `registerYAxis` + pane axis options to implement percentage/log scaling.
   - `chart.applyNewData(data, true)`
   - call `chart.setTimezone(series.timezone)` if provided
8. Resolve `indicatorIds` -> indicator definitions, then `chart.createIndicator(...)` for each resolved indicator.

## Interval mapping (MarketInterval -> KLineCharts period)
Mapping (from `providers/market/types.ts` intervals):
- Minutes:
  - `1m` -> `{ span: 1, type: 'minute' }`
  - `2m` -> `{ span: 2, type: 'minute' }`
  - `3m` -> `{ span: 3, type: 'minute' }`
  - `5m` -> `{ span: 5, type: 'minute' }`
  - `10m` -> `{ span: 10, type: 'minute' }`
  - `15m` -> `{ span: 15, type: 'minute' }`
  - `30m` -> `{ span: 30, type: 'minute' }`
  - `45m` -> `{ span: 45, type: 'minute' }`
- Hours:
  - `1h` -> `{ span: 1, type: 'hour' }`
  - `2h` -> `{ span: 2, type: 'hour' }`
  - `3h` -> `{ span: 3, type: 'hour' }`
  - `4h` -> `{ span: 4, type: 'hour' }`
- Days/Weeks:
  - `1d` -> `{ span: 1, type: 'day' }`
  - `1w` -> `{ span: 1, type: 'week' }`
  - `2w` -> `{ span: 2, type: 'week' }`
- Months:
  - `1mo` -> `{ span: 1, type: 'month' }`
  - `3mo` -> `{ span: 3, type: 'month' }`
  - `6mo` -> `{ span: 6, type: 'month' }`
  - `12mo` -> `{ span: 1, type: 'year' }` (v10 `PeriodType` supports `year`)

## Data remapping (TradingGoose -> KLineCharts)
Provider outputs are already normalized to the TradingGoose standard schema, so we only need a **single** remapping layer from TradingGoose -> KLineCharts:

Proposed file structure (single remapping module):
- `apps/tradinggoose/widgets/widgets/data_chart/remapping.ts`
  - `STANDARD_INTERVAL_MAP` (MarketInterval -> KLineCharts Period)
  - `DEFAULT_RANGE_PRESETS` (TradingView-like)
  - `DEFAULT_BAR_COUNT` (500)

Example shape:
```ts
import type { MarketInterval } from '@/providers/market/types'
import type { Period } from 'klinecharts'

export type ChartIntervalMap = Record<MarketInterval, Period>

export type RangePreset = {
  id: string
  label: string
  range: { value: number; unit: 'day' | 'week' | 'month' | 'year' }
  // Optional fixed interval for this range (otherwise computed for ~500 bars)
  interval?: MarketInterval
}
```

Rationale:
- Reuse TradingGoose standard types (`MarketInterval`) directly from `providers/market/types.ts`; do not re-define or re-export them.

## Error and empty states
- Missing workspace: render a small empty state (similar to workflow widgets).
- Missing provider/listing/interval: prompt user in header and show empty chart state.
- Provider errors: show inline error and keep existing chart data if available.

## Default range & interval rules
- Default to `window.mode = 'range'` using the first preset.
- If user selects an interval only: keep the default range window and derive an absolute fallback window from its span.
- If user selects a range preset: compute interval pairing (TradingView-style) or derive an interval that returns ~`barCount` bars for the chosen range.
- Persist computed `window` + `fallbackWindow` + `interval` so layout reload restores the same view.

## Indicators (built-in + custom)
### Custom indicator format (KLineCharts)
Custom indicators are registered globally with `registerIndicator(definition)` where `definition` is an object with (subset):
- `name` (required, unique in KLineCharts registry)
- `shortName` (optional)
- `precision` (optional)
- `calcParams` (optional array)
- `series` (optional: `normal` | `price` | `volume`)
- `figures` (optional array of `{ key, type, title?, baseValue?, attrs?, styles? }`)
- `calc` (required function): `(kLineDataList, indicator) => array/map of values keyed by `figures.key``
- Optional advanced hooks: `regenerateFigures`, `createTooltipDataSource`, `draw`, `onDataStateChange`.

Indicators are applied per chart with `chart.createIndicator(nameOrConfig, isStack?, paneOptions?)`, so a single dashboard can include different indicators per widget.

### Workspace custom indicators
Requirement: Users can write their own indicators; they are stored in `custom_indicators` table linked to workspace (similar to `custom_tools`).

#### DB schema (minimal, required fields as columns)
```sql
create table custom_indicators (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  -- core indicator config
  series text not null default 'normal', -- 'normal' | 'price' | 'volume'
  precision integer not null default 2,
  calc_params jsonb not null default '[]'::jsonb,
  figures jsonb not null default '[]'::jsonb, -- array of { key, type, title?, ... }
  -- required code
  calc_code text not null default '', -- function body or full function string (can be empty for draft)
  -- optional code hooks
  draw_code text,
  tooltip_code text,
  regenerate_figures_code text,
  -- metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index custom_indicators_workspace_id_idx on custom_indicators (workspace_id);
```
Notes:
- `name` is stored only once (column), not duplicated inside JSON.
- `calc_code` is required per KLineCharts for runtime registration; allow empty string for drafts.
- `figures` should be non-empty unless `draw_code` is provided.
- Use `custom_indicators.id` as the registry `name` when registering to guarantee uniqueness; use `custom_indicators.name` as display/short label.
- If user attribution is needed later, add `user_id uuid null` (not required for MVP).

Code column mapping:
- `calc` -> `calc_code` (required)
- `regenerateFigures` -> `regenerate_figures_code`
- `createTooltipDataSource` -> `tooltip_code`
- `draw` -> `draw_code`

Runtime behavior:
- On widget mount, fetch workspace indicators referenced by `params.chart.indicatorIds`.
- Safely compile indicator functions using the same execution model as `blocks/blocks/function.ts`, then call `klinecharts.registerIndicator(...)`.
- Use `custom_indicators.id` as the registered `name` to satisfy KLineCharts uniqueness; use `custom_indicators.name` as display label (`shortName` or UI label).
- If `calc_code` is empty, treat the indicator as draft: do not register; show a warning in UI.
- After registration, use `chart.createIndicator(...)` for those listed in `params.chart.indicatorIds`.

Open implementation concerns:
- Reuse existing safe execution model from `blocks/blocks/function.ts`.
- No versioning/backward compatibility for now.
- Indicator uniqueness is tracked by `custom_indicators.id` (name does not have to be unique).

### Indicator selection UX & storage
- Two concepts:
  1) Available indicators in workspace (not necessarily used in a chart).
  2) Indicators currently mounted on a specific chart.
- Storage:
  - Available indicators are loaded into a workspace-level store (similar to workflow registry).
  - Mounted indicators are stored in `data_chart` widget params under `params.chart.indicatorIds`.
- UI components:
  - New widget: `@/widgets/widgets/list_indicator` (analogous to `workflow_list`) to show all indicators in a workspace.
  - New shared component: `@/widgets/widgets/components/indicator-dropdown` (analogous to `workflow-dropdown`) for selecting indicators in chart header.

### editor_indicator widgets (info + code)
We split the editor into two widgets to avoid unstable tab state:
- `@/widgets/widgets/editor_indicator_info` (registered in widget selector).
- `@/widgets/widgets/editor_indicator_code` (not in selector; opened via switcher so it feels like one widget).

#### editor_indicator_info
- Header layout:
  - Left: Info/Code switcher (opens the code widget).
  - Center: Indicator dropdown selector (choose which indicator to edit).
  - Right: Save button.
- Fields:
  1) `series` (dropdown: normal/price/volume) + `precision` (number) on the same line.
  2) `calc_params` (array editor using `components/ui/input-tags.tsx`).
  3) `figures` (row-based editor for `type` and `title`).
     - `key` is auto-generated (random/unique) and not editable.
     - Show key in the row as readonly metadata (copy button optional).
     - Runtime uses `figures.key` as required by KLineCharts.
- No `name` editing here; rename via `list_indicator` widget.

#### editor_indicator_code
- Header layout:
  - Left: Info/Code switcher (returns to info widget).
  - Center: Indicator dropdown selector.
  - Right: Save button.
- Sidebar:
  - Use `components/ui/sidebar.tsx`.
  - Icon-only items: `calc`, `draw`, `regenerate`, `tooltip` (no advanced grouping).
- Editors:
  - Each section uses `code-editor.tsx`.

Validation:
- Creation requires Info fields only (draft allowed).
- Runtime usage requires `calc_code` and `figures` (unless `draw_code` is provided).
- If `calc_code` is empty, treat as draft and block mounting.

Result interface:
- The output shape is implied by `figures` keys; optionally show a read-only derived preview.

### Code editor & tag linking (indicator scope)
### Code editor & parameter autocomplete (indicator scope)
- Reuse `code-editor.tsx` for all code fields (`calc_code`, `draw_code`, `tooltip_code`, `regenerate_figures_code`).
- Follow the **custom-tools** pattern (see `custom-tools` + `custom-tool-modal`):
  - Compute a list of available indicator parameters and pass to `CodeEditor` as `schemaParameters` for highlighting.
  - Provide an inline “Available parameters” callout (chips) above the editor.
  - Implement a lightweight parameter autocomplete dropdown (word-based trigger) similar to `checkSchemaParamTrigger` in `custom-tool-modal`.
- Available parameters should include: `calcParams`, `figures`, `series`, `precision`.
- Figure keys:
  - Display a list of figure rows (title + key) in the code view sidebar or callout.
  - Allow clicking a row to insert the **key** (not the title) into code.
  - This avoids `<figures.{title}>` tokens while still making keys discoverable.
- Preserve `{{ }}` env-var grammar (same as custom tool).

### Indicator store shape (sketch)
Modeled after `stores/custom-tools`:
```ts
export interface CustomIndicatorDefinition {
  id: string
  workspaceId: string
  userId: string | null
  name: string // display label; registry name uses id for uniqueness
  series: 'normal' | 'price' | 'volume'
  precision: number
  calcParams: unknown[]
  figures: Array<Record<string, unknown>>
  calcCode: string
  drawCode?: string | null
  tooltipCode?: string | null
  regenerateFiguresCode?: string | null
  createdAt: string
  updatedAt?: string
}

export interface CustomIndicatorsStore {
  indicatorsByWorkspace: Record<string, CustomIndicatorDefinition[]>
  activeWorkspaceId: string | null

  setIndicators: (workspaceId: string, indicators: CustomIndicatorDefinition[]) => void
  getIndicator: (id: string, workspaceId?: string) => CustomIndicatorDefinition | undefined
  getAllIndicators: (workspaceId?: string) => CustomIndicatorDefinition[]
  resetWorkspace: (workspaceId: string) => void
  resetAll: () => void
}
```
Notes:
- `id` is the unique key used in `params.chart.indicatorIds`.
- No uniqueness requirement on `name`.
- Store can live at `@/stores/custom-indicators/*` and mirror `custom-tools` store patterns.

### list_indicator widget skeleton (sketch)
New widget: `@/widgets/widgets/list_indicator` (parallel to `workflow_list`).
- Responsibilities:
  - Load indicators for `context.workspaceId` via API and write into `useCustomIndicatorsStore`.
  - Render list with search + empty states.
  - Support create/edit/delete (optional, if custom indicator editor UI exists).
  - Publish selection events for other widgets (if needed).
- Header layout:
  - Center: indicator dropdown selector.
  - Right: add button to create new indicator/folder (mirror `workflow-create-menu` behavior).
- Suggested structure:
  - `index.tsx` (widget entry; header + body)
  - `components/indicator-list.tsx` (list + rows)
  - `components/indicator-row.tsx` (name, description, updatedAt)
  - `components/indicator-create-menu.tsx` (optional)
  - `components/indicator-empty-state.tsx`

### indicator-dropdown component (sketch)
New shared component: `@/widgets/widgets/components/indicator-dropdown`.
- API (example):
```ts
type IndicatorDropdownProps = {
  workspaceId?: string | null
  value?: string[] // selected indicator ids
  onChange?: (ids: string[]) => void
  disabled?: boolean
  placeholder?: string
}
```
- Loads from `useCustomIndicatorsStore` (or triggers load if missing).
- Supports multi-select add/remove to update `params.chart.indicatorIds`.


## Decisions
- Provider credentials are edited via a gear icon in the widget header and stored in `params.providerParams`.
- Live streaming is supported when the provider advertises `availability.live`.
- Default window is 500 bars; range presets map to interval pairs (TradingView-style), both persisted in params.
- Indicators and chart styles are persisted in `params.chart`.
- Target KLineCharts v10 (verify axis-type API and update style application accordingly).
