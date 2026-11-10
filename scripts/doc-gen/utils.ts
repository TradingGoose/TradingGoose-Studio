import fs from 'fs'
import type { SubBlockCondition } from '../../apps/tradinggoose/blocks/types'

// ── Markdown escaping ─────────────────────────────────────────────

export function escapeMdx(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function describeVisibilityCondition(
  condition: SubBlockCondition,
  resolvedField?: string
): string | undefined {
  const conditions = collectConditions(condition).filter(({ field }) => field !== resolvedField)

  return conditions.length > 0 ? conditions.map(describeCondition).join(' and ') : undefined
}

export function collectConditions(condition: SubBlockCondition): SubBlockCondition[] {
  const nested = condition.and
    ? (Array.isArray(condition.and) ? condition.and : [condition.and]).flatMap(collectConditions)
    : []
  return [condition, ...nested]
}

function describeCondition(condition: SubBlockCondition): string {
  if (condition.operator === 'modelCapability') {
    const capability = condition.value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    return `${condition.field} ${condition.not ? 'does not support' : 'supports'} ${capability}`
  }
  const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
    (value) => `'${String(value)}'`
  )
  if (values.length === 0) return `applicable to the selected ${condition.field} at runtime`
  if (values.length === 1) {
    return `${condition.field} is${condition.not ? ' not' : ''} ${values[0]}`
  }
  if (condition.not) return `${condition.field} is none of ${values.join(', ')}`
  return `${condition.field} is one of ${values.join(', ')}`
}

export function appendSentence(description: string | undefined, sentence: string): string {
  const existing = description?.trim()
  if (!existing) return sentence
  return `${existing}${/[.!?]$/.test(existing) ? '' : '.'} ${sentence}`
}

// ── Meta.json updater ─────────────────────────────────────────────

export function updateMetaJson(docsDir: string) {
  const metaJsonPath = `${docsDir}/meta.json`
  const pageNames = fs
    .readdirSync(docsDir)
    .filter((f: string) => f.endsWith('.mdx'))
    .map((f: string) => f.replace('.mdx', ''))
  const pageSet = new Set(pageNames)
  const existing = fs.existsSync(metaJsonPath)
    ? (JSON.parse(fs.readFileSync(metaJsonPath, 'utf-8')) as Record<string, unknown>)
    : {}
  const existingPages = Array.isArray(existing.pages)
    ? existing.pages.filter((page): page is string => typeof page === 'string')
    : []
  const retainedPages = existingPages.filter((page, index) => {
    return pageSet.has(page) && existingPages.indexOf(page) === index
  })
  const retainedSet = new Set(retainedPages)
  const newPages = pageNames.filter((page) => !retainedSet.has(page)).sort()

  const pages = [...retainedPages, ...newPages]
  const index = pages.indexOf('index')
  if (index > 0) pages.unshift(...pages.splice(index, 1))

  fs.writeFileSync(metaJsonPath, `${JSON.stringify({ ...existing, pages }, null, 2)}\n`)
}
