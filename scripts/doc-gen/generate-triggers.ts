import fs from 'fs'
import path from 'path'
import type { GeneratorContext } from './types'
import { collectGeneratedToolSlugs, findToolDocSlugForTriggerProvider, providerToTriggerDocSlug } from './doc-pages'
import { extractAllTriggers, type TriggerConfig } from './extract-triggers'
import { renderTriggerPage } from './render-trigger-page'
import { updateMetaJson } from './utils'

/** Load resolved outputs from the pre-generated JSON (built by resolve-trigger-outputs.ts) */
function loadResolvedOutputs(scriptDir: string): Record<string, Record<string, any>> {
  const filePath = path.join(scriptDir, 'resolved-trigger-outputs.json')
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  }
  return {}
}

/**
 * Generate documentation for all integration triggers.
 * Groups triggers by provider — one page per provider.
 */
export async function generateTriggerDocs(ctx: GeneratorContext) {
  console.log('\n⚡ Generating trigger docs...')

  const triggersDir = path.join(ctx.rootDir, 'apps/tradinggoose/triggers')
  const docsDir = path.join(ctx.rootDir, 'apps/docs/content/docs/en/triggers')
  const toolSlugs = collectGeneratedToolSlugs(ctx.blocksPath, ctx.rootDir)

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true })
  }

  const allTriggers = extractAllTriggers(triggersDir)

  // Merge resolved outputs (from direct import) for triggers with empty regex-extracted outputs
  const resolvedOutputs = loadResolvedOutputs(path.dirname(new URL(import.meta.url).pathname))
  for (const trigger of allTriggers) {
    if (Object.keys(trigger.outputs).length === 0 && resolvedOutputs[trigger.id]) {
      trigger.outputs = resolvedOutputs[trigger.id]
    }
  }

  // Group by provider
  const byProvider = new Map<string, TriggerConfig[]>()
  for (const trigger of allTriggers) {
    const list = byProvider.get(trigger.provider) || []
    list.push(trigger)
    byProvider.set(trigger.provider, list)
  }

  let generated = 0

  for (const [provider, triggers] of byProvider) {
    // Skip providers that already have hand-written docs (core triggers)
    const slug = providerToTriggerDocSlug(provider)
    const existingPath = path.join(docsDir, `${slug}.mdx`)
    const relatedToolSlug = findToolDocSlugForTriggerProvider(provider, toolSlugs)

    // Don't overwrite core trigger pages (api, chat, manual, webhook, schedule, input-form)
    const coreTriggers = new Set(['api', 'chat', 'manual', 'webhook', 'schedule', 'input-form'])
    if (coreTriggers.has(slug)) {
      continue
    }

    const content = renderTriggerPage(
      provider,
      triggers,
      relatedToolSlug
        ? {
            title: 'Use as a Tool',
            href: `/tools/${relatedToolSlug}`,
            description: `See workflow actions, operations, and tool inputs for ${toDisplayName(provider)}.`,
          }
        : undefined
    )
    fs.writeFileSync(existingPath, content)
    generated++
  }

  updateMetaJson(docsDir)

  console.log(`  ✓ Generated ${generated} trigger pages (${byProvider.size} providers total)`)
  return generated
}

function toDisplayName(provider: string): string {
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
