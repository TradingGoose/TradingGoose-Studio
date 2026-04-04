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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// ── Paths ────────────────────────────────────────────────────────────────────
const APP_ROOT = path.join(rootDir, 'apps/tradinggoose')
const DOCS_ROOT = path.join(rootDir, 'apps/docs/content/docs/en')

const PATHS = {
  blocks: path.join(APP_ROOT, 'blocks/blocks'),
  tools: path.join(APP_ROOT, 'tools'),
  indicators: path.join(APP_ROOT, 'lib/indicators/default'),
  widgets: path.join(APP_ROOT, 'widgets/widgets'),
  triggers: path.join(APP_ROOT, 'triggers'),
  mcpLib: path.join(APP_ROOT, 'lib/mcp'),
  skillsStore: path.join(APP_ROOT, 'stores/skills'),
  customToolWidget: path.join(APP_ROOT, 'widgets/widgets/editor_custom_tool'),
}

const DOC_PATHS = {
  blocks: path.join(DOCS_ROOT, 'blocks'),
  tools: path.join(DOCS_ROOT, 'tools'),
  indicators: path.join(DOCS_ROOT, 'indicators'),
  widgets: path.join(DOCS_ROOT, 'widgets'),
  triggers: path.join(DOCS_ROOT, 'triggers'),
  mcp: path.join(DOCS_ROOT, 'utilities'),
  skills: path.join(DOCS_ROOT, 'utilities'),
  customTools: path.join(DOCS_ROOT, 'utilities'),
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

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts' && f !== 'types.ts' && f !== 'runtime.ts')
    .map((f) => path.join(dir, f))
}

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

function extractStringProp(content: string, prop: string): string | null {
  const m =
    content.match(new RegExp(`${prop}\\s*:\\s*'([^']*)'`)) ||
    content.match(new RegExp(`${prop}\\s*:\\s*"([^"]*)"`)) ||
    content.match(new RegExp(`${prop}\\s*:\\s*\`([^\`]*)\``))
  return m ? m[1].replace(/\s+/g, ' ').trim() : null
}

function normalizeSlug(s: string): string {
  return s.toLowerCase().replace(/[-_\s]/g, '')
}

function matchSourceToDocs(
  sources: SourceItem[],
  docs: DocItem[]
): { missing: SourceItem[]; orphaned: DocItem[]; matched: Array<{ source: SourceItem; doc: DocItem }> } {
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
    } else if (!doc) {
      unmatchedSources.push(src)
    }
  }

  const orphaned = docs.filter((d) => !usedDocs.has(d.slug))

  return { missing: unmatchedSources, orphaned, matched }
}

// ── Scanners ─────────────────────────────────────────────────────────────────

function scanBlocks(): SourceItem[] {
  const dir = PATHS.blocks
  if (!fs.existsSync(dir)) return []

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  const items: SourceItem[] = []

  // Categories that are "built-in blocks" (not integration tools)
  const builtInTypes = new Set([
    'agent', 'api', 'condition', 'evaluator', 'function', 'guardrails',
    'loop', 'parallel', 'response', 'router', 'variables', 'wait',
    'workflow', 'workflow_input', 'note', 'human_in_the_loop',
  ])

  for (const file of files) {
    const id = file.replace('.ts', '')
    if (!builtInTypes.has(id)) continue

    const content = fs.readFileSync(path.join(dir, file), 'utf-8')
    const name = extractStringProp(content, 'name') || id
    const description = extractStringProp(content, 'description') || ''
    items.push({ id, name, description, sourcePath: path.join(dir, file) })
  }

  return items
}

function scanTools(): SourceItem[] {
  const dir = PATHS.blocks
  if (!fs.existsSync(dir)) return []

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  const builtInTypes = new Set([
    'agent', 'api', 'condition', 'evaluator', 'function', 'guardrails',
    'loop', 'parallel', 'response', 'router', 'variables', 'wait',
    'workflow', 'workflow_input', 'note', 'human_in_the_loop',
  ])

  const items: SourceItem[] = []

  for (const file of files) {
    const id = file.replace('.ts', '')
    if (builtInTypes.has(id)) continue

    const content = fs.readFileSync(path.join(dir, file), 'utf-8')

    // Skip trigger-only blocks
    const type = extractStringProp(content, 'type') || id
    if (type.includes('_trigger') || type.includes('_webhook')) continue

    const name = extractStringProp(content, 'name') || id
    const description = extractStringProp(content, 'description') || ''
    items.push({ id, name, description, sourcePath: path.join(dir, file) })
  }

  return items
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
    sourcePath: path.join(PATHS.indicators, '..', '..', '..'),  // points to lib/indicators parent
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
    if (!fs.existsSync(widgetIndex) || !fs.readFileSync(widgetIndex, 'utf-8').includes('DashboardWidgetDefinition')) continue

    // Skip list widgets that are documented within their editor page
    const listMergedIntoEditor = new Set(['list_indicator', 'list_skill', 'list_mcp', 'list_custom_tool'])
    if (listMergedIntoEditor.has(dirName)) continue

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

  return items
}

function scanTriggers(): SourceItem[] {
  const dir = PATHS.triggers
  if (!fs.existsSync(dir)) return []

  const items: SourceItem[] = []

  // 1. Core trigger types from triggers/blocks/ (the fundamental trigger types)
  const coreBlockTriggers: Record<string, string> = {
    api_trigger: 'API Trigger',
    chat_trigger: 'Chat Trigger',
    manual_trigger: 'Manual Trigger',
    input_trigger: 'Input Form Trigger',
    generic_webhook: 'Webhooks',
    schedule: 'Schedule',
  }

  const blocksDir = path.join(dir, 'blocks')
  if (fs.existsSync(blocksDir)) {
    for (const [file, name] of Object.entries(coreBlockTriggers)) {
      const fullPath = path.join(blocksDir, `${file}.ts`)
      if (fs.existsSync(fullPath)) {
        // Map to the doc slug convention
        const slugMap: Record<string, string> = {
          api_trigger: 'api',
          chat_trigger: 'chat',
          manual_trigger: 'manual',
          input_trigger: 'input-form',
          generic_webhook: 'webhook',
          schedule: 'schedule',
        }
        items.push({ id: slugMap[file] || file, name, description: '', sourcePath: fullPath })
      }
    }
  }

  // 2. Integration triggers from individual directories
  const triggerDirs = fs
    .readdirSync(dir)
    .filter((f) => {
      const full = path.join(dir, f)
      return fs.statSync(full).isDirectory() && !['blocks', 'core'].includes(f)
    })

  for (const triggerDir of triggerDirs) {
    const fullPath = path.join(dir, triggerDir)
    let name = triggerDir.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

    const indexPath = path.join(fullPath, 'index.ts')
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8')
      const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/)
      if (nameMatch) name = nameMatch[1]
    }

    items.push({ id: triggerDir, name, description: '', sourcePath: fullPath })
  }

  return items
}

type UtilitySubCategory = 'mcp' | 'skills' | 'custom-tools'

interface UtilityItem extends SourceItem {
  subCategory: UtilitySubCategory
}

function scanUtilities(): UtilityItem[] {
  const items: UtilityItem[] = []

  // MCP
  if (fs.existsSync(PATHS.mcpLib)) {
    items.push({
      id: 'mcp-overview',
      name: 'MCP Overview',
      description: 'Model Context Protocol integration',
      sourcePath: PATHS.mcpLib,
      subCategory: 'mcp',
    })
  }

  // Skills
  if (fs.existsSync(PATHS.skillsStore)) {
    items.push({
      id: 'skills-overview',
      name: 'Skills Overview',
      description: 'Reusable skill definitions',
      sourcePath: PATHS.skillsStore,
      subCategory: 'skills',
    })
  }

  // Custom Tools
  if (fs.existsSync(PATHS.customToolWidget)) {
    items.push({
      id: 'custom-tools-overview',
      name: 'Custom Tools Overview',
      description: 'User-defined custom tools',
      sourcePath: PATHS.customToolWidget,
      subCategory: 'custom-tools',
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
  const coverage = total === 0 ? 'N/A' : `${covered}/${total} (${Math.round((covered / total) * 100)}%)`

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
      docPath: '', // checked individually below
    },
  ]

  for (const cat of categories) {
    if (filterCategory && cat.key !== filterCategory) continue

    if (cat.key === 'utilities') {
      // Special handling: check each sub-category against its own doc path
      const utilItems = scanUtilities()
      const subCats: Record<UtilitySubCategory, { docPath: string; label: string }> = {
        mcp: { docPath: DOC_PATHS.mcp, label: 'MCP' },
        skills: { docPath: DOC_PATHS.skills, label: 'Skills' },
        'custom-tools': { docPath: DOC_PATHS.customTools, label: 'Custom Tools' },
      }

      const allSources: SourceItem[] = []
      const allDocs: DocItem[] = []
      const allMissing: SourceItem[] = []
      const allOrphaned: DocItem[] = []
      const allMatched: Array<{ source: SourceItem; doc: DocItem }> = []

      for (const [subKey, subCat] of Object.entries(subCats)) {
        const subSources = utilItems.filter((u) => u.subCategory === subKey)
        const subDocs = listMdxFiles(subCat.docPath)
        const hasIndexDoc = fs.existsSync(path.join(subCat.docPath, 'index.mdx'))
        const docExists = subDocs.length > 0 || hasIndexDoc

        allSources.push(...subSources)
        allDocs.push(...subDocs)

        if (!docExists) {
          allMissing.push(...subSources)
        } else {
          for (const src of subSources) {
            allMatched.push({ source: src, doc: subDocs[0] || { slug: 'index', title: subCat.label, filePath: path.join(subCat.docPath, 'index.mdx') } })
          }
        }
      }

      const total = allSources.length
      const covered = allMatched.length
      const coverage = total === 0 ? 'N/A' : `${covered}/${total} (${Math.round((covered / total) * 100)}%)`

      audits.push({
        category: cat.label,
        description: cat.description,
        source: allSources,
        docs: allDocs,
        missing: allMissing,
        orphaned: allOrphaned,
        matched: allMatched,
        coverage,
      })
      continue
    }

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
  console.log(`  ${BOLD}${'Category'.padEnd(35)}${'Source'.padEnd(10)}${'Docs'.padEnd(10)}${'Missing'.padEnd(10)}Coverage${RESET}`)
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
  const totalCoverage = totalSource === 0 ? 'N/A' : `${totalSource - totalMissing}/${totalSource} (${Math.round(((totalSource - totalMissing) / totalSource) * 100)}%)`
  console.log(`  ${BOLD}${'TOTAL'.padEnd(35)}${String(totalSource).padEnd(10)}${''.padEnd(10)}${RED}${String(totalMissing).padEnd(10)}${RESET}${BOLD}${totalCoverage}${RESET}`)
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
      console.log(`    ${YELLOW}${BOLD}Orphaned docs (no matching source) (${audit.orphaned.length}):${RESET}`)
      for (const doc of audit.orphaned) {
        console.log(`    ${YELLOW}?${RESET} ${doc.slug.padEnd(30)} ${DIM}${doc.title}${RESET}`)
      }
      console.log('')
    }

    if (audit.matched.length > 0) {
      console.log(`    ${GREEN}${BOLD}Matched (${audit.matched.length}):${RESET}`)
      for (const m of audit.matched) {
        console.log(`    ${GREEN}✓${RESET} ${m.source.id.padEnd(30)} ${DIM}→ ${m.doc.slug}.mdx${RESET}`)
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
