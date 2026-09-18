import fs from 'fs'
import path from 'path'
import { findTriggerDocSlugForToolType, providerToTriggerDocSlug } from './doc-pages'
import { renderToolPage } from './render-tool-page'
import { getTriggerDocConfigs, loadToolDocSources } from './runtime-metadata'
import type { GeneratorContext } from './types'
import { updateMetaJson } from './utils'

/** Regenerate every integration tool page from its runtime block and tool contracts. */
export async function generateToolDocs(ctx: GeneratorContext) {
  console.log('\n📦 Generating integration tool docs...')

  // Resolve every source before writing so a bad mapping cannot leave a partial generation.
  const toolEntries = await loadToolDocSources(ctx.rootDir)
  const triggerSlugs = new Set(
    getTriggerDocConfigs().map((trigger) => providerToTriggerDocSlug(trigger.provider))
  )

  for (const { config, toolInfo, blockInfo } of toolEntries) {
    const outputPath = path.join(ctx.docsOutputPath, `${config.type}.mdx`)
    const relatedTriggerSlug = findTriggerDocSlugForToolType(config.type, triggerSlugs)
    const markdown = renderToolPage(
      config,
      toolInfo,
      relatedTriggerSlug
        ? {
            title: 'Use as a Trigger',
            href: `/triggers/${relatedTriggerSlug}`,
            description: `See trigger events, setup, and event payloads for ${config.name}.`,
          }
        : undefined,
      blockInfo
    )

    fs.writeFileSync(outputPath, markdown)
  }

  updateMetaJson(ctx.docsOutputPath)

  console.log(`  ✓ Generated ${toolEntries.length} tool pages`)
  return toolEntries.length
}
