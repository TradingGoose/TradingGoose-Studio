import type { BlockConfig, DocSubBlock, RelatedDocPage, ToolInfo } from './types'
import { escapeMdx } from './utils'

/**
 * Render MDX content for an integration tool page.
 */
export function renderToolPage(
  blockConfig: BlockConfig,
  toolInfoMap: Map<string, ToolInfo>,
  relatedDocPage?: RelatedDocPage
): string {
  const {
    type,
    name,
    description,
    longDescription,
    category,
    bgColor,
    outputs = {},
    tools = { access: [] },
    subBlocks = [],
    operationToolMap,
  } = blockConfig

  // Detect operation-based blocks
  const { operationField, operationFieldId } = detectOperationField(subBlocks)
  const isTabbed = operationField && operationField.options && operationField.options.length > 1

  // Build operation label map
  const opLabelMap = new Map<string, string>()
  if (operationField?.options) {
    for (const opt of operationField.options) opLabelMap.set(opt.id, opt.label)
  }

  // Usage instructions
  const usageSection = longDescription ? `## Usage Instructions\n\n${longDescription}\n\n` : ''

  let body: string
  if (isTabbed) {
    body = buildTabbedBody(
      name,
      type,
      bgColor,
      subBlocks,
      operationField!,
      operationFieldId,
      operationToolMap || {},
      opLabelMap,
      toolInfoMap,
      outputs
    )
  } else {
    body = buildSimpleBody(name, type, bgColor, subBlocks, tools, toolInfoMap, outputs)
  }

  return `---
title: ${name}
description: ${description}
---

import { BlockInfoCard } from "@/components/ui/block-info-card"
import { BlockConfigPreview } from "@/components/ui/block-config-preview"
import { ShowcaseCard } from "@/components/ui/showcase-card"
${relatedDocPage ? `import { Card, Cards } from 'fumadocs-ui/components/card'` : ''}

<BlockInfoCard
  type="${type}"
  color="${bgColor || ''}"
/>

${renderRelatedDocCard(relatedDocPage)}
${body}
${usageSection}

## Notes

- Category: \`${category}\`
- Type: \`${type}\`
`
}

function renderRelatedDocCard(relatedDocPage?: RelatedDocPage): string {
  if (!relatedDocPage) return ''

  return `<Cards>
  <Card title="${relatedDocPage.title}" href="${relatedDocPage.href}">
    ${relatedDocPage.description}
  </Card>
</Cards>

`
}

// ── Simple (non-tabbed) body ──────────────────────────────────────

function buildSimpleBody(
  name: string,
  type: string,
  bgColor: string | undefined,
  subBlocks: DocSubBlock[],
  tools: { access?: string[] },
  toolInfoMap: Map<string, ToolInfo>,
  outputs: Record<string, any>
): string {
  let result = ''

  if (subBlocks.length > 0) {
    result += `## Configuration

<ShowcaseCard>
  <BlockConfigPreview
    name="${name}"
    type="${type}"
    color="${bgColor || ''}"
    hideHeader
    subBlocks={${jsonIndent(subBlocks)}}
  />
</ShowcaseCard>

`
  }

  if (tools.access?.length) {
    result += '## Tools\n\n'
    for (const toolId of tools.access) {
      result += renderToolSection(toolId, undefined, toolInfoMap, outputs)
    }
  }

  return result
}

// ── Tabbed body (operation-based blocks) ──────────────────────────

function buildTabbedBody(
  name: string,
  type: string,
  bgColor: string | undefined,
  allSubBlocks: DocSubBlock[],
  operationField: DocSubBlock,
  operationFieldId: string,
  operationToolMap: Record<string, string>,
  opLabelMap: Map<string, string>,
  toolInfoMap: Map<string, ToolInfo>,
  outputs: Record<string, any>
): string {
  const operations = operationField.options!

  // Shared fields: no condition on the operation field
  const sharedFields = allSubBlocks.filter(
    (sb) => !sb.condition || sb.condition.field !== operationFieldId
  )

  let result = `## Configuration

`

  for (const op of operations) {
    const opFields = allSubBlocks.filter((sb) => {
      if (!sb.condition || sb.condition.field !== operationFieldId) return false
      const v = sb.condition.value
      return Array.isArray(v) ? v.includes(op.id) : v === op.id
    })

    const previewFields: DocSubBlock[] = [
      { ...operationField, defaultValue: op.id },
      ...sharedFields.filter((sb) => sb.id !== operationFieldId),
      ...opFields,
    ].map(({ condition, ...rest }) => rest)

    const toolId = operationToolMap[op.id] || op.id
    const accordionId = op.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+$/g, '')
    const operationContent = toolInfoMap.has(toolId)
      ? renderToolSection(toolId, op.label, toolInfoMap, undefined, true)
      : renderTabbedOutputSection(outputs)

    result += `### ${op.label}

<ShowcaseCard>
  <BlockConfigPreview
    name="${name}"
    type="${type}"
    color="${bgColor || ''}"
    hideHeader
    subBlocks={${jsonIndent(previewFields)}}
  />
</ShowcaseCard>

${operationContent}

---

`
  }

  return result
}

// ── Render a single tool's input/output tables ────────────────────

/**
 * Render tool reference section.
 * When `insideTab` is true, uses styled divs instead of markdown headings
 * to prevent ghost entries in the table of contents.
 */
function renderToolSection(
  toolId: string,
  operationLabel: string | undefined,
  toolInfoMap: Map<string, ToolInfo>,
  outputs?: Record<string, any>,
  insideTab = false
): string {
  let result = ''

  const toolInfo = toolInfoMap.get(toolId)
  if (!toolInfo) return ''

  if (insideTab) {
    // Use HTML divs to avoid TOC registration
    const title = operationLabel
      ? `${operationLabel} (<code>${toolId}</code>)`
      : `<code>${toolId}</code>`

    result += `<div className="mt-6 border-t border-fd-border pt-4">\n`
    result += `<div className="text-base font-semibold mb-2">${title}</div>\n\n`

    if (toolInfo.description && toolInfo.description !== 'No description available') {
      result += `${toolInfo.description}\n\n`
    }

    result += `<div className="text-sm font-medium text-fd-muted-foreground mt-4 mb-2">Input</div>\n\n`
  } else {
    const heading = operationLabel
      ? `### ${operationLabel} (\`${toolId}\`)\n\n`
      : `### \`${toolId}\`\n\n`
    result += heading

    if (toolInfo.description && toolInfo.description !== 'No description available') {
      result += `${toolInfo.description}\n\n`
    }

    result += '#### Input\n\n'
  }

  // Input table
  result += '| Parameter | Type | Required | Description |\n'
  result += '| --------- | ---- | -------- | ----------- |\n'
  for (const param of toolInfo.params) {
    result += `| \`${param.name}\` | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${escapeMdx(param.description)} |\n`
  }

  // Output table
  if (insideTab) {
    result += `\n<div className="text-sm font-medium text-fd-muted-foreground mt-4 mb-2">Output</div>\n\n`
  } else {
    result += '\n#### Output\n\n'
  }

  if (Object.keys(toolInfo.outputs).length > 0) {
    result += renderOutputTable(toolInfo.outputs)
  } else if (outputs && Object.keys(outputs).length > 0) {
    result += renderOutputTable(outputs)
  } else {
    result += 'Refer to the block outputs for this operation.\n'
  }

  if (insideTab) {
    result += '\n</div>\n'
  }

  result += '\n'
  return result
}

function renderTabbedOutputSection(outputs: Record<string, any>): string {
  if (Object.keys(outputs).length === 0) return ''

  let result = `<div className="mt-6 border-t border-fd-border pt-4">\n`
  result += `<div className="text-sm font-medium text-fd-muted-foreground mb-2">Output</div>\n\n`
  result += renderOutputTable(outputs)
  result += '\n</div>\n\n'
  return result
}

function renderOutputTable(outputs: Record<string, any>): string {
  let result = '| Parameter | Type | Description |\n'
  result += '| --------- | ---- | ----------- |\n'

  for (const [key, val] of Object.entries(outputs)) {
    const type = typeof val === 'object' ? val.type || 'string' : 'string'
    const description = typeof val === 'object' ? val.description || `${key} output` : `${key} output`
    result += `| \`${key}\` | ${type} | ${escapeMdx(description)} |\n`
  }

  return result
}

// ── Helpers ───────────────────────────────────────────────────────

function detectOperationField(subBlocks: DocSubBlock[]): {
  operationField: DocSubBlock | null
  operationFieldId: string
} {
  const conditionFields = subBlocks
    .filter((sb) => sb.condition?.field)
    .map((sb) => sb.condition!.field)
  const counts = new Map<string, number>()
  for (const f of conditionFields) counts.set(f, (counts.get(f) || 0) + 1)

  if (counts.size === 0) return { operationField: null, operationFieldId: '' }

  const operationFieldId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const operationField =
    subBlocks.find((sb) => sb.id === operationFieldId && sb.options && sb.options.length > 0) ||
    null

  return { operationField, operationFieldId }
}

function jsonIndent(obj: any): string {
  return JSON.stringify(obj, null, 4)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `    ${line}`))
    .join('\n')
}
