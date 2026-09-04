import type { BlockConfig, DocCondition, DocSubBlock, RelatedDocPage, ToolInfo } from './types'
import { appendSentence, describeVisibilityCondition, escapeMdx } from './utils'

/**
 * Render MDX content for an integration tool page.
 */
export function renderToolPage(
  blockConfig: BlockConfig,
  toolInfoMap: Map<string, ToolInfo>,
  relatedDocPage?: RelatedDocPage,
  blockInfo?: ToolInfo
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
    operationFieldId = '',
    operationToolMap,
  } = blockConfig

  const operationField = subBlocks.find((subBlock) => subBlock.id === operationFieldId)
  const isTabbed = operationField?.options && operationField.options.length > 1

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
      toolInfoMap,
      outputs
    )
  } else {
    body = buildSimpleBody(name, type, bgColor, subBlocks, tools, toolInfoMap, outputs)
  }
  if (blockInfo) body += renderBlockContract(blockInfo)

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
    const previewFields = subBlocks.map((field) => toPreviewField(field))
    result += `## Configuration

<ShowcaseCard>
  <BlockConfigPreview
    name="${name}"
    type="${type}"
    color="${bgColor || ''}"
    hideHeader
    subBlocks={${jsonIndent(previewFields)}}
  />
</ShowcaseCard>

`
  }

  const documentedToolIds = (tools.access ?? []).filter((toolId) => toolInfoMap.has(toolId))
  if (documentedToolIds.length > 0) {
    result += '## Tools\n\n'
    for (const toolId of documentedToolIds) {
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
      const matches = Array.isArray(v) ? v.includes(op.id) : v === op.id
      return sb.condition.not ? !matches : matches
    })

    const previewFields: DocSubBlock[] = [
      { ...operationField, defaultValue: op.id },
      ...sharedFields.filter((sb) => sb.id !== operationFieldId),
      ...opFields,
    ].map((field) => toPreviewField(field, operationFieldId, op.id))

    const toolId = operationToolMap[op.id] || op.id
    const operationContent = toolInfoMap.has(toolId)
      ? renderToolSection(toolId, op.label, toolInfoMap, outputs, true)
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

function toPreviewField(
  field: DocSubBlock,
  resolvedConditionField?: string,
  resolvedConditionValue?: string
): DocSubBlock {
  const { condition, requiredCondition, ...previewField } = field
  if (
    requiredCondition &&
    resolvedConditionField &&
    conditionMatchesResolvedValue(requiredCondition, resolvedConditionField, resolvedConditionValue)
  ) {
    previewField.required = true
  }
  const conditionDescription = condition
    ? describeVisibilityCondition(condition, resolvedConditionField)
    : undefined
  if (!conditionDescription) return previewField

  const { required: _required, ...conditionallyVisibleField } = previewField
  const visibility = `Shown when ${conditionDescription}.`
  return {
    ...conditionallyVisibleField,
    description: appendSentence(conditionallyVisibleField.description, visibility),
  }
}

function conditionMatchesResolvedValue(
  condition: DocCondition,
  resolvedField: string,
  resolvedValue: unknown
): boolean {
  const conditions = collectConditions(condition)
  if (conditions.some(({ field }) => field !== resolvedField)) return false

  return conditions.every(({ value, not }) => {
    const matches = Array.isArray(value)
      ? value.some((candidate) => candidate === resolvedValue)
      : value === resolvedValue
    return not ? !matches : matches
  })
}

function collectConditions(condition: DocCondition): DocCondition[] {
  const nested = condition.and
    ? (Array.isArray(condition.and) ? condition.and : [condition.and]).flatMap(collectConditions)
    : []
  return [condition, ...nested]
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
  const hasToolOutputs = Object.keys(toolInfo.outputs).length > 0
  const hasBlockOutputs = Boolean(outputs && Object.keys(outputs).length > 0)
  const usesBlockOutputContract = !hasToolOutputs && hasBlockOutputs
  const outputLabel = usesBlockOutputContract ? 'Output (block-level contract)' : 'Output'

  if (insideTab) {
    // Use HTML divs to avoid TOC registration
    const title = operationLabel
      ? `${operationLabel} (<code>${toolId}</code>)`
      : `<code>${toolId}</code>`

    result += `<div className="mt-6 border-t border-fd-border pt-4">\n`
    result += `<div className="text-base font-semibold mb-2">${title}</div>\n\n`

    if (toolInfo.description) {
      result += `${toolInfo.description}\n\n`
    }

    result += `<div className="text-sm font-medium text-fd-muted-foreground mt-4 mb-2">Input</div>\n\n`
  } else {
    const heading = operationLabel
      ? `### ${operationLabel} (\`${toolId}\`)\n\n`
      : `### \`${toolId}\`\n\n`
    result += heading

    if (toolInfo.description) {
      result += `${toolInfo.description}\n\n`
    }

    result += '#### Input\n\n'
  }

  result += renderInputTable(toolInfo.params)

  // Output table
  if (insideTab) {
    result += `\n<div className="text-sm font-medium text-fd-muted-foreground mt-4 mb-2">${outputLabel}</div>\n\n`
  } else {
    result += `\n#### ${outputLabel}\n\n`
  }

  if (hasToolOutputs) {
    result += renderOutputTable(toolInfo.outputs)
  } else if (hasBlockOutputs) {
    result += renderOutputTable(outputs)
  } else {
    result += 'The source does not declare an operation-specific output schema.\n'
  }

  if (insideTab) {
    result += '\n</div>\n'
  }

  result += '\n'
  return result
}

function renderBlockContract(blockInfo: ToolInfo): string {
  let result = '## Input\n\n'
  result += renderInputTable(blockInfo.params, 'This block does not expose configurable inputs.')
  result += '\n## Output\n\n'
  result +=
    Object.keys(blockInfo.outputs).length > 0
      ? renderOutputTable(blockInfo.outputs)
      : 'This block does not declare a structured output schema.\n'
  return `${result}\n`
}

function renderInputTable(
  params: ToolInfo['params'],
  emptyMessage = 'This operation has no direct parameters.'
): string {
  if (params.length === 0) return `${emptyMessage}\n`

  let result = '| Parameter | Type | Required | Description |\n'
  result += '| --------- | ---- | -------- | ----------- |\n'
  for (const param of params) {
    result += `| \`${param.name}\` | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${escapeMdx(param.description)} |\n`
  }
  return result
}

function renderTabbedOutputSection(outputs: Record<string, any>): string {
  if (Object.keys(outputs).length === 0) return ''

  let result = `<div className="mt-6 border-t border-fd-border pt-4">\n`
  result += `<div className="text-sm font-medium text-fd-muted-foreground mb-2">Output (block-level contract)</div>\n\n`
  result += renderOutputTable(outputs)
  result += '\n</div>\n\n'
  return result
}

function renderOutputTable(outputs: Record<string, any>): string {
  let result = '| Parameter | Type | Description |\n'
  result += '| --------- | ---- | ----------- |\n'

  for (const [key, val] of Object.entries(outputs)) {
    const type = typeof val === 'object' ? val.type || 'string' : 'string'
    const description = typeof val === 'object' && val.description ? val.description : '—'
    result += `| \`${key}\` | ${type} | ${escapeMdx(description)} |\n`
  }

  return result
}

function jsonIndent(obj: any): string {
  return JSON.stringify(obj, null, 4)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `    ${line}`))
    .join('\n')
}
