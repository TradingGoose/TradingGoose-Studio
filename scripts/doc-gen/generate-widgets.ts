import fs from 'fs'
import path from 'path'
import type { WidgetCatalogItem } from '../../apps/tradinggoose/widgets/widget-contract-types'
import { listWidgetCatalogItems } from '../../apps/tradinggoose/widgets/widget-contracts'
import type { GeneratorContext } from './types'
import { updateMetaJson } from './utils'

/** Create a contract-backed reference page for each undocumented runtime widget. */
export async function generateWidgetDocs(ctx: GeneratorContext) {
  console.log('\n🧩 Generating widget docs...')

  fs.mkdirSync(ctx.docsOutputPath, { recursive: true })
  const widgets = listWidgetCatalogItems()
  let generated = 0

  for (const widget of widgets) {
    const outputPath = path.join(ctx.docsOutputPath, `${widget.widgetKey.replace(/_/g, '-')}.mdx`)
    if (fs.existsSync(outputPath)) continue

    fs.writeFileSync(outputPath, renderWidgetPage(widget))
    generated++
  }

  updateMetaJson(ctx.docsOutputPath)

  console.log(`  ✓ Generated ${generated} widget pages (${widgets.length} total widgets)`)
  return generated
}

function renderWidgetPage(widget: WidgetCatalogItem): string {
  const category = widget.category.charAt(0).toUpperCase() + widget.category.slice(1)
  return `---
title: "${widget.title.replace(/"/g, '\\"')}"
description: "${widget.description.replace(/"/g, '\\"')}"
---

## Overview

| Property | Value |
|----------|-------|
| **Key** | \`${widget.widgetKey}\` |
| **Category** | ${category} |

${widget.description}

Add this widget from the dashboard widget picker. Its available actions and configuration depend on your workspace permissions and the selected dashboard context.
`
}
