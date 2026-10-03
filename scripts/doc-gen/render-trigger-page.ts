import { providerToDisplayName } from './doc-pages'
import type { RelatedDocPage, TriggerConfig } from './types'

/** Escape angle brackets so MDX doesn't treat them as JSX tags */
function escapeMdxText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Render MDX for a trigger documentation page.
 * Groups triggers by provider — one page per provider.
 */
export function renderTriggerPage(
  provider: string,
  triggers: TriggerConfig[],
  relatedDocPage?: RelatedDocPage
): string {
  // Use first trigger's info for the page header
  const primary = triggers[0]
  const providerName = providerToDisplayName(provider)
  const pageName = `${providerName} Trigger`
  const pageDesc = primary.description || `Trigger workflows from ${providerName} events`

  const isMultiEvent = triggers.length > 1
  const delivery = getDeliveryDescription(primary)

  // Build config + events section
  let configSection: string

  if (isMultiEvent) {
    configSection = buildMultiEventSection(triggers)
  } else {
    configSection = buildSingleEventSection(primary)
  }

  const page = `---
title: ${pageName}
description: ${pageDesc}
---

import { BlockInfoCard } from "@/components/ui/block-info-card"
import { BlockConfigPreview } from "@/components/ui/block-config-preview"
import { ShowcaseCard } from "@/components/ui/showcase-card"
import { SchemaTree } from "@/components/ui/schema-tree"
import { Callout } from 'fumadocs-ui/components/callout'
${relatedDocPage ? `import { Card, Cards } from 'fumadocs-ui/components/card'` : ''}

<BlockInfoCard
  type="${provider}"
  color=""
/>

${pageDesc}

<Callout type="info">
  This is a **${delivery.label}** trigger. ${delivery.description}
</Callout>

${renderRelatedDocCard(relatedDocPage)}
${configSection}`
  return `${page.trimEnd()}\n`
}

function getDeliveryDescription(trigger: TriggerConfig): {
  label: string
  description: string
} {
  if (trigger.delivery === 'schedule') {
    return {
      label: 'schedule-based',
      description: 'TradingGoose runs the workflow according to the configured schedule.',
    }
  }
  if (trigger.delivery === 'polling') {
    return {
      label: 'polling-based',
      description: 'TradingGoose checks the source for matching changes on a regular interval.',
    }
  }
  return {
    label: 'webhook-based',
    description: 'Configure the external service to send events to the workflow webhook URL.',
  }
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

function buildSingleEventSection(trigger: TriggerConfig): string {
  let result = renderInstructions(trigger.instructions)

  // Config preview
  if (trigger.subBlocks.length > 0) {
    const subBlocksJson = JSON.stringify(trigger.subBlocks, null, 4)
      .split('\n')
      .map((l, i) => (i === 0 ? l : `    ${l}`))
      .join('\n')

    result += `## Configuration

<ShowcaseCard>
  <BlockConfigPreview
    name="${trigger.name}"
    type="${trigger.id}"
    hideHeader
    subBlocks={${subBlocksJson}}
  />
</ShowcaseCard>

`
  }

  // Outputs
  result += renderOutputsSection(trigger.outputs, '##')

  return result
}

function buildMultiEventSection(triggers: TriggerConfig[]): string {
  let result = `## Events

`

  for (const trigger of triggers) {
    const subBlocksJson =
      trigger.subBlocks.length > 0
        ? JSON.stringify(trigger.subBlocks, null, 4)
            .split('\n')
            .map((l, i) => (i === 0 ? l : `    ${l}`))
            .join('\n')
        : '[]'

    result += `### ${trigger.name}

${trigger.description ? `${escapeMdxText(trigger.description)}\n\n` : ''}${renderInstructions(trigger.instructions, '####')}`

    if (trigger.subBlocks.length > 0) {
      result += `<ShowcaseCard>
  <BlockConfigPreview
    name="${trigger.name}"
    type="${trigger.id}"
    hideHeader
    subBlocks={${subBlocksJson}}
  />
</ShowcaseCard>

`
    }

    result += renderOutputsSection(trigger.outputs)

    result += `---

`
  }

  return result
}

function renderInstructions(
  instructions?: string | string[],
  heading: '##' | '####' = '##'
): string {
  if (!instructions || (Array.isArray(instructions) && instructions.length === 0)) return ''

  const body = Array.isArray(instructions)
    ? instructions.map((instruction) => `- ${normalizeMdxHtml(instruction)}`).join('\n')
    : normalizeMdxHtml(instructions)
  return `${heading} Setup Instructions

${body}

`
}

function normalizeMdxHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '<br />')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

function renderOutputsSection(
  outputs: Record<string, any>,
  heading: '##' | '####' = '####'
): string {
  const schemaFields = outputsToSchemaFields(outputs)
  if (schemaFields.length === 0) {
    return `${heading} Output Schema

This trigger does not declare additional output fields.

`
  }

  const fieldsJson = JSON.stringify(schemaFields, null, 4)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join('\n')

  return `${heading} Output Schema

<SchemaTree
  title="Event Payload"
  fields={${fieldsJson}}
/>

`
}

interface SchemaField {
  name: string
  type: string
  description?: string
  children?: SchemaField[]
}

function outputsToSchemaFields(outputs: Record<string, any>): SchemaField[] {
  const fields: SchemaField[] = []

  for (const [key, value] of Object.entries(outputs)) {
    if (isSchemaMetadata(outputs, key, value)) continue
    if (typeof value !== 'object' || value === null) continue

    const hasType = value.type && typeof value.type === 'string'
    const type = hasType ? value.type : 'object'
    const description = typeof value.description === 'string' ? value.description : undefined

    const childrenSource = getChildrenSource(value)
    const children = childrenSource ? outputsToSchemaFields(childrenSource) : undefined

    fields.push({
      name: key,
      type,
      ...(description ? { description } : {}),
      ...(children && children.length > 0 ? { children } : {}),
    })
  }

  return fields
}

function getChildrenSource(value: Record<string, any>): Record<string, any> | undefined {
  if (isRecord(value.properties)) return value.properties
  if (isRecord(value.items)) {
    if (isRecord(value.items.properties)) return value.items.properties
    const itemFields = Object.fromEntries(
      Object.entries(value.items).filter(
        ([key, child]) => !isSchemaMetadata(value.items, key, child) && isRecord(child)
      )
    )
    return Object.keys(itemFields).length > 0 ? itemFields : undefined
  }

  const directFields = Object.fromEntries(
    Object.entries(value).filter(
      ([key, child]) => !isSchemaMetadata(value, key, child) && isRecord(child)
    )
  )
  return Object.keys(directFields).length > 0 ? directFields : undefined
}

function isSchemaMetadata(owner: Record<string, any>, key: string, value: unknown): boolean {
  if (!['type', 'description', 'items', 'properties'].includes(key)) return false
  if (key === 'type' || key === 'description') return !isRecord(value)
  if (typeof owner.type === 'string') return true
  return !isRecord(value) || typeof value.type !== 'string'
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
