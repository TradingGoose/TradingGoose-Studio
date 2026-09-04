# Documentation Generator

This directory contains scripts for generating and auditing TradingGoose documentation.

## Available Scripts

- `bun run docs:generate`: Generates all supported documentation from the repository root
- `bun run docs:generate:tools`: Generates tool documentation
- `bun run docs:generate:triggers`: Generates trigger documentation
- `bun run docs:audit`: Reports structural source-to-page coverage
- `create-e2b-pinets-template.ts`: Builds an E2B template with `pinets` preinstalled and prints the template ID

## E2B PineTS Template Script

Build a reusable E2B template for indicator/function execution without shipping PineTS bundle per run.

```bash
# Basic usage
E2B_API_KEY=... bun run e2b:template:pinets

# Custom alias/version
E2B_API_KEY=... bun run e2b:template:pinets -- --alias tradinggoose-pinets --pinets-version 0.8.8
```

The script prints `TEMPLATE_ID=<id>` after a successful build.

Use that value in app env:

```bash
E2B_INDICATOR_TEMPLATE_ID=<id>
```

## How It Works

The documentation generator:

1. Loads active blocks and triggers from the runtime registries
2. Loads provider tool contracts referenced by the registered blocks
3. Regenerates source-backed tool and trigger pages, including existing or empty pages
4. Creates only missing block and widget pages and updates each `meta.json`

## Running the Generator

To generate documentation manually:

```bash
# From the project root
bun run docs:generate
```

Generated documentation is reviewed and committed with the source changes that require it; the repository does not automatically generate and commit documentation from CI.

## Adding Support for New Block Properties

If you add new properties to block definitions that should be included in the documentation, update the relevant renderer in `scripts/doc-gen/`.

Tool pages and non-core registry-backed trigger pages are wholly generated and overwritten on every run. Put durable descriptions and instructions in their runtime contracts. Existing block and widget pages, plus the five hand-written core trigger pages, are preserved; missing block and widget pages are scaffolded from runtime contracts.
