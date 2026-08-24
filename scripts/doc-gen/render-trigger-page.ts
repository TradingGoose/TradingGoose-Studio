import type { TriggerConfig } from './extract-triggers'
import type { RelatedDocPage } from './types'

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
  const providerName = toProviderDisplayName(provider)
  const pageName = `${providerName} Trigger`
  const pageDesc = primary.description || `Trigger workflows from ${providerName} events`

  if (provider === 'portfolio') {
    return renderPortfolioTriggerPage(primary, pageName, pageDesc, relatedDocPage)
  }

  const isMultiEvent = triggers.length > 1
  const isPolling = !primary.hasWebhook
  const triggerType = isPolling ? 'Polling' : 'Webhook'

  // Build config + events section
  let configSection: string

  if (isMultiEvent) {
    configSection = buildMultiEventSection(triggers)
  } else {
    configSection = buildSingleEventSection(primary)
  }

  return `---
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
  This is a **${triggerType.toLowerCase()}-based** trigger.${isPolling ? ' TradingGoose automatically checks for new data on a regular interval.' : ' Configure the webhook URL in your external service to send events to TradingGoose.'}
</Callout>

${renderRelatedDocCard(relatedDocPage)}
${configSection}
`
}

function renderPortfolioTriggerPage(
  trigger: TriggerConfig,
  pageName: string,
  pageDesc: string,
  relatedDocPage?: RelatedDocPage
): string {
  const outputs = {
    input: { type: 'string', description: 'Human-readable portfolio monitor match message.' },
    event: { type: 'string', description: 'Always portfolio_state_condition_matched.' },
    portfolio: {
      identity: { type: 'object', description: 'Canonical trading portfolio identity.' },
      detail: { type: 'object', description: 'Portfolio detail snapshot at match time.' },
    },
    monitor: {
      id: { type: 'string', description: 'Portfolio monitor ID.' },
      workflowId: { type: 'string', description: 'Target workflow ID.' },
      blockId: { type: 'string', description: 'Target trigger block ID.' },
      providerId: { type: 'string', description: 'Trading provider ID.' },
      serviceId: { type: 'string', description: 'Trading service ID.' },
      accountId: { type: 'string', description: 'Broker account ID.' },
    },
    condition: { type: 'json', description: 'Matched portfolio fire condition.' },
  }

  return `---
title: ${pageName}
description: ${pageDesc}
---

import { BlockInfoCard } from "@/components/ui/block-info-card"
import { SchemaTree } from "@/components/ui/schema-tree"
import { Callout } from 'fumadocs-ui/components/callout'
${relatedDocPage ? `import { Card, Cards } from 'fumadocs-ui/components/card'` : ''}

<BlockInfoCard
  type="portfolio"
  color=""
/>

${pageDesc}

<Callout type="info">
  This is an **event-driven** trigger. Configured portfolio monitors emit workflow events when their condition matches.
</Callout>

${renderRelatedDocCard(relatedDocPage)}## Configuration

Manage portfolio monitors from the workspace **Monitor** surface. Select a broker account, define the condition to evaluate, and choose the workflow target containing this Portfolio trigger.

The delivered \`event\` is always \`portfolio_state_condition_matched\`. The \`input\` message is \`Portfolio state condition matched for {account}\`, where \`{account}\` uses \`portfolio.identity.accountName\` when available and otherwise falls back to \`portfolio.identity.accountId\`.

${renderOutputsSection(outputs).trimEnd()}
`
}

function toProviderDisplayName(provider: string): string {
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
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
  let result = ''

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
  result += renderOutputsSection(trigger.outputs)

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

    const accordionId = trigger.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+$/g, '')

    result += `### ${trigger.name}

${trigger.description ? `${escapeMdxText(trigger.description)}\n\n` : ''}`

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

function renderOutputsSection(outputs: Record<string, any>): string {
  const schemaFields = outputsToSchemaFields(outputs)
  if (schemaFields.length === 0) {
    return `#### Output Schema

The trigger passes the full event payload to your workflow. Access fields using \`<trigger.fieldName>\` syntax.

`
  }

  const fieldsJson = JSON.stringify(schemaFields, null, 4)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join('\n')

  return `#### Output Schema

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
  const skipKeys = new Set(['type', 'description', 'items'])

  for (const [key, value] of Object.entries(outputs)) {
    if (skipKeys.has(key)) continue
    if (typeof value !== 'object' || value === null) continue

    const hasType = value.type && typeof value.type === 'string'
    const type = hasType ? value.type : 'object'
    const description = value.description || key

    // Find nested children
    const nestedKeys = Object.keys(value).filter(
      (k) => !skipKeys.has(k) && typeof value[k] === 'object' && value[k] !== null
    )

    const children =
      nestedKeys.length > 0
        ? outputsToSchemaFields(Object.fromEntries(nestedKeys.map((k) => [k, value[k]])))
        : undefined

    fields.push({
      name: key,
      type,
      description,
      ...(children && children.length > 0 ? { children } : {}),
    })
  }

  return fields
}
