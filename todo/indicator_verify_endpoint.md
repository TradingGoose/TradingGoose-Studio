# Indicator Verify Endpoint Plan

## Current State (Review)
- Default indicators are compiled client-side via `DEFAULT_INDICATOR_TEMPLATES` and `createDefaultIndicator`.
- `/app/api/indicators/custom/route.ts` is **CRUD only** for custom indicators; it does not compile indicators.
- Custom indicator compilation happens in the browser via `buildIndicatorTemplate` (`/lib/indicators/custom/compile.ts`).
- Default indicator output normalization already uses `/lib/indicators/shared/output.ts`.

**Conclusion:** Default indicators do **not** use `/app/api/indicators/custom/route.ts`.
Given verification no longer depends on workspace or stored indicators, the endpoint should live at:
- `/app/api/indicators/verify/route.ts`

## Goals
1. Verify indicator code with the **same logic** as actual compilation.
2. Execute with **built-in Node `vm`** (per requirement).
3. Always use realistic mock OHLCV data (~500 bars) based on `MarketSeries`.
4. Provide **actionable, structured errors and warnings** for the wand.
5. Keep logic reusable for future features/tests.

## Design Overview
### Endpoint
**Path:** `/app/api/indicators/verify/route.ts`  
**Method:** `POST`

**Request**
```ts
{
  workspaceId: string,
  code: string
}
```

**Response**
```ts
{
  success: true,
  data: {
    plotsCount: number,
    signalsCount: number,
    warnings: Array<{ code: string; message: string }>,
    outputPreview?: {
      name?: string,
      plots: { key: string; title: string; overlay: boolean }[],
      signals: { type: "buy" | "sell" }[]
    }
  }
}
```

**Error (example)**
```ts
{
  success: false,
  error: "Missing return statement (got empty plots/signals)",
  code: "invalid_output",
  debug?: { line?: number; column?: number; stack?: string }
}
```

### Permissions
- **Require authentication** (session / hybrid auth).
- **Require workspace permission** (write) before executing user code.

### Single Source of Truth (Compilation)
We should **reuse `/lib/indicators/custom/compile.ts`** for transpile + normalization rules, but swap execution to VM on the server.

**Plan:**
1. Extract minimal, reusable helpers into `lib/indicators/custom/runtime.ts`:
   - `transpileTypeScript(code) -> { code, error? }`
   - `looksLikeFunctionExpression(code)`
2. Keep normalization in `/lib/indicators/shared/output.ts` (already shared).
3. Refactor `buildIndicatorTemplate` to use the shared helpers (no behavior change).
4. Add a server-only `executeIndicatorInVm` that uses the same transpiled code and normalization pipeline.

### VM Execution Flow (Server)
- Transpile TS -> JS using the same compiler options as `compile.ts`.
- Build an execution wrapper that **mirrors client semantics**:
  - If code is a function expression, evaluate it and call with `(dataList, indicator)`.
  - Else treat as function body with `(dataList, indicator)` in scope and expect `return {...}`.
- Run it via `vm.Script` and `vm.createContext`.

## Mock Market Data (Reusable)
### Requirements
- Use `MarketSeries` + `MarketBar` from `providers/market/types.ts`.
- Always generate **500 bars**.
- Smooth price/volume changes; avoid unrealistic spikes.
- Reusable for future tests.

### Proposed Helper
**File:** `/lib/market/mock-series.ts`

```ts
export function generateMockMarketSeries(): MarketSeries
```

### Algorithm (more realistic)
- Use **log-return random walk** with small drift and volatility.
- Clamp daily return to avoid spikes (e.g., ±3%).
- Derive high/low from open/close plus a small range based on volatility.
- Volume follows price volatility (higher range => slightly higher volume).

Pseudo:
```ts
const drift = 0.0002;           // 0.02% daily
const sigma = 0.006;            // ~0.6% daily std
const maxMove = 0.03;           // 3% clamp

for each bar:
  r = clamp(drift + randn()*sigma, -maxMove, maxMove)
  open = price
  close = open * (1 + r)
  range = Math.max(Math.abs(r), 0.002) + rand()*0.002
  high = Math.max(open, close) * (1 + range)
  low = Math.min(open, close) * (1 - range)
  volume = volumeBase * (1 + Math.abs(r) * 8 + rand()*0.1)
  push MarketBar { timeStamp: ISO, open, high, low, close, volume }
  price = close
```

### Convert to KLineData for compiler
Add a small helper in the same file:
```ts
export function marketSeriesToKLineData(series: MarketSeries): KLineData[]
```
This mirrors the mapping in `use-chart-data-loader.ts`.

## Warning/Error Feedback Design
### Errors (blocking)
- `empty_code` — no code provided
- `ts_error` — TypeScript diagnostics from transpile
- `runtime_error` — VM execution error (with line/column)
- `invalid_output` — missing return / no plots or signals / wrong types

### Warnings (non-blocking)
- `all_plots_null` — plots exist but all values are null
- `all_signals_null` — signals exist but all values null
- `signals_no_overlay` — signals exist but no plot overlay (optional UI hint)
- `suspicious_lengths` — returned arrays shorter than dataList (should already normalize)

### Response Structure
- Return `warnings: [{ code, message }]`
- Return `debug` only in dev or behind a flag.

## Files To Add/Change
- **New**: `/app/api/indicators/custom/verify/route.ts`
- **New**: `/lib/market/mock-series.ts`
- **New or Update**: `/lib/indicators/custom/runtime.ts` (shared helpers for transpile + function detection)
- **Update**: `/lib/indicators/custom/compile.ts` to use shared helpers (no behavior change)

## Open Decisions
1. Whether to **require authentication** (recommended) or allow public access.
2. Whether to expose `debug` fields in prod or only in dev.
