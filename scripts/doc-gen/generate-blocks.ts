import fs from 'fs'
import path from 'path'
import { renderBlockPage } from './render-tool-page'
import { loadBlockDocSources } from './runtime-metadata'
import type { GeneratorContext } from './types'
import { updateMetaJson } from './utils'

/** Regenerate every runtime-backed block reference; preserve unrelated guides. */
export async function generateBlockDocs(ctx: GeneratorContext) {
  console.log('\n🧱 Generating built-in block docs...')
  const sources = await loadBlockDocSources(ctx.rootDir)
  const pages = sources.map(({ config, toolInfo }) => ({
    slug: config.type,
    content: renderBlockPage(config, toolInfo),
  }))

  fs.mkdirSync(ctx.docsOutputPath, { recursive: true })
  for (const { slug, content } of pages) {
    fs.writeFileSync(path.join(ctx.docsOutputPath, `${slug}.mdx`), content)
  }
  updateMetaJson(ctx.docsOutputPath)
  console.log(`  ✓ Generated ${pages.length} block pages`)
  return pages.length
}
