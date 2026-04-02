import type { TriggerConfig } from './extract-triggers'
import { escapeMdx } from './utils'

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
  icons: Record<string, string>
): string {
  // Use first trigger's info for the page header
  const primary = triggers[0]
  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1)
  const pageName = `${providerName} Trigger`
  const pageDesc = primary.description || `Trigger workflows from ${providerName} events`

  // Find icon — try multiple naming conventions
  // Try multiple naming conventions to find the right icon
  // Some brands have non-standard casing (WhatsApp, HubSpot, PostHog, etc.)
  const brandIconMap: Record<string, string> = {
    // Brand-specific casing
    whatsapp: 'WhatsAppIcon',
    hubspot: 'HubSpotIcon',
    posthog: 'PostHogIcon',
    github: 'GithubIcon',
    gitlab: 'GitlabIcon',
    linkedin: 'LinkedInIcon',
    youtube: 'YouTubeIcon',
    javascript: 'JavaScriptIcon',
    typescript: 'TypeScriptIcon',
    // Core/special trigger icons
    generic: 'WebhookIcon',
    imap: 'MailServerIcon',
    schedule: 'ScheduleIcon',
    twilio_voice: 'TwilioIcon',
    indicator: 'ScheduleIcon', // no dedicated icon, use schedule as fallback
  }

  const words = provider.split(/[-_]/)
  const pascalCase = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  const iconCandidates = [
    brandIconMap[provider],                                          // Brand-specific override
    `${pascalCase}Icon`,                                             // MicrosoftTeamsIcon, GoogleFormsIcon
    `${providerName}Icon`,                                           // SlackIcon
    `${provider.replace(/[-_]/g, '')}Icon`,                          // microsoftteamsIcon
    `${provider.charAt(0).toUpperCase() + provider.replace(/[-_]/g, '').slice(1)}Icon`, // MicrosoftteamsIcon
  ].filter((v, i, a) => v && a.indexOf(v) === i)  // dedupe + remove undefined
  const iconSvg = iconCandidates.reduce<string | null>((found, name) => found || icons[name] || null, null)

  const isMultiEvent = triggers.length > 1
  const isPolling = !primary.hasWebhook
  const triggerType = isPolling ? 'Polling' : 'Webhook'

  // Build config + events section
  let configSection: string

  if (isMultiEvent) {
    configSection = buildMultiEventSection(triggers, providerName, icons)
  } else {
    configSection = buildSingleEventSection(primary, providerName, icons)
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

<BlockInfoCard
  type="${provider}"
  color=""
  icon={${iconSvg ? 'true' : 'false'}}
  iconSvg={\`${iconSvg || ''}\`}
/>

${pageDesc}

<Callout type="info">
  This is a **${triggerType.toLowerCase()}-based** trigger.${isPolling ? ' TradingGoose automatically checks for new data on a regular interval.' : ' Configure the webhook URL in your external service to send events to TradingGoose.'}
</Callout>

${configSection}
`
}

function buildSingleEventSection(trigger: TriggerConfig, providerName: string, icons: Record<string, string>): string {
  let result = ''

  // Config preview
  if (trigger.subBlocks.length > 0) {
    const subBlocksJson = JSON.stringify(trigger.subBlocks, null, 4)
      .split('\n').map((l, i) => i === 0 ? l : `    ${l}`).join('\n')

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

function buildMultiEventSection(triggers: TriggerConfig[], providerName: string, icons: Record<string, string>): string {
  let result = `## Events

`

  for (const trigger of triggers) {
    const subBlocksJson = trigger.subBlocks.length > 0
      ? JSON.stringify(trigger.subBlocks, null, 4)
          .split('\n').map((l, i) => i === 0 ? l : `    ${l}`).join('\n')
      : '[]'

    const accordionId = trigger.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/g, '')

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

    const children = nestedKeys.length > 0
      ? outputsToSchemaFields(Object.fromEntries(nestedKeys.map((k) => [k, value[k]])))
      : undefined

    fields.push({ name: key, type, description, ...(children && children.length > 0 ? { children } : {}) })
  }

  return fields
}
