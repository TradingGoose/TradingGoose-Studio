# Stage 2: draw.* API + Normalized Drawings + Line-Tools Rendering

## Goal
Enable PineTS indicators to call `draw.*` in user code, normalize draw instructions on the server, and render drawings via the Stage 1 line‑tools plugin adapter in `new_data_chart`.

## Scope
- Add a draw recorder in `apps/tradinggoose/lib/new_indicators`.
- Inject `draw` as a **global** in user code (same model as `input`/`ta`).
- Normalize drawings server-side into **timeMs-based** points.
- Render drawings client-side by mapping to line‑tools classes.

## Non-goals
- No signals yet (Stage 3).
- No manual drawing UI (toolbars, persistence).
- No legacy widget changes.
- No migration edits.
- No `server-only` package usage.

## Hard rules
- Use the existing authoring model: user code is an async function body, globals are used directly, and `$.pine/$.data` remain disallowed.
- Do **not** assume full chart timeline indices; normalize to **timeMs** on the server.
- Drawings are **read-only** and non‑persistent; do not merge with manual drawings.
- Do **not** inject or generate any `const { ... } = $.pine` or `const { ... } = $.data` code.

## API shape (locked)
### draw API
- `draw.tool(type, { id?, points, options?, pane?: 'price' | 'indicator', locked?, visible? })`
- Convenience wrappers:
  - `draw.trendLine`
  - `draw.ray`
  - `draw.rectangle` / `draw.rect`
  - `draw.text`
  - `draw.horizontalLine` / `draw.hLine`
  - `draw.verticalLine` / `draw.vLine`
  - `draw.circle`
  - `draw.path`
- Accept `lock` alias → normalize to `locked`.

### Draw points (input)
```ts
export type DrawPointXY = { axis: 'xy'; xType: 'bar_index' | 'time'; x: number; y: number }
export type DrawPointX = { axis: 'x'; xType: 'bar_index' | 'time'; x: number }
export type DrawPointY = { axis: 'y'; y: number }
export type DrawPoint = DrawPointXY | DrawPointX | DrawPointY
```

### Draw instruction (normalized)
```ts
export type DrawInstructionInput = {
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

export type DrawInstruction = Omit<DrawInstructionInput, 'tool'> & {
  tool: 'TrendLine' | 'HorizontalLine' | 'HorizontalRay' | 'VerticalLine' | 'Rectangle' | 'Text' | 'Circle' | 'Path'
}
```

## Affected files/areas
- `apps/tradinggoose/lib/new_indicators/draw.ts` (new)
- `apps/tradinggoose/lib/new_indicators/types.ts`
- `apps/tradinggoose/lib/new_indicators/custom/compile.ts`
- `apps/tradinggoose/lib/new_indicators/run-pinets.ts`
- `apps/tradinggoose/lib/new_indicators/normalize-drawings.ts` (new or extend `normalize-context.ts`)
- `apps/tradinggoose/widgets/widgets/new_data_chart/drawings/**`
- `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/use-new-indicator-sync.ts`
- `apps/tradinggoose/widgets/widgets/new_editor_indicator/components/pine-indicator-code-panel.tsx`
- `scripts/generate-pine-cheat-sheet.cjs` (for typings update)

## Detailed steps
1. **Draw recorder**
   - Add `createDrawRecorder()` that returns:
     - `api` (draw.* functions)
     - `clear()`
     - `getInstructions()` (deduped list)
   - Validate minimum points per tool and drop invalid points.
   - Dedupe by `id` within a run (last write wins).
   - Keep options as given; ensure `Text` uses nested `options.text` object.

2. **Expose draw as a global (follow current pattern)**
   - Do **not** inject any preamble into user code.
   - Extend the runtime context so `draw` is available as a global the same way `input`, `ta`, and `plot` are today.
   - This should work across both Node `vm` and E2B paths.

3. **Error mapping stays unchanged**
   - Because we do **not** inject extra lines, `parseExecutionError` line offsets remain unchanged.

4. **Attach draw recorder to PineTS runtime**
   - In `run-pinets.ts` or `custom/compile.ts`, attach `drawRecorder.api` to the PineTS runtime context so it is exposed as a global, and reset per run.

5. **Normalize drawings server-side**
   - Create `normalize-drawings.ts` (or extend `normalize-context.ts`) to:
     - Resolve `bar_index` → `executionBars[barIndex].openTime` (timeMs).
     - Keep `timeMs` inputs as-is.
     - Drop points that resolve to invalid timeMs.
     - Map `Ray` and `ExtendedLine` → `TrendLine` with the correct nested options.
     - Fill missing axis for one-axis tools:
       - `HorizontalLine`: fill `timestamp` with last execution bar time.
       - `VerticalLine`: fill `price` with close at time or last close.
   - Output normalized `DrawInstruction[]` on `NormalizedPineOutput.drawings`.

6. **Render drawings in new_data_chart**
   - Convert `timeMs` to LWC timestamps (`seconds`).
   - Map each `DrawInstruction.tool` to a registered line‑tools class.
   - Attach to pane series based on `pane`:
     - `'price'` → main series.
     - `'indicator'` → pane anchor series (per indicator).
   - Respect `visible` by attach/detach (do not rely on options).
   - Respect `locked` flag (indicator drawings are read-only).

## Validation
- Create a PineTS indicator using `draw.trendLine`, `draw.hLine`, and `draw.vLine`:
  - Verify placement by `bar_index` and by `timeMs`.
  - Verify indicator pane placement when `pane: 'indicator'`.
  - Verify `visible: false` hides drawings.

## Risks
- Incorrect time normalization when execution window is truncated; mitigate by always using execution bars (not full chart bars).
- Option shape mismatch with line‑tools; keep options nested and do not flatten.

## Rollback
- Remove draw recorder and normalization; keep plugin adapter unused.
- Restore `normalize-indicator-code.ts` without preamble injection.
