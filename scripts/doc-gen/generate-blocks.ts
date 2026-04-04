import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import type { GeneratorContext } from './types'
import { extractBlockConfig } from './extract-blocks'
import { updateMetaJson } from './utils'

/**
 * Generate documentation for built-in blocks that don't have hand-written pages.
 * Only generates pages for blocks with category='blocks' that are missing from docs.
 */
export async function generateBlockDocs(ctx: GeneratorContext) {
  console.log('\n🧱 Generating built-in block docs...')

  const docsDir = path.join(ctx.rootDir, 'apps/docs/content/docs/en/blocks')

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true })
  }

  const blockFiles = await glob(`${ctx.blocksPath}/*.ts`)
  let generated = 0

  for (const blockFile of blockFiles) {
    const fileName = path.basename(blockFile, '.ts')
    if (fileName.endsWith('.test')) continue

    const fileContent = fs.readFileSync(blockFile, 'utf-8')
    const config = extractBlockConfig(fileContent)

    if (!config || config.category !== 'blocks') continue

    // Skip blocks that already have hand-written docs
    const slug = config.type
    const outputPath = path.join(docsDir, `${slug}.mdx`)
    if (fs.existsSync(outputPath)) continue

    // Build the page
    const subBlocksJson = JSON.stringify(config.subBlocks || [], null, 4)
      .split('\n')
      .map((l, i) => (i === 0 ? l : `    ${l}`))
      .join('\n')

    const content = `---
title: ${config.name}
description: ${config.description}
---

import { BlockInfoCard } from "@/components/ui/block-info-card"
import { BlockConfigPreview } from "@/components/ui/block-config-preview"
import { ShowcaseCard } from "@/components/ui/showcase-card"

<BlockInfoCard
  type="${config.type}"
  color="${config.bgColor || ''}"
/>

${config.description}

${config.longDescription ? `## Usage\n\n${config.longDescription}\n` : ''}
${
  config.subBlocks && config.subBlocks.length > 0
    ? `## Configuration

<ShowcaseCard>
  <BlockConfigPreview
    name="${config.name}"
    type="${config.type}"
    color="${config.bgColor || ''}"
    hideHeader
    subBlocks={${subBlocksJson}}
  />
</ShowcaseCard>
`
    : ''
}
## Notes

- Category: \`${config.category}\`
- Type: \`${config.type}\`
`

    fs.writeFileSync(outputPath, content)
    generated++
  }

  updateMetaJson(docsDir)

  console.log(`  ✓ Generated ${generated} block pages`)
  return generated
}
