#!/usr/bin/env ts-node
/**
 * Documentation Audit Script
 *
 * Scans the tradinggoose app source and compares against existing docs
 * to produce a gap report across 5 categories:
 *   1. Blocks (built-in workflow blocks)
 *   2. Tools (integration tool pages under /tools/)
 *   3. Indicators (technical analysis indicators)
 *   4. Widgets (dashboard UI components)
 *   5. Utilities (MCP / Skills / Custom Tools)
 *
 * Usage:
 *   bun run scripts/audit-docs.ts              # full report
 *   bun run scripts/audit-docs.ts --json       # machine-readable JSON
 *   bun run scripts/audit-docs.ts --category blocks   # single category
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAllBlocks } from '../apps/tradinggoose/blocks/registry'
import { providerToTriggerDocSlug } from './doc-gen/doc-pages'
import { getTriggerDocConfigs } from './doc-gen/runtime-metadata'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// ── Paths ────────────────────────────────────────────────────────────────────
const APP_ROOT = path.join(rootDir, 'apps/tradinggoose')
const DOCS_ROOT = path.join(rootDir, 'apps/docs/content/docs/en')

const PATHS = {
  blocks: path.join(APP_ROOT, 'blocks/blocks'),
  indicators: path.join(APP_ROOT, 'lib/indicators/default'),
  widgets: path.join(APP_ROOT, 'widgets/widgets'),
  triggers: path.join(APP_ROOT, 'triggers'),
  mcpLib: path.join(APP_ROOT, 'lib/mcp'),
  skillsLib: path.join(APP_ROOT, 'lib/skills'),
  customToolsLib: path.join(APP_ROOT, 'lib/custom-tools'),
}

const DOC_PATHS = {
  blocks: path.join(DOCS_ROOT, 'blocks'),
  tools: path.join(DOCS_ROOT, 'tools'),
  indicators: path.join(DOCS_ROOT, 'indicators'),
  widgets: path.join(DOCS_ROOT, 'widgets'),
  triggers: path.join(DOCS_ROOT, 'triggers'),
  utilities: path.join(DOCS_ROOT, 'utilities'),
}

// ── Types ────────────────────────────────────────────────────────────────────
interface SourceItem {
  id: string
  name: string
  description?: string
  /** Where the source file lives */
  sourcePath: string
}

interface DocItem {
  slug: string
  title: string
  filePath: string
}

interface CategoryAudit {
  category: string
  description: string
  source: SourceItem[]
  docs: DocItem[]
  missing: SourceItem[]
  orphaned: DocItem[]
  matched: Array<{ source: SourceItem; doc: DocItem }>
  coverage: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => {
      const full = path.join(dir, f)
      return fs.statSync(full).isDirectory()
    })
    .map((f) => path.join(dir, f))
}

function listMdxFiles(dir: string, includeIndex = false): DocItem[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mdx') && (includeIndex || f !== 'index.mdx'))
    .map((f) => {
      const filePath = path.join(dir, f)
      const slug = f.replace('.mdx', '')
      const content = fs.readFileSync(filePath, 'utf-8')
      const titleMatch = content.match(/^title:\s*(.+)$/m)
      return {
        slug,
        title: titleMatch ? titleMatch[1].replace(/['"]/g, '').trim() : slug,
        filePath,
      }
    })
}

function normalizeSlug(s: string): string {
  return s.toLowerCase().replace(/[-_\s]/g, '')
}

function matchSourceToDocs(
  sources: SourceItem[],
  docs: DocItem[]
): {
  missing: SourceItem[]
  orphaned: DocItem[]
  matched: Array<{ source: SourceItem; doc: DocItem }>
} {
  const matched: Array<{ source: SourceItem; doc: DocItem }> = []
  const usedDocs = new Set<string>()
  const unmatchedSources: SourceItem[] = []

  for (const src of sources) {
    const srcNorm = normalizeSlug(src.id)
    // Try exact normalized match first, then try matching source name (lowercased) against doc title
    const doc =
      docs.find((d) => normalizeSlug(d.slug) === srcNorm) ||
      docs.find((d) => normalizeSlug(d.title) === normalizeSlug(src.name))
    if (doc && !usedDocs.has(doc.slug)) {
      matched.push({ source: src, doc })
      usedDocs.add(doc.slug)
    } else {
      unmatchedSources.push(src)
    }
  }

  const orphaned = docs.filter((d) => !usedDocs.has(d.slug))

  return { missing: unmatchedSources, orphaned, matched }
}

// ── Scanners ─────────────────────────────────────────────────────────────────

function scanBlocks(): SourceItem[] {
  const items = getAllBlocks()
    .filter((block) => block.category === 'blocks' || block.type === 'evaluator')
    .map((block) => ({
      id: block.type,
      name: block.name,
      description: block.description,
      sourcePath: PATHS.blocks,
    }))

  for (const container of ['loop', 'parallel']) {
    const sourcePath = path.join(
      APP_ROOT,
      'executor/handlers',
      container,
      `${container}-handler.ts`
    )
    if (fs.existsSync(sourcePath)) {
      items.push({
        id: container,
        name: container[0].toUpperCase() + container.slice(1),
        description: '',
        sourcePath,
      })
    }
  }

  return items
}

function scanTools(): SourceItem[] {
  return getAllBlocks()
    .filter((block) => block.category === 'tools' && block.type !== 'evaluator')
    .map((block) => ({
      id: block.type,
      name: block.name,
      description: block.description,
      sourcePath: PATHS.blocks,
    }))
}

function scanIndicators(): SourceItem[] {
  // Indicators are a scripting platform, not individual doc pages.
  // We check for the expected guide pages in the indicators section.
  const expectedPages = [
    { id: 'index', name: 'Indicators Overview', description: 'Main overview page' },
    { id: 'getting-started', name: 'Getting Started', description: 'First indicator guide' },
    { id: 'syntax', name: 'Syntax Guide', description: 'PineTS syntax rules' },
    { id: 'inputs', name: 'Inputs', description: 'input.* namespace reference' },
    { id: 'data-series', name: 'Data Series', description: 'Built-in OHLCV, time, bar state' },
    { id: 'ta', name: 'Technical Analysis', description: 'ta.* functions reference' },
    { id: 'math', name: 'Math Functions', description: 'math.* functions reference' },
    { id: 'plots', name: 'Plotting', description: 'Plot functions and styles' },
    { id: 'data-structures', name: 'Data Structures', description: 'array, map, matrix, str' },
    { id: 'triggers', name: 'Indicator Triggers', description: 'trigger() API extension' },
    { id: 'api-reference', name: 'API Reference', description: 'Complete function table' },
  ]

  return expectedPages.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    sourcePath: path.join(PATHS.indicators, '..', '..', '..'), // points to lib/indicators parent
  }))
}

function scanWidgets(): SourceItem[] {
  const dir = path.join(APP_ROOT, 'widgets/widgets')
  if (!fs.existsSync(dir)) return []

  const dirs = listDirs(dir)
  const items: SourceItem[] = []

  for (const widgetDir of dirs) {
    const dirName = path.basename(widgetDir)
    if (dirName === 'components' || dirName === 'empty') continue

    // Skip sub-components that aren't standalone dashboard widgets
    const widgetIndex = path.join(widgetDir, 'index.tsx')
    if (
      !fs.existsSync(widgetIndex) ||
      !fs.readFileSync(widgetIndex, 'utf-8').includes('DashboardWidgetDefinition')
    )
      continue

    // Try to read index or component file for metadata
    const indexPath = path.join(widgetDir, 'index.tsx')
    const indexPath2 = path.join(widgetDir, 'index.ts')
    let name = dirName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

    for (const p of [indexPath, indexPath2]) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8')
        const nameMatch = content.match(/(?:title|name|label)\s*[:=]\s*['"]([^'"]+)['"]/)
        if (nameMatch) {
          name = nameMatch[1]
          break
        }
      }
    }

    items.push({ id: dirName, name, description: '', sourcePath: widgetDir })
  }

  const dashboardPath = path.join(APP_ROOT, 'app/workspace/[workspaceId]/dashboard')
  if (fs.existsSync(dashboardPath)) {
    items.push({
      id: 'dashboard-layouts',
      name: 'Dashboard Layouts',
      description: 'Dashboard layout management',
      sourcePath: dashboardPath,
    })
  }

  return items
}

function scanTriggers(): SourceItem[] {
  const blocksDir = path.join(PATHS.triggers, 'blocks')
  const items: SourceItem[] = [
    ['api', 'API Trigger', 'api_trigger.ts'],
    ['chat', 'Chat Trigger', 'chat_trigger.ts'],
    ['input-form', 'Input Form Trigger', 'input_trigger.ts'],
    ['manual', 'Manual Trigger', 'manual_trigger.ts'],
    ['webhook', 'Webhooks', 'generic_webhook.ts'],
  ].map(([id, name, file]) => ({
    id,
    name,
    description: '',
    sourcePath: path.join(blocksDir, file),
  }))

  const providers = new Map<string, string>()
  for (const trigger of getTriggerDocConfigs()) {
    const slug = providerToTriggerDocSlug(trigger.provider)
    if (!providers.has(slug)) providers.set(slug, trigger.name)
  }
  for (const [provider, name] of providers) {
    items.push({ id: provider, name, description: '', sourcePath: PATHS.triggers })
  }

  return items
}

function scanUtilities(): SourceItem[] {
  const items: SourceItem[] = []

  // MCP
  if (fs.existsSync(PATHS.mcpLib)) {
    items.push({
      id: 'mcp',
      name: 'MCP',
      description: 'Model Context Protocol integration',
      sourcePath: PATHS.mcpLib,
    })
  }

  // Skills
  if (fs.existsSync(PATHS.skillsLib)) {
    items.push({
      id: 'skills',
      name: 'Skills',
      description: 'Reusable skill definitions',
      sourcePath: PATHS.skillsLib,
    })
  }

  // Custom Tools
  if (fs.existsSync(PATHS.customToolsLib)) {
    items.push({
      id: 'custom-tools',
      name: 'Custom Tools',
      description: 'User-defined custom tools',
      sourcePath: PATHS.customToolsLib,
    })
  }

  return items
}

// ── Audit ────────────────────────────────────────────────────────────────────

function auditCategory(
  category: string,
  description: string,
  sources: SourceItem[],
  docPath: string,
  includeIndex = false
): CategoryAudit {
  const docs = listMdxFiles(docPath, includeIndex)
  const { missing, orphaned, matched } = matchSourceToDocs(sources, docs)
  const total = sources.length
  const covered = matched.length
  const coverage =
    total === 0 ? 'N/A' : `${covered}/${total} (${Math.round((covered / total) * 100)}%)`

  return { category, description, source: sources, docs, missing, orphaned, matched, coverage }
}

function runAudit(filterCategory?: string): CategoryAudit[] {
  const audits: CategoryAudit[] = []

  const categories: Array<{
    key: string
    label: string
    description: string
    scanner: () => SourceItem[]
    docPath: string
    includeIndex?: boolean
  }> = [
    {
      key: 'blocks',
      label: 'Built-in Blocks',
      description: 'Core workflow blocks (agent, condition, loop, etc.)',
      scanner: scanBlocks,
      docPath: DOC_PATHS.blocks,
    },
    {
      key: 'tools',
      label: 'Integration Tools',
      description: 'Third-party integration blocks (Slack, GitHub, etc.) documented under /tools/',
      scanner: scanTools,
      docPath: DOC_PATHS.tools,
    },
    {
      key: 'indicators',
      label: 'Indicators',
      description: 'PineTS scripting guides for the indicator platform',
      scanner: scanIndicators,
      docPath: DOC_PATHS.indicators,
      includeIndex: true,
    },
    {
      key: 'widgets',
      label: 'Widgets',
      description: 'Dashboard UI components',
      scanner: scanWidgets,
      docPath: DOC_PATHS.widgets,
    },
    {
      key: 'triggers',
      label: 'Triggers',
      description: 'Workflow trigger types (webhook, schedule, integration triggers)',
      scanner: scanTriggers,
      docPath: DOC_PATHS.triggers,
    },
    {
      key: 'utilities',
      label: 'Utilities (MCP / Skills / Custom Tools)',
      description: 'Extensibility features: MCP servers, reusable skills, custom tool definitions',
      scanner: scanUtilities,
      docPath: DOC_PATHS.utilities,
    },
  ]

  for (const cat of categories) {
    if (filterCategory && cat.key !== filterCategory) continue

    const sources = cat.scanner()
    audits.push(auditCategory(cat.label, cat.description, sources, cat.docPath, cat.includeIndex))
  }

  return audits
}

// ── Reporting ────────────────────────────────────────────────────────────────

function printReport(audits: CategoryAudit[]) {
  const RESET = '\x1b[0m'
  const BOLD = '\x1b[1m'
  const RED = '\x1b[31m'
  const GREEN = '\x1b[32m'
  const YELLOW = '\x1b[33m'
  const CYAN = '\x1b[36m'
  const DIM = '\x1b[2m'

  console.log('')
  console.log(`${BOLD}${'═'.repeat(70)}${RESET}`)
  console.log(`${BOLD}  DOCUMENTATION AUDIT REPORT${RESET}`)
  console.log(`${BOLD}${'═'.repeat(70)}${RESET}`)
  console.log('')

  // Summary table
  console.log(`${BOLD}  SUMMARY${RESET}`)
  console.log(`  ${'─'.repeat(66)}`)
  console.log(
    `  ${BOLD}${'Category'.padEnd(35)}${'Source'.padEnd(10)}${'Docs'.padEnd(10)}${'Missing'.padEnd(10)}Coverage${RESET}`
  )
  console.log(`  ${'─'.repeat(66)}`)

  let totalSource = 0
  let totalMissing = 0

  for (const audit of audits) {
    totalSource += audit.source.length
    totalMissing += audit.missing.length

    const missingColor = audit.missing.length > 0 ? RED : GREEN
    console.log(
      `  ${audit.category.padEnd(35)}${String(audit.source.length).padEnd(10)}${String(audit.docs.length).padEnd(10)}${missingColor}${String(audit.missing.length).padEnd(10)}${RESET}${audit.coverage}`
    )
  }

  console.log(`  ${'─'.repeat(66)}`)
  const totalCoverage =
    totalSource === 0
      ? 'N/A'
      : `${totalSource - totalMissing}/${totalSource} (${Math.round(((totalSource - totalMissing) / totalSource) * 100)}%)`
  console.log(
    `  ${BOLD}${'TOTAL'.padEnd(35)}${String(totalSource).padEnd(10)}${''.padEnd(10)}${RED}${String(totalMissing).padEnd(10)}${RESET}${BOLD}${totalCoverage}${RESET}`
  )
  console.log('')

  // Details per category
  for (const audit of audits) {
    console.log(`${BOLD}${CYAN}  ▸ ${audit.category}${RESET}`)
    console.log(`  ${DIM}${audit.description}${RESET}`)
    console.log('')

    if (audit.missing.length > 0) {
      console.log(`    ${RED}${BOLD}Missing (${audit.missing.length}):${RESET}`)
      for (const item of audit.missing) {
        const relPath = path.relative(rootDir, item.sourcePath)
        console.log(`    ${RED}✗${RESET} ${item.id.padEnd(30)} ${DIM}${item.name}${RESET}`)
        console.log(`      ${DIM}→ ${relPath}${RESET}`)
      }
      console.log('')
    }

    if (audit.orphaned.length > 0) {
      console.log(
        `    ${YELLOW}${BOLD}Orphaned docs (no matching source) (${audit.orphaned.length}):${RESET}`
      )
      for (const doc of audit.orphaned) {
        console.log(`    ${YELLOW}?${RESET} ${doc.slug.padEnd(30)} ${DIM}${doc.title}${RESET}`)
      }
      console.log('')
    }

    if (audit.matched.length > 0) {
      console.log(`    ${GREEN}${BOLD}Matched (${audit.matched.length}):${RESET}`)
      for (const m of audit.matched) {
        console.log(
          `    ${GREEN}✓${RESET} ${m.source.id.padEnd(30)} ${DIM}→ ${m.doc.slug}.mdx${RESET}`
        )
      }
      console.log('')
    }

    console.log('')
  }
}

function printJson(audits: CategoryAudit[]) {
  const output = audits.map((a) => ({
    category: a.category,
    description: a.description,
    coverage: a.coverage,
    sourceCount: a.source.length,
    docsCount: a.docs.length,
    missingCount: a.missing.length,
    orphanedCount: a.orphaned.length,
    missing: a.missing.map((m) => ({ id: m.id, name: m.name })),
    orphaned: a.orphaned.map((o) => ({ slug: o.slug, title: o.title })),
    matched: a.matched.map((m) => ({ sourceId: m.source.id, docSlug: m.doc.slug })),
  }))
  console.log(JSON.stringify(output, null, 2))
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const categoryIdx = args.indexOf('--category')
const filterCategory = categoryIdx >= 0 ? args[categoryIdx + 1] : undefined

const audits = runAudit(filterCategory)

if (jsonMode) {
  printJson(audits)
} else {
  printReport(audits)
}
