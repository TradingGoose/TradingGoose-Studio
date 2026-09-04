import type { BlockConfig } from './types'

const triggerDocSlugOverrides: Record<string, string> = {
  microsoftteams: 'microsoft-teams',
  google_forms: 'google-forms',
  twilio_voice: 'twilio-voice',
}

const providerDisplayNameOverrides: Record<string, string> = {
  github: 'GitHub',
  hubspot: 'HubSpot',
  imap: 'IMAP',
  microsoftteams: 'Microsoft Teams',
  rss: 'RSS',
  whatsapp: 'WhatsApp',
}

export function providerToTriggerDocSlug(provider: string): string {
  return triggerDocSlugOverrides[provider] || provider
}

export function providerToDisplayName(provider: string): string {
  return (
    providerDisplayNameOverrides[provider] ||
    provider
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )
}

export function findTriggerDocSlugForToolType(
  toolType: string,
  triggerSlugs: Set<string>
): string | undefined {
  const directMatch = providerToTriggerDocSlug(toolType)
  if (triggerSlugs.has(directMatch)) return directMatch

  return findNormalizedDocSlugMatch(toolType, triggerSlugs)
}

export function findToolDocSlugForTriggerProvider(
  provider: string,
  toolSlugs: Set<string>
): string | undefined {
  if (toolSlugs.has(provider)) return provider

  const underscoreVariant = provider.replace(/-/g, '_')
  if (toolSlugs.has(underscoreVariant)) return underscoreVariant

  return findNormalizedDocSlugMatch(provider, toolSlugs)
}

export function shouldGenerateToolDoc(config: BlockConfig): boolean {
  return config.category === 'tools' && config.type !== 'evaluator'
}

function findNormalizedDocSlugMatch(source: string, slugs: Set<string>): string | undefined {
  const normalizedSource = normalizeDocSlug(source)
  for (const slug of slugs) {
    if (normalizeDocSlug(slug) === normalizedSource) return slug
  }

  return undefined
}

function normalizeDocSlug(slug: string): string {
  return slug.replace(/[-_]/g, '').toLowerCase()
}
