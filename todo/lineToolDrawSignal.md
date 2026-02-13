# Draw + Trigger Docs (Index)

This document serves as an index to draw-related and trigger-related todo docs under `todo/`.

## Staged draw documents
- Stage 1: Vendored line‑tools + plugin adapter
  - `todo/stage1-line-tools.md`
- Stage 2: draw.* API + drawings normalization + rendering
  - `todo/stage2-draw.md`

## Standalone documents
- Trigger API + marker rendering + event hooks
  - `todo/indicatorAsTrigger.md`

## Hard rules reminder
- Line‑tools must be **copied** into `apps/tradinggoose/widgets/widgets/data_chart/plugins/`.
- Do **not** import any files outside this project.
- Do not edit any `*/migration/*` or `*/migrations/*` files.
- Do not add legacy support or extra project complexity.
- Do not use the `server-only` package.
- Do not inject or generate any `const { ... } = $.pine` or `const { ... } = $.data` code.
