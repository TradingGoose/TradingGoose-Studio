import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import type { GeneratorContext } from './types'
import { findTriggerDocSlugForToolType, providerToTriggerDocSlug, shouldGenerateToolDoc } from './doc-pages'
import { extractBlockConfig } from './extract-blocks'
import { extractAllTriggers } from './extract-triggers'
import { getToolInfo } from './extract-tools'
import { renderToolPage } from './render-tool-page'
import { extractManualContent, mergeManualContent, updateMetaJson } from './utils'

/**
 * Generate documentation for all integration tool blocks.
 * Skips built-in blocks (category === 'blocks') and trigger-only blocks.
 */
export async function generateToolDocs(ctx: GeneratorContext) {
  console.log('\n📦 Generating integration tool docs...')

  const blockFiles = await glob(`${ctx.blocksPath}/*.ts`)
  const triggerSlugs = new Set(
    extractAllTriggers(path.join(ctx.rootDir, 'apps/tradinggoose/triggers')).map((trigger) =>
      providerToTriggerDocSlug(trigger.provider)
    )
  )
  const toolEntries: Array<{
    config: NonNullable<ReturnType<typeof extractBlockConfig>>
    outputPath: string
  }> = []
  let generated = 0
  let skipped = 0

  for (const blockFile of blockFiles) {
    const fileName = path.basename(blockFile, '.ts')
    if (fileName.endsWith('.test')) continue

    const fileContent = fs.readFileSync(blockFile, 'utf-8')
    const config = extractBlockConfig(fileContent, {
      includeTriggerDerivedSubBlocks: true,
      triggersPath: path.join(ctx.rootDir, 'apps/tradinggoose/triggers'),
    })

    if (!config || !config.type) {
      skipped++
      continue
    }

    const outputPath = path.join(ctx.docsOutputPath, `${config.type}.mdx`)

    if (!shouldGenerateToolDoc(config)) {
      if (fs.existsSync(outputPath)) {
        fs.rmSync(outputPath)
      }
      skipped++
      continue
    }

    toolEntries.push({ config, outputPath })
  }

  for (const { config, outputPath } of toolEntries) {
    const relatedTriggerSlug = findTriggerDocSlugForToolType(config.type, triggerSlugs)

    // Resolve tool info for each tool this block accesses
    const toolInfoMap = new Map()
    if (config.tools?.access) {
      for (const toolId of config.tools.access) {
        const info = await getToolInfo(toolId, ctx.toolsPath)
        if (info) toolInfoMap.set(toolId, info)
      }
    }

    // Generate page content
    const markdown = renderToolPage(
      config,
      toolInfoMap,
      relatedTriggerSlug
        ? {
            title: 'Use as a Trigger',
            href: `/triggers/${relatedTriggerSlug}`,
            description: `See trigger events, setup, and event payloads for ${config.name}.`,
          }
        : undefined
    )

    // Preserve manual content from existing file
    let finalContent = markdown

    if (fs.existsSync(outputPath)) {
      const existing = fs.readFileSync(outputPath, 'utf-8')
      const manualSections = extractManualContent(existing)
      if (Object.keys(manualSections).length > 0) {
        finalContent = mergeManualContent(markdown, manualSections)
      }
    }

    fs.writeFileSync(outputPath, finalContent)
    generated++
  }

  cleanupInvalidToolPages(ctx.docsOutputPath)
  updateMetaJson(ctx.docsOutputPath)

  console.log(`  ✓ Generated ${generated} tool pages (skipped ${skipped})`)
  return generated
}

function cleanupInvalidToolPages(docsOutputPath: string) {
  for (const entry of fs.readdirSync(docsOutputPath)) {
    if (!entry.endsWith('.mdx') || entry === 'index.mdx') continue

    const filePath = path.join(docsOutputPath, entry)
    const content = fs.readFileSync(filePath, 'utf-8')
    if (content.includes('- Category: `triggers`')) {
      fs.rmSync(filePath)
    }
  }
}
