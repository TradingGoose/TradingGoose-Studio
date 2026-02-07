# Stage 1: Vendored Line-Tools + Plugin Adapter (new_data_chart)

## Goal
Make lightweight-charts line-tools **self-contained** in this repo and provide a stable plugin adapter inside `apps/tradinggoose/widgets/widgets/new_data_chart/` without changing runtime behavior yet.

## Scope (Stage 1 only)
- Vendor (copy) line‑tools source into this repo under:
  - `apps/tradinggoose/widgets/widgets/new_data_chart/plugins/**`
- Expose package-style entrypoints in the vendored folder so we can import by package name aliases.
- Add TypeScript path aliases in `apps/tradinggoose/tsconfig.json` that resolve `lightweight-charts-line-tools-*` to the vendored entrypoints.
- Do **not** add vendored package names to `transpilePackages` unless they are real packages with `package.json` and workspace inclusion.
- Implement a plugin adapter under `apps/tradinggoose/widgets/widgets/new_data_chart/drawings/` that:
  - Registers only the supported tool classes.
  - Creates/updates tools per target series/pane.
  - Provides attach/detach APIs for later use (Stage 2/3 will call these).
- Extend `IndicatorRuntimeEntry` to carry `paneAnchorSeries?: ISeriesApi<any> | null` (backward compatible).

## Non-goals
- No drawings or signals rendered yet.
- No PineTS changes.
- No legacy widget changes.
- No migrations or `*/migration/*` edits.
- Do not add or use the `server-only` package.

## Hard rules (from project constraints)
- Line-tools **must be copied** into `apps/tradinggoose/widgets/widgets/new_data_chart/plugins/`.
- **Do not import any files outside this project**; all code should resolve from local repo files or vendored code.
- Do not add legacy support or extra complexity.

## Decisions (locked)
1. **Line-tools location**
   - `apps/tradinggoose/widgets/widgets/new_data_chart/plugins/**` only.

2. **Module resolution**
   - Add `paths` aliases in `apps/tradinggoose/tsconfig.json` for the **actual vendored packages**:
     - `lightweight-charts-line-tools-core`
     - `lightweight-charts-line-tools-lines`
     - `lightweight-charts-line-tools-rectangle`
     - `lightweight-charts-line-tools-text`
     - `lightweight-charts-line-tools-circle`
     - `lightweight-charts-line-tools-path`
   - If a single “types” entrypoint is needed, **re-export types from core** rather than inventing a new package name.
   - **Do not** add these names to `transpilePackages` unless we formalize them as real packages (with `package.json` and workspace inclusion). Otherwise Next module resolution may fail.

3. **Plugin API usage**
   - Use the difurious line‑tools **plugin API only** (no LineToolManager flow).
   - One plugin instance per target series/pane.

4. **Tool registration set (v1)**
   - Register ONLY:
     - `TrendLine`, `HorizontalLine`, `HorizontalRay`, `VerticalLine`, `Rectangle`, `Text`, `Circle`, `Path`.
   - Do **not** call upstream `registerLinesPlugin`.

## Affected files/areas
- `apps/tradinggoose/widgets/widgets/new_data_chart/plugins/**` (vendored line-tools)
- `apps/tradinggoose/tsconfig.json` (paths aliases)
- `apps/tradinggoose/next.config.ts` (transpilePackages)
- `apps/tradinggoose/widgets/widgets/new_data_chart/drawings/**` (adapter)
- `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/use-new-indicator-sync.ts`
- `apps/tradinggoose/widgets/widgets/new_data_chart/types.ts`

## Detailed steps
1. **Vendor line-tools**
   - Copy the external repo’s line‑tools source into:
     - `apps/tradinggoose/widgets/widgets/new_data_chart/plugins/`
   - Add minimal entrypoints to mirror the original package structure, e.g.:
     - `plugins/lightweight-charts-line-tools-core/index.ts`
     - `plugins/lightweight-charts-line-tools-lines/index.ts`
     - `plugins/lightweight-charts-line-tools-rectangle/index.ts`
     - `plugins/lightweight-charts-line-tools-text/index.ts`
     - `plugins/lightweight-charts-line-tools-circle/index.ts`
     - `plugins/lightweight-charts-line-tools-path/index.ts`
   - If we need a types-only entrypoint, re-export types from `lightweight-charts-line-tools-core`.
   - Keep the vendored code untouched where possible to reduce future diff noise.

2. **Set module resolution**
   - In `apps/tradinggoose/tsconfig.json`, add `paths` aliases to the vendored entrypoints.
   - Skip `transpilePackages` unless we later formalize these as real workspace packages.

3. **Create the plugin adapter**
   - New folder: `apps/tradinggoose/widgets/widgets/new_data_chart/drawings/`.
   - Provide functions to:
     - Register supported tools once per plugin instance.
     - Create tool instances from normalized draw instructions (actual mapping happens in Stage 2).
     - Attach/detach tools per series/pane.

4. **Expose pane anchor series**
   - Extend `IndicatorRuntimeEntry` in `apps/tradinggoose/widgets/widgets/new_data_chart/types.ts` with:
     - `paneAnchorSeries?: ISeriesApi<any> | null`.
   - Populate it in `apps/tradinggoose/widgets/widgets/new_data_chart/hooks/use-new-indicator-sync.ts` using the **already computed** `paneAnchorSeries` (do not recompute).
   - Ensure `indicatorRuntimeVersion` updates when the anchor series changes so downstream drawing hooks can react. If the existing runtime signature does not capture anchor changes, add a stable signature component (for example, include `paneIndex` + a derived series key such as `seriesOrder()` or another stable identifier available from the series).

5. **Keep behavior unchanged**
   - No drawings or signal markers are rendered in Stage 1.

## Validation
- Build/typecheck to ensure `paths` aliases resolve.
- Load new_data_chart and confirm no chart regressions (no new panes, no new markers/tools).

## Risks
- Vendored line‑tools drift vs upstream; re-validate on upgrades.

## Rollback
- Remove vendored `plugins/**` and revert `tsconfig.json` / `next.config.ts` entries.
- Remove the adapter and any new runtime fields if necessary.
