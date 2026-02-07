# Stage 3: signal.* API + Marker Rendering + Alert Hooks

## Goal
Enable PineTS indicators to emit signals via `signal.*`, normalize them on the server, and render LWC markers per indicator pane. Add caps, visible‑range filtering, and telemetry.

## Scope
- Add a signal recorder in `apps/tradinggoose/lib/new_indicators`.
- Inject `signal` as a **global** in user code.
- Normalize signals server-side (time/index resolution + edge/cooldown).
- Render signal markers client-side (after `applyIndicatorLimits`).
- Add alert/automation callback surface (no full alertcondition reimplementation).

## Non-goals
- No TradingView-style alertcondition engine.
- No signal persistence.
- No legacy widget changes.
- No migrations.
- No `server-only` package usage.
- Do **not** inject or generate any `const { ... } = $.pine` or `const { ... } = $.data` code.

## API shape (locked)
### signal API
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

### Helpers
- `signal.buy({...})` defaults: `shape: 'arrowUp'`, `position: 'belowBar'`.
- `signal.sell({...})` defaults: `shape: 'arrowDown'`, `position: 'aboveBar'`.
- `signal.value({...})` defaults: `shape: 'circle'`, `position: 'inBar'`.

## Affected files/areas
- `apps/tradinggoose/lib/new_indicators/signal.ts` (new)
- `apps/tradinggoose/lib/new_indicators/types.ts`
- `apps/tradinggoose/lib/new_indicators/normalize-signals.ts` (new)
- `apps/tradinggoose/lib/new_indicators/normalize-indicator-code.ts`
- `apps/tradinggoose/lib/new_indicators/custom/compile.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/use-new-indicator-sync.ts`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator/components/pine-indicator-code-panel.tsx`
- `scripts/generate-pine-cheat-sheet.cjs` (for typings update)

## Detailed steps
1. **Signal recorder**
   - Add `createSignalRecorder()` with:
     - `emit(event)`
     - helpers: `buy`, `sell`, `value`
     - `clear()`
     - `getEvents()`
   - Track per‑indicator `lastActiveById` and `lastFiredIndexById` for edge/cooldown handling.

2. **Expose signal as a global (follow current pattern)**
   - Do **not** inject any preamble into user code.
   - Extend the runtime context so `signal` is available as a global the same way `input`, `ta`, and `plot` are today.
   - This should work across both Node `vm` and E2B paths.

3. **Normalize signals server-side**
   - Add `normalize-signals.ts`:
     - Resolve `barIndex` → `executionBars[barIndex].openTime` (timeMs).
     - Resolve `timeMs` directly if provided.
     - If neither is valid, drop the signal and warn.
     - Apply edge/cooldown **after** index/time resolution.
     - Keep signals sorted by time.
   - Ignore `size` in v1 (product choice).

4. **Render signal markers client-side**
   - Convert `timeMs` to `time` seconds for LWC markers.
   - Validate shape/position against LWC allowed values.
   - For `atPrice*` positions, require `price`.
   - Merge signal markers with plot markers **after** `applyIndicatorLimits` (so Pine max_labels_count applies only to plot markers).
   - Attach markers to the series for the indicator’s pane:
     - overlay indicators → main series
     - non‑overlay indicators → pane anchor series

5. **Marker caps + visible-range filtering**
   - Use `MAX_MARKERS_TOTAL` global cap (per render) with warn‑once.
   - Filter to visible range first (timeScale visible range → time window via `openTimeMsByIndexRef`).
   - If still above cap, keep most recent within range and warn once.

6. **Alert/automation hooks**
   - Provide a per-indicator callback surface for normalized signals (no UI surface yet).

7. **Telemetry & guardrails**
   - Track counts: plots, markers, drawings, signals.
   - Add timing metrics: execution time (server), render time (client) where available.

## Validation
- A PineTS indicator emits signals with:
  - `edge: 'rising'` and `cooldownBars` to verify suppression.
  - `position: 'atPriceTop'` to verify price markers.
- Confirm signal markers render in the indicator pane (non‑overlay) and main series (overlay).
- Confirm plot markers remain capped by `applyIndicatorLimits` and signal markers are not.

## Risks
- Marker storms from chatty indicators; mitigated by visible‑range filtering + caps.
- Edge/cooldown logic dependent on index resolution; ensure deterministic sort.

## Rollback
- Remove signal recorder/normalizer and strip marker merge logic.
