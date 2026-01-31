# Stage 2: Build new_indicators + new_editor_indicator (v0.2 internal)

## Goal
Introduce a parallel PineTS-based indicator system without touching the legacy indicators/editor. This stage delivers PineTS indicator storage, APIs, runtime normalization, and a new editor widget. At the end of this stage, PineTS indicators can be authored, verified, stored, and rendered in `new_data_chart`.

## Scope
- `apps/tradinggoose/lib/new_indicators` (PineTS runtime + normalization + compile).
- `apps/tradinggoose/widgets/widgets/new_editor_indicator` (new editor UI).
- New API routes for create/update/delete, verify, and **server execute**.
- New store + queries for PineTS indicators.
- Indicator sync integration into `new_data_chart`.
- Optional new list widget for PineTS indicators (parity with legacy).

## Non-goals
- Draw/signal APIs (Stage 3).
- Removing or modifying legacy indicator system.
- Any edits to `*/migration/*` or `*/migrations/*` files by hand.

## System standards alignment (must stay true)
- **AGENTS.md**: no manual migration edits; no legacy support; minimal, readable changes.
- **overview.md**: new widgets are parallel; no dual-run inside legacy widgets; timezone rules unchanged.
- Legacy widgets remain intact; PineTS work lives in new paths only.
- **Runtime**: PineTS execution is **server-only** (no client-side PineTS execution in widgets).

## Dependencies / sequencing
- Stage 1 (`new_data_chart`) must provide `barsMs` + `openTimeMsByIndex` for PineTS execution and offsets.
- DB migration tooling available for new table.
- PineTS (npm `pinets@^0.8.x`) and LWC (npm `lightweight-charts@^5.1.x`) are already aligned in overview.
- Licensing check for PineTS (AGPL-3.0) is required before any public release.
- A server execution route must exist for chart rendering; Stage 3 hardens sandboxing.

## References (verified, read-only)
### Legacy indicators/editor (parity only; do not edit)
- `apps/tradinggoose/lib/indicators/**`
- `apps/tradinggoose/widgets/widgets/editor_indicator/**`
- `apps/tradinggoose/widgets/widgets/list_indicator/**`
- `apps/tradinggoose/widgets/widgets/components/indicator-dropdown.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/components/chart-controls.tsx`
- `apps/tradinggoose/widgets/widgets/data_chart/utils.ts`

### Legacy APIs/stores/hooks (shape only; do not edit)
- `apps/tradinggoose/app/api/indicators/custom/route.ts`
- `apps/tradinggoose/app/api/indicators/verify/route.ts`
- `apps/tradinggoose/app/api/function/execute/route.ts` (VM/E2B sandbox patterns)
- `apps/tradinggoose/lib/execution/constants.ts` (execution timeouts)
- `apps/tradinggoose/stores/custom-indicators/types.ts`
- `apps/tradinggoose/stores/custom-indicators/store.ts`
- `apps/tradinggoose/hooks/queries/custom-indicators.ts`
- `apps/tradinggoose/stores/index.ts`

### Widget events/selection (pattern only; do not edit unless required)
- `apps/tradinggoose/widgets/events.ts`
- `apps/tradinggoose/widgets/utils/indicator-selection.ts`
- `apps/tradinggoose/widgets/utils/indicator-editor-actions.ts`
- `apps/tradinggoose/widgets/registry.tsx`

### New chart indicator sync reference (pattern only)
- `apps/tradinggoose/widgets/widgets/data_chart/components/body/use-indicator-sync.ts`

### DB schema patterns (reference only)
- `packages/db/schema.ts` (custom_indicators, custom_tools patterns)

### PineTS runtime references (reference-only; do **not** import from `../PineTS` in app code)
- `../PineTS/src/PineTS.class.ts` (custom data input shape)
- `../PineTS/src/transpiler/index.ts` (JS/function handling)
- `../PineTS/src/namespaces/Plots.ts` (plot output shapes/styles)
- `../PineTS/src/namespaces/input/utils.ts` (input resolution via context.inputs)
- `../PineTS/src/namespaces/request/methods/security.ts` (multi-timeframe behavior)

### LWC marker references (reference-only; use npm `lightweight-charts`)
- `../lightweight-charts/src/plugins/series-markers/types.ts`
- `../lightweight-charts/src/api/ichart-api.ts` (addPane API)
- `../lightweight-charts/src/api/chart-api.ts` (addPane implementation)
- `../openalgo-chart/src/components/Chart/ChartComponent.jsx`
- `../openalgo-chart/src/components/Chart/utils/indicatorCreators.js` (pane usage)

### Mock data for verify
- `apps/tradinggoose/lib/market/mock-series.ts`

---

## Data contracts & runtime assumptions (explicit)
1. **PineTS expects bars with openTime + closeTime in epoch ms.**
   - Source data comes from Stage 1 `barsMs` list (ms timeline).
   - If closeTime is missing, derive from next bar openTime or intervalMs.

2. **PineTS output structure (from Plots.ts)**
   - `ctx.plots[title] = { title, options, data: [{ time, value, options? }] }`.
   - `plotshape` => `options.style = 'shape'`, per-point `shape`, `location`, `text`, `textcolor`.
   - `plotarrow` => `options.style = 'shape'`, per-point `shape: 'arrowup'|'arrowdown'`.
   - `plotchar` => `options.style = 'char'`, per-point text is not emitted.
     - **Marker text fallback policy:** use `plot.options.text` if present; else use `plot.title` (or a single-character fallback like `•`) to avoid blank markers.
   - `plotbar` / `plotcandle` => `options.style = 'bar'|'candle'`, value is `[open, high, low, close]`.
   - `bgcolor`, `barcolor`, `fill` => styles `background`, `barcolor`, `fill` (deferred in v0.2).

3. **Inputs**
   - `pine.input.*` resolves from `context.inputs[title]` if present; otherwise `defval`.
   - v0.2 uses explicit `inputMeta` from the editor (no auto-capture).

4. **LWC markers**
   - Shapes: `circle | square | arrowUp | arrowDown`.
   - Positions: `aboveBar | belowBar | inBar | atPriceTop | atPriceBottom | atPriceMiddle`.
   - Markers require `time` in seconds; convert from ms.
   - **Offset source:** offsets may be per-point; use `data[i].options.offset` when present, else fallback to plot-level `options.offset`.

---

## Risk resolution (decisions + mitigations)
1. **Sandboxing user code in verify (PineTS transpiler uses `new Function`).**
   - **Decision (v0.2):** reuse the legacy **VM sandbox** pattern for *execution* (`app/api/indicators/verify/route.ts`), but acknowledge that PineTS transpilation still uses `new Function` in the host process. Verification remains **internal-only** + gated by auth/write permissions.
   - **Mitigation:**
     - Add a hard execution timeout using `Promise.race` (align with `lib/execution/constants.ts`; choose a shorter limit for verify, e.g. 3–10s).
     - Run in Node runtime only (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`).
     - Execute the **user function** inside a `vm` context (Script + createContext) similar to `executeIndicatorInVm`.
     - Do not expose `fetch`, `process`, or `require` in the execution sandbox; provide only `Math`, `Date`, `console`, and PineTS classes (pattern from `app/api/indicators/verify/route.ts`).
     - Cap mock bars (use `generateMockMarketSeries()` at 500 bars) to limit runtime cost.
   - **Limitation:** VM isolation does **not** wrap PineTS transpilation; treat v0.2 verify as *best-effort* isolation only.
   - **Future (public):** move PineTS verify to a dedicated sandbox path similar to `app/api/function/execute/route.ts` (E2B) once PineTS is packaged for that runtime.

2. **Input metadata capture is not automatic in PineTS.**
   - **Decision (v0.2):** implement a minimal **Input panel** in `new_editor_indicator` to define inputs + defaults explicitly.
   - **Mitigation:**
     - Store `inputMeta` in the new table.
     - Build `inputsMap` from `inputMeta` values (fall back to `defval`).
     - Runtime uses `context.inputs[title]` as per `PineTS/src/namespaces/input/utils.ts`.
   - **Deferred:** auto-capture inputs by instrumenting `pine.input.*` is optional for Stage 3+.

3. **`request.security` on array sources is unsupported.**
   - **Decision (v0.2):** explicitly **block** multi-timeframe usage rather than produce incorrect results.
   - **Mitigation:**
     - Pre-scan `pineCode` for `request.security` or `request.security_lower_tf`.
    - On verify: return `unsupported.features = ['request.security', 'request.security_lower_tf']` and error code `unsupported_feature` (see 2.3).
     - On runtime: surface warning and skip execution (no partial rendering).

4. **LWC pane API contract (addPane/removePane).**
   - **Decision:** use LWC v5.1 `chart.addPane(preserveEmptyPane?: boolean)`; do **not** pass `{ height }` (openalgo sample is not the LWC signature).
   - After creation: set height via `pane.setHeight(DEFAULT_PANE_HEIGHT_PX)` (start with 100px unless a plot requests something else).
   - **Removal:** call `chart.removePane(pane.paneIndex())` at cleanup time; indices can shift after other removals.
   - **Mitigation:** add runtime guard:
     - If `typeof chart.addPane !== 'function'`, log warning and force all plots to overlay.

5. **Marker volume/perf.**
   - **Decision:** impose a hard **global per-render** marker cap (use the shared name `MAX_MARKERS_TOTAL`).
   - **Mitigation:**
     - Add `MAX_MARKERS_TOTAL` (e.g., 2000) in the new indicator sync hook.
     - Sort + slice markers; return warning with truncated count.
     - Update **per series** via `createSeriesMarkers` (per‑pane strategy).

6. **Selection event cross-talk (legacy list emits unscoped events).**
   - **Decision (v0.2):** PineTS widgets only emit/consume **scoped** selection events.
   - **Mitigation:**
     - Implement a PineTS-specific selection helper that ignores events missing `widgetKey`.
     - Ensure `list_indicator_new` emits **only** scoped events (no legacy-style double emit).

7. **Pair-color cross-talk (shared PairColorContext).**
   - **Decision (v0.2):** namespace PineTS pairing state under `pineIndicatorId`.
   - **Mitigation:** PineTS widgets read/write only `pineIndicatorId`; legacy widgets keep using `indicatorId`.

---

## Detailed implementation steps (maximum detail)

### 0) Decisions to lock early
0.1 API route naming (must be consistent across API + hooks).
- Recommendation: keep a dedicated `new_indicators` namespace to avoid legacy overlap:
  - `/api/new_indicators/custom`
  - `/api/new_indicators/verify`
- **Do not** use `/api/indicators/new_custom`; that prefix is legacy-only.
- **Source of truth (App Router):** implement under `apps/tradinggoose/app/api/new_indicators/*` and expose the HTTP endpoints at `/api/new_indicators/*`.

0.2 Pane strategy for non-overlay plots in LWC.
- Recommendation: create one pane per indicator (all non-overlay plots for that indicator share a pane).
- Pane creation: `const pane = chart.addPane()` (no options) and `pane.setHeight(DEFAULT_PANE_HEIGHT_PX)`; do not pass `{ height }`.

0.3 Input metadata.
- v0.2: **explicit input panel** in the editor (store `inputMeta` + optional `value`).
- Stage 3+ could instrument PineTS inputs for auto-capture if needed.

0.4 Verify sandbox + timeouts.
- v0.2: internal-only, auth + write permission required.
- Add explicit execution timeout (shorter than `DEFAULT_EXECUTION_TIMEOUT_MS`).
- Do not expose network/process APIs in the runtime context.

0.5 request.security support.
- v0.2: unsupported; reject usage on verify/runtime (`request.security` and `request.security_lower_tf`).

0.6 Marker cap.
- v0.2: enforce `MAX_MARKERS_TOTAL` (global per-render total across all panes/series) to prevent UI stalls.

0.7 New indicator params key (avoid legacy semantics).
- **Decision:** use **`view.pineIndicators`** as the PineTS-specific param key (locked to Stage 1).
- **Reason:** legacy `view.indicators` uses `DataChartIndicatorRef` and is wired to `IndicatorDropdown` + legacy store/buildIndicatorRefs.
- **Rule:** `new_data_chart` must ignore `view.indicators` entirely.

0.8 Selection events must be PineTS-scoped only (avoid cross-talk with legacy).
- **Decision:** PineTS widgets must **not** emit or consume unscoped indicator selection events.
- **Reason:** legacy `list_indicator` emits both scoped and unscoped events, and `useIndicatorSelectionPersistence` accepts unscoped events, which would select PineTS IDs inside legacy editor/widgets.
- **Rule:** use a PineTS-specific selection helper that **ignores** events missing `widgetKey` and only emits scoped events.

0.9 Pair-color context must be namespaced for PineTS.
- **Decision:** add `pineIndicatorId` to `PairColorContext` and use it for PineTS widgets.
- **Reason:** reusing `pairContext.indicatorId` would cross-link PineTS and legacy widgets sharing a color pair.
- **Rule:** PineTS widgets **never** read/write `indicatorId`; they read/write `pineIndicatorId` only.

0.10 PineTS widget param key for selection.
- **Decision:** store PineTS widget selection in `params.pineIndicatorId` (camelCase) instead of `params.indicatorId`.
- **Reason:** `indicatorId` is already consumed by legacy list/editor flows; reusing it would reintroduce cross-talk. Keep naming aligned with `PairColorContext.pineIndicatorId`.

---

### 1) New indicators storage (parallel)
1.1 Decide table name and schema (new table to avoid touching legacy data).
- **Decision:** table name is `pine_indicators` (locked; use consistently across schema/API/hooks).
- Fields (align with `custom_indicators` patterns in `packages/db/schema.ts`):
  - `id`: uuid primary key, default random.
  - `workspaceId`: text, FK to workspace.
  - `userId`: text, nullable, FK to user (on delete set null).
  - `name`: text, default `New Indicator`.
  - `color`: text, default `#3972F6` (or keep null and resolve in operations).
  - `pineCode`: text, default `''`.
  - `inputMeta`: json, nullable (store `{ [title]: { defval, minval, maxval, step, options, type, title } }`).
    - **Uniqueness rule:** titles are keys; editor must enforce unique, trimmed titles to prevent collisions (see 5.5).
    - Include optional `value` to persist user-selected inputs.
  - `createdAt`, `updatedAt`: timestamps, default now.
- Index: `workspaceIdIdx` like `custom_indicators`.

1.2 Update `packages/db/schema.ts` to include the new table.
- Generate migration via tooling (do not hand-edit migrations).
- Verify migration does not touch legacy tables.

---

### 2) New API routes (parallel)
2.1 Create `apps/tradinggoose/app/api/new_indicators/custom/route.ts`.
- Mirror legacy auth + permission checks (`checkHybridAuth`, `getUserEntityPermissions`).
- Support both `workspaceId` and `workflowId` (match legacy GET behavior).
- **Legacy parity:** for GET, if `authType === 'internal_jwt'` **and** `workflowId` is present, bypass workspace permission checks (see `app/api/indicators/custom/route.ts`).
- GET: return all PineTS indicators for workspace.
- POST: upsert indicators into new table only.
- DELETE: delete by `id` and `workspaceId`.
- Endpoint path: `/api/new_indicators/custom` (served by `app/api/new_indicators/custom/route.ts`).

Example Zod schema (align to legacy shape):
```ts
const PineIndicatorSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  indicators: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1, 'Indicator name is required'),
      color: z.string().optional(),
      pineCode: z.string().default(''),
      inputMeta: z.record(z.any()).optional(),
    })
  ),
})
```

2.2 Create `apps/tradinggoose/app/api/new_indicators/verify/route.ts`.
- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` (match legacy verify).
- Set `maxDuration` (short, e.g., 30s) to align with execution timeouts.
- Validate `workspaceId` and `pineCode` + optional `inputs` map.
- Use `generateMockMarketSeries()` and map to PineTS bars (openTime/closeTime in ms).
- Execute the **user function** inside a Node `vm` context (mirror `executeIndicatorInVm` from legacy verify).
- Note: PineTS transpilation still uses `new Function` in the host process (see risk section).
- Run `normalizeIndicatorCode` -> `runPineTS` -> `normalizeContext`.
- Return counts: `plotsCount`, `markersCount`, `drawingsCount`, `signalsCount`.
- Return `unsupported` lists: `plots`, `styles`.
- Provide warnings (ex: all plots null, unsupported styles, char without text).
- Enforce execution timeout + bar cap (see risk resolution).
- Pre-scan and reject `request.security` **and** `request.security_lower_tf` usage (see risk resolution).
- Endpoint path: `/api/new_indicators/verify` (served by `app/api/new_indicators/verify/route.ts`).

2.3 Error handling and codes (align with legacy verify patterns).
- `empty_code`, `ts_error`, `runtime_error`.
- Include best-effort line/column parsing if transpile errors include locations.
- Do not expose full stack traces to clients by default (log server-side).
- Add `unsupported_feature` for blocked APIs (e.g., `request.security`, `request.security_lower_tf`).
- Error message may reference the **first** detected feature; the `unsupported.features` array is authoritative when multiple features are blocked.
- Response shape (success false):
```json
{ "success": false, "error": "request.security is not supported", "code": "unsupported_feature", "unsupported": { "features": ["request.security", "request.security_lower_tf"] } }
```

2.4 Create `apps/tradinggoose/app/api/new_indicators/execute/route.ts` (server-only runtime).
- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
- Auth/permissions mirror `new_indicators/custom` and `new_indicators/verify`.
- Input payload (suggested):
  - `workspaceId`, `indicatorIds[]` (server fetches code by id).
  - `barsMs` (array of `{ openTime, closeTime, open, high, low, close, volume? }`).
  - **Optional:** `openTimeMsByIndex` and `indexByOpenTimeMs` if client wants to avoid recompute.
    - `openTimeMsByIndex`: `number[]` (index → openTimeMs).
    - `indexByOpenTimeMs`: JSON-safe shape only — either `Record<string, number>` (openTimeMs → index) **or** `Array<[number, number]>` pairs. Do **not** send a `Map` (JSON drops entries).
    - If omitted, server **must recompute using the exact same dedupe/sort/indexing logic as Stage 1 `buildIndexMaps(barsMs)`** (sort ascending by `openTime`, dedupe by `openTime`).
    - Prefer extracting the Stage 1 `buildIndexMaps` logic into a shared util (or copy it verbatim) to avoid drift.
  - `inputsMapById?: Record<indicatorId, Record<title, value>>`.
  - `listingKey`, `interval`, `intervalMs`.
- Output payload:
  - Per indicator: `{ output, warnings, unsupported, executionError?, counts }`.
  - `output` aligns with `normalizeContext` result (series + markers; Stage 3 adds drawings/signals).
- Enforce payload limits (bar count + body size) and return a user-facing warning if capped.
- **No client execution**: all PineTS runs in this route.
- v0.2 uses the same VM allowlist as verify; Stage 3 upgrades the sandbox strategy.
- Reject `request.security` and `request.security_lower_tf` during execute the same way as verify (pre-scan + `unsupported_feature` response).
- Endpoint path: `/api/new_indicators/execute` (served by `app/api/new_indicators/execute/route.ts`).

---

### 3) New library: `apps/tradinggoose/lib/new_indicators`
3.0 **PineTS import source (hard rule)**
- Import PineTS classes from the npm package only: `import { PineTS, Indicator } from 'pinets'`.
- Do **not** import from `../PineTS` or any local workspace path; local repo is reference-only.
3.1 `types.ts` (core types shared by runtime + UI).
- Pine plot/marker types (mirrors PineTS output shape).
- `InputMeta` shape (title, defval, minval, maxval, step, options, type, value?).
- Add `InputMetaMap = Record<title, InputMeta>`; titles are unique keys after editor validation.
- `NormalizedPineOutput` shape:
  - `series: Array<{ plot, points: Array<{ time: number; value: number | null; color?: string }> }>`
  - **LWC mapping rule:** when building series data, convert `value: null` to `WhitespaceData` (`{ time }`) so line/area/histogram charts keep gaps without invalid values.
  - `markers: Array<{ time: number; position: SeriesMarkerPosition; shape: SeriesMarkerShape; color?: string; text?: string; price?: number }>`
  - `drawings: []` (reserved for Stage 3)
  - `signals: []` (reserved for Stage 3)
  - `unsupported: { plots: string[]; styles: string[] }`

3.2 `normalize-indicator-code.ts`.
- Detect function expressions (reuse logic from legacy `looksLikeFunctionExpression`).
- If not a function, wrap in `(context) => { ... }`.
- Transpile TypeScript (mirror legacy `transpileTypeScript` in `lib/indicators/custom/compile.ts`).
- Return `{ code, error?, transpiledCode? }` for error reporting.

3.3 `run-pinets.ts`.
- Accept `barsMs`, `inputsMap`, `listingKey`, `interval`.
- Create PineTS with custom data array:
  - Each bar: `{ open, high, low, close, volume?, openTime, closeTime }`.
- `await pine.ready()` then `pine.run(new Indicator(fn, inputsMap))`.
- Return PineTS context + optional transpiled code.

3.4 `normalize-context.ts`.
- Split PineTS plots into `series` and `markers`.
- Overlay rule: `plot.options.overlay ?? plot.options.force_overlay ?? ctx.indicator?.overlay`.
- Style mapping (LWC):
  - `style_histogram` / `style_columns` => Histogram series.
  - `style_area` / `style_areabr` => Area series.
  - `style_line` / `style_linebr` => Line series.
  - `style_stepline*` => Line series with step option (if supported) else warn.
  - `style_circles` => Line series + per-point marker fallback (warn).
  - `style_cross` => fallback to circles + warning.
  - `bar` / `candle` (from `plotbar` / `plotcandle`) => optional v0.2 (if not supported, mark unsupported).
  - `style_bar` / `style_candle` are **not** emitted by PineTS v0.8.4 for plotbar/plotcandle; treat them as unsupported if encountered.
  - `background`, `barcolor`, `fill` => unsupported (warn + report).
- Marker extraction:
  - `plot.options.style === 'shape'` => markers from per-point options.
  - `plot.options.style === 'char'` => emit markers using the **text fallback policy** (options.text → plot.title → `•`) and a default shape (e.g., `circle`).
  - **Limitation:** PineTS v0.8.4 `plotchar` does **not** persist per-point text options, so user-provided text will not be available. If custom text is required, instruct authors to use `plotshape` with `text` instead.
  - Map Pine shapes: `arrowup` -> `arrowUp`, `arrowdown` -> `arrowDown`, `circle` -> `circle`, `square` -> `square`.
- Map Pine locations: `abovebar` -> `aboveBar`, `belowbar` -> `belowBar`, `absolute` -> `atPriceMiddle`.
  - **Price required:** when mapping to any `atPrice*` position, set `marker.price` from the per-point numeric `value` (skip marker if value is not a finite number).
- **Offset handling:** PineTS emits `offset` per-point in `data[i].options.offset` (see `PineTS/src/namespaces/Plots.ts`). Use **per-point offset first**, and fall back to `plot.options.offset` only when point options are missing.
- Convert times: ms -> seconds for LWC markers/series.
- Cap markers per render in the sync hook (not in normalize step).
- **Index maps source:** `openTimeMsByIndex` is computed in the server execution route from `barsMs` unless provided by the client.
  - **Must match Stage 1:** server recompute logic must mirror `buildIndexMaps(barsMs)` (sort + dedupe by `openTime`).

3.5 `custom/compile.ts`.
- Accept `{ pineCode, barsMs, inputsMap, listingKey, interval }`.
- Run normalization + PineTS execution + context normalization.
- Return `{ output, warnings, unsupported, transpiledCode, executionError }`.
- If unsupported features detected (e.g., `request.security` or `request.security_lower_tf`), return an error payload and skip execution.
- **Server-only**: this module is used by API routes; do not import into client widgets.

3.6 `custom/operations.ts`.
- Upsert/delete/read on new table only.
- Mirror legacy `resolveIndicatorColor` + `getRandomVibrantColor`.
- Return ordered indicators (desc createdAt).

3.7 `default/index.ts` (optional).
- Register a small set of default PineTS indicators if desired.

---

### 4) New store + queries
4.1 Create `apps/tradinggoose/stores/new-indicators/types.ts`.
- `NewIndicatorDefinition` fields: `id`, `workspaceId`, `userId`, `name`, `color`, `pineCode`, `inputMeta`, `createdAt`, `updatedAt`.

4.2 Create `apps/tradinggoose/stores/new-indicators/store.ts`.
- Mirror custom indicators store API: `setIndicators`, `getIndicator`, `getAllIndicators`, `resetWorkspace`, `resetAll`.

4.3 Register store in `apps/tradinggoose/stores/index.ts`.
- Export new store.
- Include in `resetAllStores` and `logAllStores`.

4.4 Create `apps/tradinggoose/hooks/queries/new-indicators.ts`.
- Mirror legacy query patterns:
  - `useNewIndicators(workspaceId)`.
  - `useCreateNewIndicator()`.
  - `useUpdateNewIndicator()`.
  - `useDeleteNewIndicator()`.
- Normalize API response into `NewIndicatorDefinition`.
- Keep endpoint constant aligned with API route (e.g. `/api/new_indicators/custom`).

4.5 Optional: `useVerifyNewIndicator()` helper for editor.
- POST to `/api/new_indicators/verify` with `{ workspaceId, pineCode, inputs }`.

---

### 5) New editor widget: `new_editor_indicator`
5.1 Create widget structure:
- `apps/tradinggoose/widgets/widgets/new_editor_indicator/index.tsx`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator/editor-indicator-body.tsx`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator/components/*`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator/utils.ts` (PineTS param helpers)

5.2 Register the widget in `apps/tradinggoose/widgets/registry.tsx`.
- Add key `new_editor_indicator` under the `editor` category.
- Keep legacy widgets unchanged.

5.3 Header + selection behavior (mirror legacy patterns).
- Use `useIndicatorEditorActions` for save/verify.
- New selector component uses new indicator list (do not reuse legacy list/dropdown directly).
- **Do not** reuse legacy `editor_indicator` components or `IndicatorDropdown` without a PineTS‑specific mode flag; they are tightly coupled to custom indicators.
- **Do not** use `useIndicatorSelectionPersistence`; it accepts unscoped events from legacy widgets.
- Implement a PineTS-specific selection helper in `apps/tradinggoose/widgets/utils/new-indicator-selection.ts`:
  - `useNewIndicatorSelectionPersistence` listens to `INDICATOR_WIDGET_SELECT_EVENT` and **ignores events without `widgetKey`**.
  - `emitNewIndicatorSelectionChange` always includes `widgetKey`.
  - This isolates PineTS selection without changing legacy behavior.
- **Pair-color linking (parity with legacy, namespaced):**
  - Extend `PairColorContext` with `pineIndicatorId` (do **not** reuse `indicatorId`).
  - If `pairColor !== 'gray'`, derive selected indicator from `pairContext.pineIndicatorId` and update it on selection.
  - Only persist to widget params (`params.pineIndicatorId`) when **not** linked to a color pair.
- **Param helper (required):**
  - Add `getPineIndicatorIdFromParams(params)` (analogous to legacy `getIndicatorIdFromParams`) in `new_editor_indicator/utils.ts`.
  - This helper must **only** read `params.pineIndicatorId` and never fall back to `params.indicatorId`.
- Scope selection to widget key `new_editor_indicator` and emit **only scoped** events.

5.4 Editor prompt + typings (PineTS JS context).
- Suggested prompt:
  - `const { data, pine } = context;`
  - `const { ta, input, plot, plotshape, plotchar, plotarrow, hline, fill } = pine;`
  - Stage 3: `const { draw, signal } = context;` (no global `draw`/`signal`).
  - No `return { plots, signals }` (PineTS uses plot calls).
  - Emphasize time-series logic and no future bars.

5.5 Inputs panel (v0.2 explicit).
- Minimal UI for defining inputs (`title`, `type`, `defval`, `min`, `max`, `step`, `options`, `value`).
- **Collision guard (required):**
  - Enforce unique, trimmed titles in the editor UI (case-insensitive check).
  - If duplicates are entered, auto-suffix (`Title`, `Title (2)`) **or** block save with a clear error.
  - On load, if stored metadata has collisions, resolve deterministically (last-wins) and surface a warning.
- Persist to `inputMeta` and use to build `inputsMap` keyed by **unique** titles.

5.6 Verify integration.
- Call `/api/new_indicators/verify`.
- Surface warnings and unsupported style info.
- Ensure verify errors include a consistent shape that the editor can render (see 2.3 + request.security block).

5.7 Save integration.
- Update via `useUpdateNewIndicator` mutation (pineCode + inputMeta).

---

### 6) Optional: New list widget for PineTS indicators
6.1 Create `list_indicator_new` (or `list_pine_indicator`) widget for parity.
- Mirror `apps/tradinggoose/widgets/widgets/list_indicator` structure.
- Create indicator using `useCreateNewIndicator`.
- **Pair-color linking (parity with legacy list):**
  - Wire `pairColor` selection using `usePairColorContext`/`useSetPairColorContext` (see `indicator-list.tsx`).
  - If linked to a color pair, selection changes update `pairContext.pineIndicatorId`, not `indicatorId`.
  - Keep legacy `indicatorId` untouched to avoid cross-talk.
- If **not** linked to a color pair, persist selection to `params.pineIndicatorId`.
- **Do not** mirror legacy double‑emit behavior (`list_indicator` emits both scoped and unscoped events).
- Emit **only** scoped selection events using `emitNewIndicatorSelectionChange` (`widgetKey: 'new_editor_indicator'`) so legacy editors/widgets never receive PineTS IDs.
6.2 Register the list widget in `apps/tradinggoose/widgets/registry.tsx` (category: `list`).

---

### 7) Connect new indicators to `new_data_chart`
7.0 Params + selection (critical to avoid mixing legacy semantics).
- Update `apps/tradinggoose/widgets/widgets/new_data_chart/types.ts` to **not** alias `DataChartWidgetParams` directly.
- Define a PineTS-specific view shape:
  - `view.pineIndicators?: NewIndicatorRef[]` (locked; do not use `view.newIndicators`).
  - `NewIndicatorRef` includes `{ id: string }` plus any future flags.
- Add helper utils under `apps/tradinggoose/widgets/widgets/new_data_chart/utils.ts`:
  - `buildPineIndicatorRefs(ids: string[]): NewIndicatorRef[]`.
  - `resolvePineIndicatorIds(view)` to keep param parsing centralized.
- **Do not** use `buildIndicatorRefs` or `DataChartIndicatorRef` from legacy chart utils.

7.0.1 Dropdown wiring.
- Create a **new** `new_indicator-dropdown` component for PineTS indicators (do not reuse `IndicatorDropdown`).
- New dropdown uses `useNewIndicators` + `useNewIndicatorsStore`.
- Selection writes to `view.pineIndicators` only.
- Scope selection to `new_data_chart` widget key to avoid cross-talk.

7.1 Add a new indicator sync hook under `new_data_chart` (server execution).
- Suggested file: `apps/tradinggoose/widgets/widgets/new_data_chart/components/body/use-new-indicator-sync.ts`.
- Inputs: `chartRef`, `mainSeriesRef`, `dataContext`, `indicatorRefs`, `indicators`.
- `dataContext` **must** match the Stage‑1 handoff contract (`NewDataChartDataContext`):
  - `barsMsRef`
  - `indexByOpenTimeMsRef`
  - `openTimeMsByIndexRef`
  - `intervalMs`
  - `dataVersion`

7.2 Execution pipeline per update (server-only).
- Build request payload for `/api/new_indicators/execute`:
  - `workspaceId`, `indicatorIds`, `barsMs`, `inputsMapById`, `listingKey`, `interval`, `intervalMs`.
  - Optional `openTimeMsByIndex`/`indexByOpenTimeMs` if you want to avoid server recompute.
- Call server route, then:
  - Apply returned `output` to series/markers.
  - Surface `warnings` and `unsupported` per indicator.
  - Handle `executionError` without crashing the chart.
- Do **not** run PineTS or `new Function` in the browser.

7.3 Series creation and updates (render-only).
- Maintain maps:
  - `indicatorSeriesMap`: `{ [indicatorId]: { [plotTitle]: series } }`.
  - `indicatorPaneMap`: `{ [indicatorId]: pane | null }`.
  - **Add:** `indicatorPaneSeriesMap`: `{ [indicatorId]: ISeriesApi | null }` (canonical series used for pane‑level drawings).
- **Pane contract for drawings (Stage 3):** `pane: 'indicator'` resolves via `indicatorPaneSeriesMap[indicatorId]` (series), not the pane itself; there is no external pane id string.
- Guard: if `chart.addPane` is unavailable, log warning and force overlay behavior.
- For overlay plots: create series on main chart.
- For non-overlay plots: create/ensure per-indicator pane and add series there.
  - Create via `const pane = chart.addPane()` (no options).
  - Apply `pane.setHeight(DEFAULT_PANE_HEIGHT_PX)` (start with 100px) so height hints are honored.
  - **Do not** copy `chart.addPane({ height })` from openalgo; that is not the LWC v5.1 signature.
  - **Canonical series rule:** set `indicatorPaneSeriesMap[indicatorId]` to the **first series created in that pane** (or to a dedicated hidden line series if you prefer a stable target).
- For each plot: map points to LWC series data:
  - If `value` is a number → `{ time, value }`.
  - If `value` is `null` → `{ time }` (WhitespaceData) to preserve gaps.

7.4 Marker handling (LWC v5).
- **Decision:** markers attach to the **series in the same pane** as their indicator (non-overlay), not always the main series.
- Maintain a `seriesMarkersMap` keyed by series (e.g., `Map<ISeriesApi, SeriesMarkersPrimitive>`).
- Build marker groups per target series:
  - Overlay indicators → attach markers to `mainSeries`.
  - Non-overlay indicators → attach markers to that indicator’s **pane anchor series**.
    - Anchor series = first numeric plot series created for that indicator pane.
    - If an indicator has only shape/char markers and no numeric series, create a hidden line series in the pane to host markers.
      - **Important:** populate the anchor series with **whitespace data for every bar** (`{ time }` items aligned to `openTimeMsByIndex` **converted to seconds**) so the markers plugin can resolve `dataByIndex(...)` and render markers in that pane.
- For each target series: `createSeriesMarkers(series, markers)` and `setMarkers(markers)`.
- Apply `MAX_MARKERS_TOTAL` (global per-render total) before grouping (truncate with warning); optionally cap per-series if needed.

7.5 Cleanup.
- On indicator removal: remove series, panes, and cached markers.
  - Remove series via `chart.removeSeries(series)` (LWC pane API does not expose `removeSeries`).
  - Remove marker primitives for those series (`seriesMarkersMap.delete(series)` and detach if needed).
  - Remove panes using `chart.removePane(pane.paneIndex())`; compute index at removal time because indices shift.
  - Guard against removing the main pane (index 0) and against `paneIndex()` returning invalid values.
- Reset marker primitives when indicator set changes.

7.6 Performance safeguards.
- Debounce **network** execution to avoid repeated runs on rapid changes.
- Cache results by `{ indicatorId, dataVersion, inputsHash }` to skip redundant requests.
- Cap markers if counts are extreme (warn + truncate) using `MAX_MARKERS_TOTAL`.
- Enforce a max bar window in requests (warn if truncated).

---

### 8) Acceptance + validation
- Manual:
  - Create/save PineTS indicator from new editor.
  - Verify returns counts + warnings.
  - Render indicator in `new_data_chart` with correct overlay behavior.
  - Unsupported styles produce warnings but do not crash.
- Cross-verify parity:
  - Compare plot counts and overlay behavior with PineTS output structure.

### 9) Testing plan
- Unit tests:
  - `normalizeIndicatorCode` (function wrapping + TS transpile errors).
  - `normalizeContext` (style mapping, marker mapping, offset shifting).
- Integration tests:
  - API verify endpoint with mock data.
  - New editor create/verify/save flow.

### 10) Rollout + backout
- Keep legacy widgets as default; new widgets opt-in only.
- Backout: remove new widgets from registry and disable new API routes; data remains in new table for later.

---

## Residual risks (post-mitigation)
- PineTS verification uses local VM sandbox (legacy pattern) but PineTS transpiler still relies on `new Function`; public rollout requires E2B or equivalent sandbox packaging.
- `request.security` detection uses static pre-scan (possible false positives/negatives). Consider AST-based detection later.
- Marker truncation may hide signals in extreme cases; surface counts in UI warnings.
