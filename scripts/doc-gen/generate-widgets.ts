import fs from 'fs'
import path from 'path'
import type { GeneratorContext } from './types'
import { updateMetaJson } from './utils'

interface WidgetInfo {
  key: string
  name: string
  description: string
  category: 'Editor' | 'List' | 'Utility' | 'Data' | 'Extension'
}

/**
 * Generate documentation for all widget types.
 */
export async function generateWidgetDocs(ctx: GeneratorContext) {
  console.log('\n🧩 Generating widget docs...')

  const widgetsDir = path.join(ctx.rootDir, 'apps/tradinggoose/widgets/widgets')
  const docsDir = path.join(ctx.rootDir, 'apps/docs/content/docs/en/widgets')

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true })
  }

  const widgets = scanWidgets(widgetsDir)
  let generated = 0

  for (const widget of widgets) {
    const slug = widget.key.replace(/_/g, '-')
    const outputPath = path.join(docsDir, `${slug}.mdx`)

    // Skip existing hand-written pages
    if (fs.existsSync(outputPath)) continue

    const content = renderWidgetPage(widget)
    fs.writeFileSync(outputPath, content)
    generated++
  }

  updateMetaJson(docsDir)

  console.log(`  ✓ Generated ${generated} widget pages (${widgets.length} total widgets)`)
  return generated
}

function scanWidgets(widgetsDir: string): WidgetInfo[] {
  if (!fs.existsSync(widgetsDir)) return []

  const dirs = fs.readdirSync(widgetsDir).filter((d) => {
    const full = path.join(widgetsDir, d)
    return fs.statSync(full).isDirectory() && !['components', 'empty'].includes(d)
  })

  const widgets: WidgetInfo[] = []

  for (const dir of dirs) {
    const fullDir = path.join(widgetsDir, dir)

    // Extract from DashboardWidgetDefinition export
    let name = dir.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    let description = ''

    const indexPath = path.join(fullDir, 'index.tsx')
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8')
      // Find DashboardWidgetDefinition block and extract title/description
      const defMatch = content.match(/DashboardWidgetDefinition\s*=\s*\{([\s\S]*?)\n\}/)
      if (defMatch) {
        const block = defMatch[1]
        const titleMatch = block.match(/title\s*:\s*['"]([^'"]+)['"]/)
        const descMatch = block.match(/description\s*:\s*['"]([^'"]+)['"]/)
        if (titleMatch) name = titleMatch[1]
        if (descMatch) description = descMatch[1]
      }
    }

    // Determine category
    let category: WidgetInfo['category'] = 'Utility'
    if (dir.startsWith('editor_')) category = 'Editor'
    else if (dir.startsWith('list_')) category = 'List'
    else if (['data_chart', 'watchlist'].includes(dir)) category = 'Data'
    else if (['mcp', 'skill', 'custom_tool'].includes(dir)) category = 'Extension'
    else if (dir.startsWith('workflow_')) category = 'Utility'

    // Skip sub-components that aren't standalone dashboard widgets
    if (!fs.existsSync(indexPath) || !fs.readFileSync(indexPath, 'utf-8').includes('DashboardWidgetDefinition')) {
      continue
    }

    widgets.push({ key: dir, name, description, category })
  }

  return widgets
}

function renderWidgetPage(widget: WidgetInfo): string {
  const { key, name, description, category } = widget

  // Feature guide cross-references
  const featureGuideMap: Record<string, { path: string; label: string }> = {
    editor_skill: { path: '/docs/en/utilities/skills', label: 'Skills' },
    list_skill: { path: '/docs/en/utilities/skills', label: 'Skills' },
    editor_mcp: { path: '/docs/en/utilities/mcp', label: 'MCP' },
    list_mcp: { path: '/docs/en/utilities/mcp', label: 'MCP' },
    editor_custom_tool: { path: '/docs/en/utilities/custom-tools', label: 'Custom Tools' },
    list_custom_tool: { path: '/docs/en/utilities/custom-tools', label: 'Custom Tools' },
    copilot: { path: '/copilot', label: 'Copilot' },
  }
  const featureGuide = featureGuideMap[key]

  // Determine what this widget does based on naming patterns
  let overview = description || `The ${name} widget provides a ${category.toLowerCase()}-level interface in your workspace.`
  let features = ''
  let usage = ''

  if (key.startsWith('editor_')) {
    const entity = key.replace('editor_', '').replace(/_/g, ' ')
    overview = description || `The ${name} widget provides a full editing interface for creating and modifying ${entity}s.`
    features = `- **Visual Editor**: Intuitive interface for building ${entity}s
- **Real-time Preview**: See changes as you make them
- **Save & Deploy**: Save ${entity}s to your workspace`
    usage = `Add this widget to your workspace to create and edit ${entity}s. It pairs with the ${entity.charAt(0).toUpperCase() + entity.slice(1)} List widget.`
  } else if (key.startsWith('list_')) {
    const entity = key.replace('list_', '').replace(/_/g, ' ')
    overview = description || `The ${name} widget displays a browseable list of all ${entity}s in your workspace.`
    features = `- **Browse**: View all ${entity}s in your workspace
- **Search & Filter**: Find ${entity}s quickly
- **Create New**: Start a new ${entity} directly from the list
- **Open in Editor**: Click to open any ${entity} in the editor widget`
    usage = `Add this widget alongside the ${entity.charAt(0).toUpperCase() + entity.slice(1)} Editor to manage your ${entity}s.`
  } else if (key === 'data_chart') {
    overview = 'The Data Chart widget renders OHLCV market data as interactive candlestick charts with technical indicator overlays.'
    features = `- **Candlestick Charts**: Display OHLCV price data
- **Indicator Overlays**: Apply technical indicators from your workspace
- **Multiple Timeframes**: Switch between different chart intervals
- **Interactive**: Zoom, pan, and inspect individual candles`
    usage = 'Add this widget to visualize market data. It pairs with the Watchlist widget for symbol selection.'
  } else if (key === 'watchlist') {
    overview = 'The Watchlist widget lets you manage symbol watchlists with live market data columns.'
    features = `- **Symbol Management**: Add and remove trading symbols
- **Live Data**: Real-time price columns
- **Quick Selection**: Click a symbol to load it in the Data Chart
- **Custom Columns**: Configure which market data to display`
    usage = 'Add this widget alongside the Data Chart for a complete market monitoring setup.'
  } else if (key === 'mcp') {
    overview = 'The MCP widget displays information about configured MCP (Model Context Protocol) servers and their available tools.'
    features = `- **Server Status**: View connected MCP servers
- **Tool Discovery**: Browse available tools from each server
- **Configuration**: Quick access to server settings`
  } else if (key === 'skill') {
    overview = 'The Skill widget displays a reusable skill definition that can be used by Agent blocks in workflows.'
    features = `- **Skill Preview**: View skill content and configuration
- **Quick Edit**: Open the skill in the editor
- **Usage Info**: See which workflows reference this skill`
  } else if (key === 'custom_tool') {
    overview = 'The Custom Tool widget displays a user-defined custom tool that extends the platform capabilities.'
    features = `- **Tool Preview**: View tool schema and configuration
- **Quick Edit**: Open the tool in the editor
- **Usage Info**: See which workflows use this tool`
  }

  return `---
title: "${name}"
description: "${overview.replace(/"/g, '\\"')}"
---

import { Callout } from 'fumadocs-ui/components/callout'

## Overview

| Property | Value |
|----------|-------|
| **Key** | \`${key}\` |
| **Category** | ${category} |

${overview}

## Features

${features || `- Integrated workspace component for ${name.toLowerCase()} management`}

## Usage

${usage || `Add the ${name} widget to your workspace from the widget picker.`}

${category === 'Editor' ? `<Callout>
This widget supports the **pairColor** mechanism. Pair it with the corresponding List widget to stay in sync.
</Callout>` : ''}
${featureGuide ? `
## Learn More

For a complete guide on this feature, see **[${featureGuide.label}](${featureGuide.path})**.
` : ''}
`
}
