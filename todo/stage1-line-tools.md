# Stage 1: Vendored Line-Tools + Plugin Adapter (data_chart)

## Goal
Make lightweight-charts line-tools **self-contained** in this repo and provide a stable plugin adapter inside `apps/tradinggoose/widgets/widgets/data_chart/`, with manual interactive drawings enabled for users.

## Scope (Stage 1 only)
- Vendor (copy) line‑tools source into this repo under:
  - `apps/tradinggoose/widgets/widgets/data_chart/plugins/**`
- Normalize vendored package folder names:
  - Map upstream core package `lightweight-charts-line-tools-core` to `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/`.
  - Store non-core tool packages as prefixless folders under `apps/tradinggoose/widgets/widgets/data_chart/plugins/*` (for example, `lines`, `freehand`, `rectangle`).
- Import the vendored code via local paths inside `data_chart` (no `tsconfig.json` path aliases).
- Do not add new vendored entrypoint files; point imports directly at existing vendored `index.ts` files (or equivalent existing entrypoints).
- Rewrite vendored tool imports that reference `lightweight-charts-line-tools-core` to local relative paths so the build resolves without aliases.
- Keep vendored plugins runtime-only: prune repo docs/package/config artifacts (`README.md`, `package*.json`, `rollup.config.js`, `typedoc.json`, `tsconfig.json`, `.gitignore`, `LICENSE`, demo/test html) and keep only runtime code files directly under `plugins/<name>/` (for example `index.ts`, `model/**`, `views/**`, `rendering/**`, `api/**`, `interaction/**`, `utils/**`), with no `plugins/<name>/src/` folder.
- Do **not** add vendored package names to `transpilePackages` unless they are real packages with `package.json` and workspace inclusion.
- Implement a plugin adapter under `apps/tradinggoose/widgets/widgets/data_chart/drawings/` that:
  - Registers the full tool set (per Decision #6) via `registerLineTool` calls.
  - Supports manual tool lifecycle on chart panes with capability-based behavior (no per-tool hardcoded overrides): creation attempts for all registered tools, selection/edit actions for selection-capable tools, and owner-scoped toggle/remove for non-selection-capable tools.
  - Provides attach/detach APIs for manual usage now and Stage 2/3 reuse later.
- Add a TradingView-style draw-tools sidebar on the **left side** of `data_chart` (inside chart body), with tool buttons and hover dropdowns for grouped tools.
- Add per-pane selected draw controls (`draw-control`) that appear next to pane controls when a manual drawing is selected, with hide/remove actions for the selected drawing(s).
- Enforce icon-only sidebar buttons via a tool-icon registry; `clear all` must be the last sidebar button.
- Add a minimal vendored lifecycle patch in core so plugin instances can be explicitly destroyed on detach/unmount.
- Extend `IndicatorRuntimeEntry` to carry `paneAnchorSeries?: ISeriesApi<any> | null` and `paneAnchorIdentity?: string | null` (backward compatible).
- Store **manual** line-tools ownership in `params.view.drawTools[]` only; Stage 2 indicator `draw.*` ownership stays in indicator runtime ownership (not in `view.drawTools[]` and not in `view.pineIndicators[]`).

## Non-goals
- No Pine `draw.*` indicator drawings rendered yet (handled in Stage 2); Stage 1 does render manual user drawings.
- No global manual-drawing keyboard shortcut layer in Stage 1 (for example, binding `Delete` to removal).
- No draw-tools controls in header/chart-controls for Stage 1; draw-tools controls live in the left chart sidebar.
- No PineTS changes.
- No legacy widget changes.
- No migrations or `*/migration/*` edits.
- Do not add or use the `server-only` package.

## Hard rules (from project constraints)
- Line-tools **must be copied** into `apps/tradinggoose/widgets/widgets/data_chart/plugins/`.
- **Do not import any files outside this project**; all code should resolve from local repo files or vendored code.
- Do not add legacy support or extra complexity.

## Decisions (locked)
1. **Line-tools location + naming**
   - `apps/tradinggoose/widgets/widgets/data_chart/plugins/**` only.
   - Core local folder name is `core` (source package is `lightweight-charts-line-tools-core`).
   - Non-core vendored package folders must drop the `lightweight-charts-line-tools-` prefix.
   - Locked local folder mapping:
     - `lightweight-charts-line-tools-core` -> `plugins/core`
     - `lightweight-charts-line-tools-lines` -> `plugins/lines`
     - `lightweight-charts-line-tools-freehand` -> `plugins/freehand`
     - `lightweight-charts-line-tools-rectangle` -> `plugins/rectangle`
     - `lightweight-charts-line-tools-fib-retracement` -> `plugins/fib-retracement`
     - `lightweight-charts-line-tools-parallel-channel` -> `plugins/parallel-channel`
     - `lightweight-charts-line-tools-price-range` -> `plugins/price-range`
     - `lightweight-charts-line-tools-long-short-position` -> `plugins/long-short-position`
     - `lightweight-charts-line-tools-text` -> `plugins/text`
     - `lightweight-charts-line-tools-market-depth` -> `plugins/market-depth`
     - `lightweight-charts-line-tools-circle` -> `plugins/circle`
     - `lightweight-charts-line-tools-path` -> `plugins/path`

2. **Module resolution**
   - Do **not** add new `tsconfig.json` path aliases for vendored line-tools package names in Stage 1.
   - Existing app import aliases (for example `@/*`) remain unchanged.
   - Import vendored tools via local paths under `apps/tradinggoose/widgets/widgets/data_chart/plugins/**`.
   - Use prefixless folder paths for imports (for example, `plugins/core/...`, `plugins/lines/...`, `plugins/freehand/...`).
   - Rewrite package-name imports (e.g., `from 'lightweight-charts-line-tools-core'`) inside vendored tools to local relative paths computed from each source file depth (for example, `plugins/<tool>/index.ts` -> `../core`, `plugins/<tool>/model/*.ts` -> `../../core`), since upstream packages import core by name and will not resolve without aliases.
   - Restrict code rewrites to TS/TSX sources; perform runtime-only pruning separately for non-runtime vendored root files.
   - If a single “types” entrypoint is needed, re-export from the local vendored core path (for example `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/types`) rather than any vendored package-name import.
   - **Do not** add these names to `transpilePackages` unless we formalize them as real packages (with `package.json` and workspace inclusion). Otherwise Next module resolution may fail.

3. **Upstream source + snapshot policy (line-tools v1.0.0)**
   - Source repos (difurious) use this locked Stage 1 snapshot policy (no SHA pin required):
     - Reproducibility anchor is the committed vendored tree in `apps/tradinggoose/widgets/widgets/data_chart/plugins/**` on the current branch.
     - Upstream URLs and optional `../lightweight-charts-tools/*` are provenance/verification inputs only, not runtime dependencies.
     - If `../lightweight-charts-tools/*` exists, use it only as a local mirror for parity checks.
     - If `../lightweight-charts-tools/*` is absent, continue from the tracked vendored tree and the repo URLs below; do not block Stage 1 on sibling-repo availability.
     - If a re-copy is required by allowlist rules, commit the resulting vendored snapshot before continuing Stage 1 work.
     - Do not pull/update during Stage 1.
     - `https://github.com/difurious/lightweight-charts-line-tools-core` -> `plugins/core`
     - `https://github.com/difurious/lightweight-charts-line-tools-lines` -> `plugins/lines`
     - `https://github.com/difurious/lightweight-charts-line-tools-freehand` -> `plugins/freehand`
     - `https://github.com/difurious/lightweight-charts-line-tools-rectangle` -> `plugins/rectangle`
     - `https://github.com/difurious/lightweight-charts-line-tools-fib-retracement` -> `plugins/fib-retracement`
     - `https://github.com/difurious/lightweight-charts-line-tools-parallel-channel` -> `plugins/parallel-channel`
     - `https://github.com/difurious/lightweight-charts-line-tools-price-range` -> `plugins/price-range`
     - `https://github.com/difurious/lightweight-charts-line-tools-long-short-position` -> `plugins/long-short-position`
     - `https://github.com/difurious/lightweight-charts-line-tools-text` -> `plugins/text`
     - `https://github.com/difurious/lightweight-charts-line-tools-market-depth` -> `plugins/market-depth`
     - `https://github.com/difurious/lightweight-charts-line-tools-circle` -> `plugins/circle`
     - `https://github.com/difurious/lightweight-charts-line-tools-path` -> `plugins/path`
   - Compatibility: verified via upstream package manifests declaring `lightweight-charts` peer `^5.0.0`, so `5.1.0` is supported; no version alignment required.

4. **Plugin API usage**
   - Use the difurious line‑tools **plugin API only** (no LineToolManager flow).
   - `drawToolsOwnerId` contract: `<domain>:<ownerRef>` where `domain` is `manual` or `indicator`, and `ownerRef` is the stable logical owner id (not pane/series ids).
   - `chartScopeKey` contract: stable chart-widget scope key (`panelId` when available; otherwise a mount-local fallback id created once via `useRef`).
   - `seriesAttachmentKey` contract: chart-scoped pane/series attachment identity string (`chart:${chartScopeKey}:price:${mainSeriesIdentity}` or `chart:${chartScopeKey}:indicator:${indicatorId}:anchor:${paneAnchorIdentity}`).
   - One plugin instance per `seriesAttachmentKey` (not per owner).
   - Plugin uniqueness is chart-widget scoped by `seriesAttachmentKey` across both ownership domains (`drawToolsByManual` and `drawToolsByIndicator`): the same `seriesAttachmentKey` must not create two plugin instances.
   - Multiple owners may target the same pane/series and must share the same plugin instance for that target.
   - Keep a single chart-widget-scoped plugin-instance registry (`pluginsBySeriesAttachmentKey`) plus owner-to-series-attachment bindings + per-series-attachment refcount so shared plugin lifecycle is deterministic.
   - Same plugin type is used for both manual and indicator flows; separation is by owner map/lifecycle, not plugin implementation.
   - Stage 1 must add a minimal vendored teardown API because upstream core subscribes DOM/window/chart events but does not expose plugin destruction:
     - Add `destroy(): void` to `ILineToolsApi`.
     - Implement `destroy()` in core plugin to unsubscribe delegates, remove all tools, and destroy interaction manager listeners.
     - Implement `interactionManager.destroy()` with stable bound handlers and matching `removeEventListener`/`unsubscribe*` calls.
     - Update `createDummyPluginApi()` in core `index.ts` to include a no-op `destroy()` so fallback API remains type-complete.
   - Upstream delete hotkey support is not provided by default (`removeSelectedLineTools()` is button/API driven; interaction manager keyboard handling tracks `Shift` only), so Stage 1 must not require built-in keyboard delete behavior.

5. **Manual ownership storage**
   - Store manual line-tools ownership in `params.view.drawTools[]` (separate from `view.pineIndicators[]`).
   - Define `DrawToolsRef` as `{ id: string; pane: 'price' | 'indicator'; indicatorId?: string }`.
   - Reserve owner-id namespace for manual tools: `drawToolsOwnerId = manual:${drawTools.id}`.
   - `drawToolsOwnerId` payload (manual): `manual:<drawTools.id>` where `drawTools.id` is unique within the chart.
   - `drawToolsOwnerId` does not encode pane/series; routing is resolved from `DrawToolsRef` at attach time.
   - Active manual-owner rule (Stage 1): interactive manual commands target exactly one active manual owner at a time.
   - Active owner resolution order (locked):
     - Use `activeDrawToolsId` if it exists in `view.drawTools[]`.
     - Else use `view.drawTools[0]` if present.
     - Else bootstrap default manual owner `{ id: 'manual-main', pane: 'price' }`, persist it into `view.drawTools[]`, and use it as active owner.
   - `activeDrawToolsId` is local runtime state in `chart-body.tsx` (not persisted into `view` params).
   - Bootstrap write guard (locked):
     - Bootstrap default `view.drawTools` only when incoming `view.drawTools` is missing/empty.
     - Persist bootstrap with strict structural equality guard; do not emit params update if the next value is equal to current value.
     - Use one-shot bootstrap guard per mounted widget/view identity to prevent repeated update loops from echoed params.
   - Active-owner switch triggers (locked):
     - Selection-driven switch: after `reconcileSelection(drawToolsOwnerId)`, if that owner's selected count is `> 0`, set `activeDrawToolsId` to that owner id.
     - Owner-removal fallback: if current `activeDrawToolsId` no longer exists in `view.drawTools[]`, recompute using the locked resolution order above.
     - No implicit pane/hover switch: active owner must not change from pane focus/hover alone.
   - Non-active manual owners remain attached/rendered but are not mutated by active-owner commands (`startManualTool`, `removeSelected`, `clearAll`).
   - `pane === 'price'` targets main chart/manual drawings on price pane.
   - `pane === 'indicator'` is for user drawings on a specific indicator pane; `indicatorId` is only pane routing metadata, not indicator-generated drawing ownership.

6. **Tool registration set (v1)**
   - Register all tools from the vendored packages:
     - `TrendLine`, `Ray`, `Arrow`, `ExtendedLine`, `HorizontalLine`, `HorizontalRay`, `VerticalLine`, `CrossLine`, `Callout`,
       `Brush`, `Highlighter`, `Rectangle`, `Circle`, `Path`, `ParallelChannel`, `FibRetracement`, `PriceRange`,
       `LongShortPosition`, `Text`, `MarketDepth`.
   - Do **not** call upstream `registerLinesPlugin`.
   - Stage 1 intentionally registers all tools for parity and immediate manual-drawing support.
   - No tool-type-specific Stage 1 overrides; behavior must be driven by capability checks and owner-scoped tool-id tracking (not `if toolType === ...` branches).
   - Capability-detection rule (locked, no per-tool hardcoding):
     - Maintain per-owner+tool capability state as tri-state: `unknown` (initial), `supported`, `unsupported`.
     - On `startManualTool(type, ownerId)`, record `supportsCreate = createdId !== ''` from `addLineTool(...)` return.
     - Initial state is `unknown`: sidebar entry is enabled and first create attempt is allowed.
     - On first successful create, set state to `supported`; on first failed create (`createdId === ''`), set state to `unsupported`.
     - After each successful create/update (`supportsCreate === true`), parse `getLineToolByID(id)` and persist `canEdit = export.options?.editable !== false` in owner-scoped metadata.
     - On every pointer-up reconciliation, parse `getSelectedLineTools()` and update owner-scoped selected-id snapshots.
     - A tool is treated as selection-capable when `canEdit === true`; selection actions are snapshot-driven and only operate on ids currently present in selected-id snapshots.
     - A tool is treated as non-selection-capable when `canEdit === false`; route remove/toggle through owner-scoped id tracking (`ownerToolIdsByType`) instead of selection actions.
     - If `supportsCreate === false`, do not mutate owner tool state; show a disabled/unavailable sidebar state with tooltip for that tool in the current adapter instance.
     - Reset `unsupported` back to `unknown` only when that owner detaches or the chart widget remounts.
   - Tradeoff: this adds upfront complexity, accepted to keep parity with upstream tools and reduce churn in later stages.

7. **Manual draw-tools UI (locked)**
   - Place draw-tools UI inside `chart-body.tsx` as a left vertical sidebar overlay (TradingView-style), not in header controls.
   - Sidebar cardinality is locked to **one sidebar per `data_chart` widget instance** (not one per pane); sidebar actions target the resolved active owner, and owner routing determines pane target.
   - Layout/overlap lock for left overlays:
     - Use fixed sidebar width `DRAW_TOOLS_SIDEBAR_WIDTH_PX = 40`.
     - Use fixed gap `LEFT_OVERLAY_GAP_PX = 3`.
     - Compute `LEFT_OVERLAY_INSET_PX = DRAW_TOOLS_SIDEBAR_WIDTH_PX + LEFT_OVERLAY_GAP_PX` and apply it to all pane-level left overlays.
     - Existing indicator-control stack in `chart-body.tsx` must use `left: LEFT_OVERLAY_INSET_PX` (not `left: 3px`) so it cannot render under the draw-tools sidebar.
     - Main-pane `ChartLegend` container must also use `LEFT_OVERLAY_INSET_PX` (replace current hard-left offset) so legend/listing overlays do not overlap the sidebar.
   - Every registered manual tool must have a sidebar entry (actionable when `supportsCreate === true`, disabled/unavailable state when `supportsCreate === false`).
   - Sidebar buttons are icon-only (no visible text labels); each button still includes tooltip text + `sr-only` text for accessibility.
   - Add a centralized icon registry for manual draw tools/actions (`draw-tool-icon-registry.ts`) so sidebar and draw-control use consistent icons.
   - Sidebar structure:
     - Multi-tool family buttons use hover dropdown menus (and click/tap fallback):
       - `Lines` family dropdown: `TrendLine`, `Ray`, `Arrow`, `ExtendedLine`, `HorizontalLine`, `HorizontalRay`, `VerticalLine`, `CrossLine`, `Callout`.
       - `Freehand` family dropdown: `Brush`, `Highlighter`.
     - Single-tool buttons: `Rectangle`, `Circle`, `Path`, `ParallelChannel`, `FibRetracement`, `PriceRange`, `LongShortPosition`, `Text`, `MarketDepth`.
     - Last button in sidebar is `clearAll(drawToolsOwnerId)` (icon-only clear action).
   - Tool button selection calls `startManualTool(selectedType, drawToolsOwnerId)` for the active manual owner and applies the locked `supportsCreate` fallback behavior.

8. **Selected draw control UI (locked)**
   - Create `draw-control.tsx`, patterned after `indicator-control.tsx` and `pane-control.tsx`.
   - Render `draw-control` in the same pane overlay row as `PaneControl`, positioned immediately to the **left** of `PaneControl`.
   - Show `draw-control` only when active manual owner has selected drawing(s) in that pane.
   - `hasSelectedManualDrawingsInPane` is derived from adapter-managed selection snapshots, with pointer-up reconciliation as the source of truth.
   - `draw-control` visibility must be independent of indicator runtime presence:
     - Do not gate `draw-control` by `hasIndicatorRuntime`.
     - Use pane-level condition `hasSelectedManualDrawingsInPane` for draw-control rendering.
     - Use right-overlay row condition `hasIndicatorRuntime || hasSelectedManualDrawingsInPane` so selected manual drawings still surface controls when no indicators are mounted.
   - `draw-control` actions (icon-only):
     - `hideSelected(drawToolsOwnerId)` to hide selected drawing(s) by applying `options.visible = false` via `applyLineToolOptions`.
     - `removeSelected(drawToolsOwnerId)` to delete selected drawing(s).
   - Stage 1 hide behavior is one-way from this control (`visible -> hidden`); hidden drawings are not re-shown by Stage 1 UI.

## Affected files/areas
- `apps/tradinggoose/widgets/widgets/data_chart/plugins/**` (vendored line-tools)
- `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/api/public-api.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/core-plugin.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/interaction/interaction-manager.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/index.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/drawings/**` (adapter)
- `apps/tradinggoose/widgets/widgets/data_chart/components/chart-body.tsx` (consume `view.drawTools`)
- `apps/tradinggoose/widgets/widgets/data_chart/components/chart-legend.tsx` (left overlay offset must align with sidebar inset)
- `apps/tradinggoose/widgets/widgets/data_chart/components/draw-tools-sidebar.tsx` (new left sidebar UI)
- `apps/tradinggoose/widgets/widgets/data_chart/components/draw-control.tsx` (new selected-drawing control)
- `apps/tradinggoose/widgets/widgets/data_chart/components/draw-tool-icon-registry.ts` (new icon registry for draw tools/actions)
- `apps/tradinggoose/widgets/widgets/data_chart/hooks/use-indicator-sync.ts`
- `apps/tradinggoose/widgets/widgets/data_chart/types.ts`
- `todo/stage2-draw.md` (drawTools ownership model alignment)

## Detailed steps
1. **Vendor line-tools**
   - Vendor from the Stage 1 snapshot in Decision #3; compatibility with `lightweight-charts` 5.1.0 is already confirmed and no alignment is required.
   - If `../lightweight-charts-tools/*` exists, verify the existing vendored snapshot under `apps/tradinggoose/widgets/widgets/data_chart/plugins/**` against it using this allowlist:
     - Allowed/expected divergence:
       - Locked folder renames from prefixed names to Decision #1 mapping (for example, `lightweight-charts-line-tools-lines` -> `plugins/lines`).
       - TS/TSX import-path rewrites from package-name core imports to local relative imports.
       - Runtime-only pruning of vendored root artifacts (`README.md`, `package*.json`, `rollup.config.js`, `typedoc.json`, `tsconfig.json`, `.gitignore`, demo/test html).
       - Required core teardown patch edits only in `public-api.ts`, `core-plugin.ts`, `interaction-manager.ts`, and `index.ts`.
     - Re-copy only if differences exist **outside** the allowlist above.
   - If `../lightweight-charts-tools/*` is absent, treat the tracked vendored snapshot as baseline and apply only Stage 1 allowlisted edits (no external copy prerequisite).
   - Only when re-copy is required by the allowlist rule above, copy external repo line‑tools source into:
     - `apps/tradinggoose/widgets/widgets/data_chart/plugins/`
   - When re-copy is not required, keep the tracked vendored snapshot in place and apply only allowlisted Stage 1 edits.
   - Self-contained reproducibility lock:
     - Vendored sources under `apps/tradinggoose/widgets/widgets/data_chart/plugins/**` must be tracked in this repo (no runtime dependency on `../lightweight-charts-tools/*`).
     - Optional helper scripts are allowed, but Stage 1 requires committed vendored outputs.
   - Apply locked folder naming/layout during copy:
     - Map upstream core package into `plugins/core/`.
     - Place non-core tool packages in prefixless folders under `plugins/*` per Decision #1 mapping.
   - If prefixed non-core folders already exist (for example, `plugins/lightweight-charts-line-tools-lines`), rename them to mapped prefixless folder names before wiring imports.
   - Do not add license/NOTICE work in Stage 1 (per `AGENTS.md` rule to ignore license issues); keep existing root `NOTICE` entry as-is.
   - Rewrite imports in vendored tools that reference `lightweight-charts-line-tools-core` to local relative paths computed from each file depth (for example `plugins/<tool>/index.ts` -> `../core`, `plugins/<tool>/model/*.ts` -> `../../core`).
   - Prune non-runtime vendored root files from each package: `README.md`, `package*.json`, `rollup.config.js`, `typedoc.json`, `tsconfig.json`, `.gitignore`, and demo/test html files.
   - Do not add new entrypoint files; import directly from the vendored packages’ existing `index.ts` (or equivalent) to keep the source untouched.
   - If a types-only import surface is needed, re-export types from the local vendored core path in local app code (for example `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/types`) without adding files under vendored `plugins/**` and without package-name imports.
   - Apply a minimal lifecycle patch in vendored core to add explicit teardown (`destroy`) and remove event/listener subscriptions on cleanup.
   - After import rewrites + runtime-only pruning + teardown patch, divergence from raw upstream snapshot is expected and must remain within the allowlist above.
   - Teardown patch targets (explicit):
     - `.../api/public-api.ts`: add `destroy(): void` to `ILineToolsApi`.
     - `.../core-plugin.ts`: implement `destroy()` for plugin-level cleanup.
     - `.../interaction/interaction-manager.ts`: implement `destroy()` that unsubscribes/removes all bound listeners.
     - `.../index.ts`: update `createDummyPluginApi()` to expose no-op `destroy()`.
   - Keep vendored runtime source untouched where possible to reduce future diff noise (limit source edits to required import path rewrites + teardown patch; keep non-runtime pruning deterministic).

2. **Set module resolution**
   - Do not add new vendored-package `tsconfig.json` aliases; use local imports from `apps/tradinggoose/widgets/widgets/data_chart/plugins/**`.
   - Existing app aliases (for example `@/*`) are not part of this prohibition.

3. **Create the plugin adapter**
   - New folder: `apps/tradinggoose/widgets/widgets/data_chart/drawings/`.
   - Adapter must be client-only: add `use client` at the module top.
   - Provide functions to create a core plugin instance via `createLineToolsPlugin(chart, series)` from the vendored core.
   - Register all tool classes by calling `plugin.registerLineTool(type, ToolClass)` for each vendored tool (Lines: `TrendLine`, `Ray`, `Arrow`, `ExtendedLine`, `HorizontalLine`, `HorizontalRay`, `VerticalLine`, `CrossLine`, `Callout`; Freehand: `Brush`, `Highlighter`; plus `Rectangle`, `Circle`, `Path`, `ParallelChannel`, `FibRetracement`, `PriceRange`, `LongShortPosition`, `Text`, `MarketDepth`).
   - Maintain a single chart-widget-scoped plugin-instance registry keyed by `seriesAttachmentKey`:
     - `pluginsBySeriesAttachmentKey` -> plugin instance (uniqueness across domains within one chart widget instance).
     - Registry storage is adapter-instance local (no module-level singleton shared across widgets).
   - Maintain separate ownership-domain binding maps (owner -> series attachment):
     - `drawToolsByManual` for Stage 1 manual owners.
     - `drawToolsByIndicator` reserved for Stage 2 indicator owners.
   - Track per-target subscription handlers (double-click / after-edit) and per-owner snapshots/ids.
   - Provide `attach`/`detach` APIs keyed by `drawToolsOwnerId`, sourced from `manual:${params.view.drawTools[].id}`. Resolve `seriesAttachmentKey` from `chartScopeKey` + `drawTools[].pane` + runtime identity:
     - `pane === 'price'`: attach to `mainSeries`.
     - `pane === 'indicator'`: resolve `IndicatorRuntimeEntry` by `indicatorId` and use `paneAnchorSeries`.
   - Attach/detach lifecycle (locked):
     - On `attach(ownerId -> seriesAttachmentKey)`: reuse existing plugin for `seriesAttachmentKey` or create one if missing; increment series-attachment refcount.
     - On `detach(ownerId)`: remove only that owner's tool IDs/snapshots; decrement series-attachment refcount; destroy plugin only when series-attachment refcount reaches zero.
   - Add mandatory owner-target reconciliation to prevent stale plugin instances when series anchors change:
     - Keep `ownerBindingById` with `{ seriesAttachmentKey, pane, indicatorId }` for each attached owner, where `seriesAttachmentKey` is built from resolved pane/series attachment identity.
     - Build `seriesAttachmentKey` as:
       - `chart:${chartScopeKey}:price:${mainSeriesIdentity}` for `pane === 'price'`.
       - `chart:${chartScopeKey}:indicator:${indicatorId}:anchor:${paneAnchorIdentity}` for `pane === 'indicator'`.
     - Identity source lock:
       - `chartScopeKey` must be stable for the mounted chart widget (`panelId` when present; otherwise mount-local fallback id).
       - `mainSeriesIdentity` may use adapter-local reference/WeakMap identity.
       - `paneAnchorIdentity` must be exposed on `IndicatorRuntimeEntry` from `use-indicator-sync.ts` using its existing anchor identity computation.
       - Adapter must consume runtime `paneAnchorIdentity` for indicator target keys; do not introduce adapter-local WeakMap identity for indicator anchors.
     - Run `reconcileOwnerAttachment(drawToolsOwnerId)` whenever any of these change:
       - `view.drawTools[]` membership/order or `pane`/`indicatorId` fields.
       - `indicatorRuntimeVersion` (captures anchor-series replacement).
       - `mainSeries` instance replacement or chart remount.
     - Reconciliation algorithm (locked):
       - If owner is removed from `view.drawTools[]`: fully `detach` and delete owner state.
       - If target series is unresolved (missing indicator runtime or null `paneAnchorSeries`): export owner tools snapshot, `detach`, and keep snapshot pending until target resolves.
       - If owner has no target binding and target resolves: `attach` and import pending snapshot if present.
       - If owner is bound and `seriesAttachmentKey` changes: export current tools snapshot, `detach`, `attach` to new series attachment, import snapshot, then refresh selection snapshot.
       - If owner is bound and `seriesAttachmentKey` is unchanged: keep binding and only refresh selection snapshot.
   - On `detach`, remove owner-owned tool IDs via `removeLineToolsById(ownerIds)`, clear owner snapshots, and only run series-attachment-level unsubscribe + `plugin.destroy()` when series-attachment refcount reaches zero.
   - Add owner-targeted manual interaction APIs:
     - `startManualTool(type, drawToolsOwnerId)` -> calls `addLineTool(type, [])` for interactive point placement on the active owner instance.
     - `removeSelected(drawToolsOwnerId)` -> remove only selected IDs that belong to the active owner via `removeLineToolsById(ownerSelectedIds)`.
     - `hideSelected(drawToolsOwnerId)` -> read selected IDs, filter to owner-owned IDs, then apply `options.visible = false` via `applyLineToolOptions(...)`.
     - `clearAll(drawToolsOwnerId)` -> remove only owner-owned IDs via `removeLineToolsById(ownerIds)`.
   - Selection-based actions (`getSelectedLineTools` / `hideSelected` / `removeSelected`) apply only when the active owner has a non-empty selection snapshot.
   - Add owner-scoped tool-id tracking for non-selection removal flows:
     - Capture IDs returned by `addLineTool(...)` per owner and tool type.
     - Determine non-selection flow eligibility via the locked capability rule (`canEdit === false`), not by tool-type name checks.
     - If `supportsCreate === false` for a tool action, treat it as unavailable for manual creation in this adapter instance and do not add owner-scoped ids.
     - Non-selection remove policy (locked):
       - Enforce at most one non-selectable instance per `owner + toolType`.
       - On create for a non-selectable tool type, remove existing ID for that `owner + toolType` before creating the new one (toggle replacement).
       - Sidebar remove for non-selectable tools removes that single tracked ID (no ambiguous multi-id behavior).
     - Provide adapter remove-by-id action using `removeLineToolsById(ids)` for owner-scoped removal without `clearAll`.
     - Keep selection and id-tracking stores consistent after remove/hide/clear/detach.
   - Add selection snapshot helpers per owner so UI can know whether selected manual tools exist:
     - Core API does not expose a general selection-change subscription (only `subscribeLineToolsDoubleClick` and `subscribeLineToolsAfterEdit`), so adapter must implement explicit pointer-up reconciliation.
     - On series-attachment plugin `attach` (first owner for that series attachment), bind pointer-up listeners once for that series-attachment context (`pointerup` on chart container; `mouseup` window fallback for outside-chart releases).
     - On each pointer-up, run owner reconciliation in `requestAnimationFrame` for owners bound to that series attachment so selection is read after interaction state settles.
     - `reconcileSelection(drawToolsOwnerId)` reads `getSelectedLineTools()`, intersects with owner-owned IDs, and updates that owner's selected IDs/count snapshot used by pane overlay conditions.
     - `reconcileSelection(drawToolsOwnerId)` must also drive active-owner switching via the locked rule in Decision #5 (selected count `> 0` -> set active owner to that owner).
     - Trigger `reconcileSelection(drawToolsOwnerId)` after `afterEdit`/double-click callbacks, after active-owner switches, and after owner-targeted actions (`startManualTool`, `hideSelected`, `removeSelected`, `clearAll`) for deterministic UI state.
     - On owner `detach`, delete that owner's selection snapshot entry; remove series-attachment pointer-up listeners only when series-attachment refcount reaches zero.
   - Wire pointer interactions so users can create/edit drawings directly on chart.
   - Sidebar UI triggers manual actions (tool start/clear) for the resolved active owner.
   - Stage 1 uses `addLineTool` for manual creation and does **not** use `createOrUpdateLineTool`.
   - Stage 2+ will additionally call `createOrUpdateLineTool` for Pine-generated drawings.

4. **Expose pane anchor series**
   - Extend `IndicatorRuntimeEntry` in `apps/tradinggoose/widgets/widgets/data_chart/types.ts` with:
     - `paneAnchorSeries?: ISeriesApi<any> | null`.
     - `paneAnchorIdentity?: string | null`.
   - Populate both fields in `apps/tradinggoose/widgets/widgets/data_chart/hooks/use-indicator-sync.ts` using **already computed** values (`paneAnchorSeries`, `anchorIdentity`; do not recompute).
   - Ensure `indicatorRuntimeVersion` updates when the anchor series changes so downstream drawing hooks can react.
   - Status split:
     - Anchor-change runtime invalidation is already satisfied in `use-indicator-sync.ts` via WeakMap-based series identity (`seriesIdentityMapRef` / `getSeriesIdentity`) and anchor identity in runtime signature (`...:anchor:${anchorIdentity}`); do not rework this logic in Stage 1.
     - `paneAnchorSeries` + `paneAnchorIdentity` exposure on `IndicatorRuntimeEntry` is **not** satisfied yet and remains a required Stage 1 implementation item.

5. **Add drawTools view storage**
   - Define `DrawToolsRef` in `apps/tradinggoose/widgets/widgets/data_chart/types.ts` as:
     - `{ id: string; pane: 'price' | 'indicator'; indicatorId?: string }`.
   - Add `drawTools?: DrawToolsRef[]` to `DataChartViewParams` in `apps/tradinggoose/widgets/widgets/data_chart/types.ts`.
   - Add local runtime state `activeDrawToolsId: string | null` in `chart-body.tsx` and resolve it with the locked order in Decision #5.
   - If `view.drawTools` is missing/empty, bootstrap `[ { id: 'manual-main', pane: 'price' } ]` before enabling manual tool actions.
   - Enforce `drawTools.id` normalization/dedupe before owner resolution:
     - Trim whitespace for each id.
     - If id is empty after trim, assign deterministic fallback `manual-${index + 1}`.
     - Enforce uniqueness deterministically: keep first occurrence of each base id unchanged; append `-${n}` (starting at `2`) to later duplicates.
     - Persist the normalized/deduped list with the same anti-loop guard used for bootstrap writes.
     - Derive `drawToolsOwnerId` only from normalized unique ids.
   - Bootstrap anti-loop guard (explicit):
     - Run bootstrap write at most once per mounted widget/view identity.
     - Before writing params, compare current vs next `drawTools` structurally; skip write when equal.
     - Do not re-bootstrap from the same echoed params payload on rerender.
   - Enforce semantics in code that consumes `drawTools`:
     - `pane === 'indicator'` requires `indicatorId` to be present and match a Indicator id in runtime maps.
     - `pane === 'price'` ignores `indicatorId` and attaches to `mainSeries`.
   - Thread `view.drawTools` and resolved `activeDrawToolsId` through `apps/tradinggoose/widgets/widgets/data_chart/components/chart-body.tsx` to the adapter.
   - Do not store draw-tools ownership inside `view.pineIndicators[]`.
   - Add `draw-tools-sidebar.tsx` and mount it on the left side inside `chart-body.tsx`.
   - Use shared layout constants in `chart-body.tsx` (`DRAW_TOOLS_SIDEBAR_WIDTH_PX`, `LEFT_OVERLAY_GAP_PX`, `LEFT_OVERLAY_INSET_PX`) and wire:
     - Sidebar container to fixed left gutter width `DRAW_TOOLS_SIDEBAR_WIDTH_PX`.
     - Indicator-control left overlay container to `left: LEFT_OVERLAY_INSET_PX`.
     - Main-pane `ChartLegend` left position to `LEFT_OVERLAY_INSET_PX`.
     - Update `chart-legend.tsx` hard-left class/style (currently `left-1`) so legend left offset is driven by `LEFT_OVERLAY_INSET_PX` from `chart-body.tsx`.
     - Any additional pane-level left overlays introduced in Stage 1 to the same `LEFT_OVERLAY_INSET_PX`.
   - Add `draw-tool-icon-registry.ts` and make sidebar/draw-control consume it for tool/action icons.
   - Sidebar behavior:
     - Render one selectable entry for every registered tool (direct button or dropdown item).
     - Render icon-only buttons/items; no visible text labels in sidebar.
     - Capability-state UX:
       - `unknown` / `supported`: entry enabled.
       - `unsupported`: entry disabled with tooltip explaining creation is unavailable for that tool in current owner/session.
     - Use hover dropdown for `Lines` and `Freehand` family groups.
     - Keep `clearAll` as the final sidebar button.
     - On selection, invoke owner-targeted adapter action `startManualTool(...)` using resolved active owner.
     - For tools where `canEdit === false`, expose add/remove toggle from sidebar state using owner-scoped id tracking; creation follows locked single-instance-per-owner+type replacement policy (still no tool-type hardcoding).
   - Add `draw-control.tsx` to pane overlay rendering in `chart-body.tsx`:
     - Display it only for panes where active owner has selected manual drawings.
     - Position it immediately left of `PaneControl` when `PaneControl` is rendered.
     - Remove/replace any `hasIndicatorRuntime`-only gate for the right overlay controls; use `hasIndicatorRuntime || hasSelectedManualDrawingsInPane` instead.
     - If no indicator runtime exists for that pane, keep `PaneControl` hidden and render `draw-control` alone when `hasSelectedManualDrawingsInPane` is true.
     - Wire icon buttons to `hideSelected(activeOwner)` and `removeSelected(activeOwner)`.
6. **Cross-check Stage 2 docs (already aligned)**
   - `todo/stage2-draw.md` already documents separate Stage 2 indicator ownership and routing.
   - Stage 1 implementation must preserve that contract: keep manual `drawTools` state untouched by Stage 2 indicator rendering.
   - Keep owner-id namespaces disjoint (`manual:*` vs `indicator:*`) to prevent cross-domain clears/updates.

7. **Behavior boundary**
   - Stage 1 enables and renders manual user drawings only.
   - Stage 1 does not render Pine `draw.*` indicator drawings or signal markers.

## Validation
- Typecheck gate (high-baseline, diff-based):
  - Full app typecheck currently has many pre-existing failures (baseline count is time-varying and must be measured fresh on the current branch).
  - Capture pre-change diagnostics once for this branch before Stage 1 implementation with memory-safe runtime settings:
    - `cd apps/tradinggoose && NODE_OPTIONS='--max-old-space-size=8192' bun run type-check -- --pretty false > /tmp/stage1_typecheck_baseline.txt 2>&1`
  - Run the same memory-safe command after Stage 1 changes and compare diagnostics to pre-change output:
    - `cd apps/tradinggoose && NODE_OPTIONS='--max-old-space-size=8192' bun run type-check -- --pretty false > /tmp/stage1_typecheck_after.txt 2>&1`
  - Treat baseline diagnostic count as branch-local and time-varying: read it from `/tmp/stage1_typecheck_baseline.txt` after capture; do not hardcode a fixed number in acceptance criteria.
  - Record current touched-path baseline examples alongside the full baseline snapshot for delta checks (for example existing `TS1205` re-export diagnostics in `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/index.ts` around lines 156/160/162).
  - Path-model rule for diagnostics:
    - Current checks use renamed paths under `plugins/*` (core: `plugins/core`).
    - If historical pre-rename diagnostics appear (paths under `plugins/lightweight-charts-line-tools-*`), treat them as equivalent by Decision #1 mapping.
  - Stage 1 acceptance requires:
    - no net-new TypeScript diagnostics globally versus pre-change output;
    - zero new diagnostics in Stage 1 touched paths (`data_chart/drawings/**`, `data_chart/components/chart-body.tsx`, `data_chart/components/draw-tools-sidebar.tsx`, `data_chart/components/draw-control.tsx`, `data_chart/components/draw-tool-icon-registry.ts`, `data_chart/hooks/use-indicator-sync.ts`, `data_chart/types.ts`, and all vendored TS/TSX files changed by Stage 1 rewrites/patches under `data_chart/plugins/**`), including:
      - vendored core teardown patch targets in `plugins/core/**` paths (or equivalent historical pre-rename path mapping);
      - non-core vendored tool package source/entry TS/TSX files touched by import-path rewrites in `plugins/*/**` paths (or equivalent historical pre-rename path mapping).
- Build/resolve check to ensure local vendored imports (including rewritten core paths) resolve.
- Reproducibility check:
  - Verify normalized vendored sources under `apps/tradinggoose/widgets/widgets/data_chart/plugins/**` are tracked in repo for this branch (no required untracked vendored files).
  - Verify there is no residual prefixed-path churn in git status for `plugins/lightweight-charts-line-tools-*` (the normalized `plugins/*` model is the only accepted Stage 1 layout).
- Load `data_chart` and verify manual drawing flow:
  - Left sidebar is visible inside chart body and anchored on the left side.
  - Exactly one draw-tools sidebar is rendered per chart widget (not duplicated per pane); changing active owner updates sidebar action target.
  - Left sidebar does not overlap pane left overlays: indicator-control stack starts at `LEFT_OVERLAY_INSET_PX` and remains fully visible.
  - Main-pane legend/listing overlay also starts at `LEFT_OVERLAY_INSET_PX` and does not overlap the sidebar.
  - Every registered tool has a sidebar entry (direct button or dropdown item), and sidebar buttons are icon-only.
  - `Lines` and `Freehand` family buttons open hover dropdowns and allow selecting sub-tools.
  - `clearAll` is the last sidebar button.
  - Start each tool type from the sidebar.
  - Before first create attempt, entries are in `unknown` capability state and are enabled.
  - For tools where `supportsCreate === true` (`addLineTool(...)` returned a non-empty id), verify creation succeeds; for `canEdit === true`, verify selection/edit behavior.
  - For tools where `canEdit === false`, verify non-selection toggle/remove behavior via owner-scoped ids (no selection dependency).
  - For tools where `supportsCreate === false`, verify sidebar shows unavailable/disabled state and owner tool state is unchanged.
  - Selecting a manual drawing in a pane shows `draw-control` immediately left of `PaneControl` when `PaneControl` is rendered for that pane.
  - With no indicator runtime in pane, verify `PaneControl` remains hidden while `draw-control` still renders when manual selection exists.
  - Selection-state reconciliation works without a dedicated selection event: canvas select/deselect updates `draw-control` on pointer-up (including outside-chart mouseup releases).
  - For tools where `canEdit === false`, verify locked single-instance-per-owner+type replace/remove policy (create replaces prior instance; sidebar remove deletes the tracked instance only).
  - With no indicator runtime mounted, selecting a manual drawing still shows `draw-control` (and the shared right control row) for that pane.
  - `draw-control` hide button hides selected drawing(s); remove button removes selected drawing(s).
  - `clearAll` removes drawings for the active owner via sidebar action.
  - `clearAll` removes drawings for the active targeted owner only.
  - Verify no left-side overlap regression on both main and indicator panes, including after pane resize/reorder operations.
- Verify owner bootstrap and active selection:
  - Start with `view.drawTools` missing/empty and confirm default `{ id: 'manual-main', pane: 'price' }` is bootstrapped before manual actions.
  - Start with duplicate/blank `drawTools[].id` inputs and confirm normalization/dedupe rewrites ids deterministically (`manual-${index+1}` for blanks, `-2/+` suffix for duplicates) before attach.
  - Confirm bootstrap params write is one-shot per mounted widget/view identity and does not loop on rerender/echoed params.
  - Selecting a drawing from a non-active owner switches `activeDrawToolsId` to that owner on pointer-up reconciliation.
  - Pane hover/focus without selection does not switch `activeDrawToolsId`.
  - With multiple manual owners, confirm `startManualTool`/`hideSelected`/`removeSelected`/`clearAll` apply only to the resolved active owner.
- Verify lifecycle cleanup:
  - With multiple owners targeting the same pane/series, confirm they share one series-attachment plugin instance and do not duplicate chart/window interaction callbacks.
  - With two `data_chart` widgets mounted at once, confirm plugin registries are isolated per widget (no cross-widget attach, selection, or callback leakage even if pane/series identities match).
  - Repeat attach/detach for the same owner and confirm no duplicate edit/double-click callbacks.
  - Remount chart and confirm stale handlers from prior plugin instances do not fire.
  - Force indicator anchor replacement (`indicatorRuntimeVersion` change) for an owner targeting `pane === 'indicator'` and confirm the adapter performs export -> detach -> attach -> import on new target with no stale instance left bound to old series.
  - Temporarily remove indicator runtime / null `paneAnchorSeries` for an indicator-pane owner and confirm plugin detaches; restore runtime and confirm pending snapshot reattaches to resolved anchor.
- Verify separation boundary:
  - Manual `clearAll` does not remove Stage 2 indicator-rendered drawings.
  - Indicator rerender/update does not remove manual drawings.
- No automated coverage for adapter attach/detach or runtime signature updates (still a manual validation gap).

## Implementation status
- Drawings adapter folder and wiring are not yet implemented; Stage 1 is not end-to-end complete.
- `apps/tradinggoose/widgets/widgets/data_chart/drawings/` must be created and wired during Stage 1.
- `apps/tradinggoose/widgets/widgets/data_chart/types.ts` does not yet define `drawTools` in `DataChartViewParams`.
- Vendored folder normalization is already applied in the working tree: Stage 1 uses prefixless plugin folders (`plugins/core`, `plugins/lines`, `plugins/freehand`, etc.) per Decision #1.
- Current branch baseline is reproducible: normalized vendored folders are tracked and there is no residual prefixed-path churn for `plugins/lightweight-charts-line-tools-*`; re-check this on each branch after vendoring updates.
- Left draw-tools sidebar UI (`draw-tools-sidebar.tsx`) and its adapter wiring in `chart-body.tsx` are not yet implemented.
- `draw-control.tsx` (selected manual drawing hide/remove UI) is not yet implemented.
- `draw-tool-icon-registry.ts` (icon-only sidebar/action mapping) is not yet implemented.
- `chart-body.tsx` does not yet resolve/bootstrap an active manual owner from `view.drawTools`.
- Shared series-attachment plugin registry (`seriesAttachmentKey` + `seriesAttachmentRefCountByKey`) and owner-scoped tool-id tracking are not yet implemented.
- `IndicatorRuntimeEntry` still needs `paneAnchorSeries?: ISeriesApi<any> | null` and `paneAnchorIdentity?: string | null` for Stage 2 indicator-pane routing readiness.
- Vendored core teardown API (`destroy`) is not yet implemented; lifecycle cleanup remains incomplete until that patch lands.
  - Current required patch targets:
    - `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/api/public-api.ts`
    - `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/core-plugin.ts`
    - `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/interaction/interaction-manager.ts`
    - `apps/tradinggoose/widgets/widgets/data_chart/plugins/core/index.ts`
- Existing app-level typecheck baseline remains high (hundreds of pre-existing errors; exact count is branch/time-varying); Stage 1 uses diff-based delta acceptance until broader baseline cleanup is done.

## Assumptions
- Stage 1 source-of-truth is the normalized vendored tree under `apps/tradinggoose/widgets/widgets/data_chart/plugins/**`; before Stage 1 acceptance on a branch, this tree must be fully tracked with no residual prefixed-path churn.
- `../lightweight-charts-tools/*` may be present for optional parity verification but is not required to execute Stage 1.
- No pulls/updates occur during Stage 1 (per Decision #3).
- `lightweight-charts` remains `5.1.0` during Stage 1.
- Incoming `drawTools[].id` may be non-unique; Stage 1 normalizes/dedupes ids before deriving `drawToolsOwnerId`.
- `chartScopeKey` is stable for each mounted chart widget instance (`panelId` when present, otherwise mount-local fallback id).
- Owner-id namespaces stay disjoint across domains (`manual:*` for Stage 1, `indicator:*` for Stage 2).

## ID model (single source of truth)
- `drawTools.id` is persisted in normalized unique form in `view.drawTools[]` for manual ownership references.
- `drawToolsOwnerId` is runtime owner key only: `manual:<drawTools.id>` or `indicator:<indicatorId>`.
- `chartScopeKey` is runtime chart-widget scope identity used to isolate registries across widgets.
- `seriesAttachmentKey` is runtime chart-scoped pane/series attachment key string: `chart:${chartScopeKey}:price:${mainSeriesIdentity}` or `chart:${chartScopeKey}:indicator:${indicatorId}:anchor:${paneAnchorIdentity}`.
- `pluginsBySeriesAttachmentKey` is the single chart-widget-scoped plugin-instance registry keyed by `seriesAttachmentKey` (adapter-local, not module-global).
- `drawToolsByManual` is the manual-domain owner binding map (`drawToolsOwnerId -> seriesAttachmentKey`).
- `drawToolsByIndicator` is the indicator-domain owner binding map (`drawToolsOwnerId -> seriesAttachmentKey`).
- `ownerBindingById` is the combined owner binding view (`drawToolsOwnerId -> seriesAttachmentKey`).
- `seriesAttachmentRefCountByKey` tracks how many owners are bound to each series-attachment plugin instance.
- `ownerToolIdsByType` tracks owner-scoped created IDs for deterministic remove/toggle behavior.

## Dependencies/Sequence/Rollout
1. Vendor line-tools first, then rewrite core import paths, then wire local imports, then build the adapter.
2. Stage 1 must land before Stage 2/3 can consume the adapter or draw API.

## Risks
- Vendored line‑tools drift vs upstream; re-validate on upgrades.

## Rollback
- Remove vendored `plugins/**` and revert local imports as needed.
- Remove the adapter and any new runtime fields if necessary.
