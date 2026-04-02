import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import type { GeneratorContext } from './types'
import { extractIcons } from './extract-icons'
import { extractBlockConfig } from './extract-blocks'
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
  let generated = 0
  let skipped = 0

  for (const blockFile of blockFiles) {
    const fileName = path.basename(blockFile, '.ts')
    if (fileName.endsWith('.test')) continue

    const fileContent = fs.readFileSync(blockFile, 'utf-8')
    const config = extractBlockConfig(fileContent)

    if (!config || !config.type) {
      skipped++
      continue
    }

    // Skip triggers and webhooks
    if (config.type.includes('_trigger') || config.type.includes('_webhook')) {
      skipped++
      continue
    }

    // Skip built-in blocks (except memory/knowledge which live in tools)
    if (
      (config.category === 'blocks' &&
        config.type !== 'memory' &&
        config.type !== 'knowledge') ||
      config.type === 'evaluator' ||
      config.type === 'number'
    ) {
      skipped++
      continue
    }

    // Resolve tool info for each tool this block accesses
    const toolInfoMap = new Map()
    if (config.tools?.access) {
      for (const toolId of config.tools.access) {
        const info = await getToolInfo(toolId, ctx.toolsPath)
        if (info) toolInfoMap.set(toolId, info)
      }
    }

    // Generate page content
    const markdown = renderToolPage(config, ctx.icons, toolInfoMap)

    // Preserve manual content from existing file
    const outputPath = path.join(ctx.docsOutputPath, `${config.type}.mdx`)
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

  updateMetaJson(ctx.docsOutputPath)

  console.log(`  ✓ Generated ${generated} tool pages (skipped ${skipped})`)
  return generated
}
