#!/usr/bin/env bun
/**
 * Documentation Generator — Orchestrator
 *
 * Runs all doc generators in sequence. Each generator is a focused module
 * that handles one category of documentation.
 *
 * Usage:
 *   bun run scripts/doc-gen/index.ts              # Run all generators
 *   bun run scripts/doc-gen/index.ts tools        # Run only tools generator
 *   bun run scripts/doc-gen/index.ts triggers     # Run only triggers generator
 *   bun run scripts/doc-gen/index.ts widgets      # Run only widgets generator
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { generateBlockDocs } from './generate-blocks'
import { generateToolDocs } from './generate-tools'
import { generateTriggerDocs } from './generate-triggers'
import { generateWidgetDocs } from './generate-widgets'
import type { GeneratorContext } from './types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..', '..')

// ── Paths ─────────────────────────────────────────────────────────

const DOCS_ROOT = path.join(rootDir, 'apps/docs/content/docs/en')

// ── Available generators ──────────────────────────────────────────

type GeneratorFn = (ctx: GeneratorContext) => Promise<number>

const generators: Record<string, { label: string; run: GeneratorFn; docsSubdir: string }> = {
  blocks: {
    label: 'Built-in Blocks',
    run: generateBlockDocs,
    docsSubdir: 'blocks',
  },
  tools: {
    label: 'Integration Tools',
    run: generateToolDocs,
    docsSubdir: 'tools',
  },
  triggers: {
    label: 'Triggers',
    run: generateTriggerDocs,
    docsSubdir: 'triggers',
  },
  widgets: {
    label: 'Widgets',
    run: generateWidgetDocs,
    docsSubdir: 'widgets',
  },
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const filter = args.length > 0 ? args : Object.keys(generators)

  console.log('🚀 TradingGoose Documentation Generator')
  console.log(`   Root: ${rootDir}`)
  console.log('')

  let totalGenerated = 0

  for (const key of filter) {
    const gen = generators[key]
    if (!gen) {
      console.error(
        `❌ Unknown generator: "${key}". Available: ${Object.keys(generators).join(', ')}`
      )
      process.exit(1)
    }

    const docsOutputPath = path.join(DOCS_ROOT, gen.docsSubdir)
    if (!fs.existsSync(docsOutputPath)) {
      fs.mkdirSync(docsOutputPath, { recursive: true })
    }

    const ctx: GeneratorContext = {
      rootDir,
      docsOutputPath,
    }

    const count = await gen.run(ctx)
    totalGenerated += count
  }

  console.log('')
  console.log(`✅ Done — generated ${totalGenerated} pages total`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
