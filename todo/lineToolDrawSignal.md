# Draw + Signal Roadmap (Index)

This document now serves as an index to the staged implementation docs under `todo/`.

## Stage documents
- Stage 1: Vendored line‑tools + plugin adapter
  - `todo/stage1-line-tools.md`
- Stage 2: draw.* API + drawings normalization + rendering
  - `todo/stage2-draw.md`
- Stage 3: signal.* API + markers + alert hooks
  - `todo/stage3-signals.md`

## Hard rules reminder
- Line‑tools must be **copied** into `apps/tradinggoose/widgets/widgets/data_chart/plugins/`.
- Do **not** import any files outside this project.
- Do not edit any `*/migration/*` or `*/migrations/*` files.
- Do not add legacy support or extra project complexity.
- Do not use the `server-only` package.
- Do not inject or generate any `const { ... } = $.pine` or `const { ... } = $.data` code.
