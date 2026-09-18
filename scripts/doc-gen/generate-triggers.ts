import fs from 'fs'
import path from 'path'
import {
  findToolDocSlugForTriggerProvider,
  providerToDisplayName,
  providerToTriggerDocSlug,
} from './doc-pages'
import { renderTriggerPage } from './render-trigger-page'
import { getToolDocConfigs, getTriggerDocConfigs } from './runtime-metadata'
import type { GeneratorContext, TriggerConfig } from './types'
import { updateMetaJson } from './utils'

/** Regenerate every non-core provider trigger page from the runtime registry. */
export async function generateTriggerDocs(ctx: GeneratorContext) {
  console.log('\n⚡ Generating trigger docs...')

  const toolSlugs = new Set(getToolDocConfigs().map((config) => config.type))
  const byProvider = new Map<string, TriggerConfig[]>()
  for (const trigger of getTriggerDocConfigs()) {
    const triggers = byProvider.get(trigger.provider) ?? []
    triggers.push(trigger)
    byProvider.set(trigger.provider, triggers)
  }

  // All runtime imports and operation resolvers above complete before the first page write.
  for (const [provider, triggers] of byProvider) {
    const slug = providerToTriggerDocSlug(provider)
    const outputPath = path.join(ctx.docsOutputPath, `${slug}.mdx`)
    const relatedToolSlug = findToolDocSlugForTriggerProvider(provider, toolSlugs)
    const markdown = renderTriggerPage(
      provider,
      triggers,
      relatedToolSlug
        ? {
            title: 'Use as a Tool',
            href: `/tools/${relatedToolSlug}`,
            description: `See workflow actions, operations, and tool inputs for ${providerToDisplayName(provider)}.`,
          }
        : undefined
    )

    fs.writeFileSync(outputPath, markdown)
  }

  updateMetaJson(ctx.docsOutputPath)

  console.log(`  ✓ Generated ${byProvider.size} trigger pages`)
  return byProvider.size
}
