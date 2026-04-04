import fs from 'fs'
import { globSync } from 'glob'
import { extractBlockConfig } from './extract-blocks'
import type { BlockConfig } from './types'

const triggerDocSlugOverrides: Record<string, string> = {
  'microsoft-teams': 'microsoft-teams',
  microsoftteams: 'microsoft-teams',
  google_forms: 'google-forms',
  googleforms: 'google-forms',
  twilio_voice: 'twilio-voice',
}

export function providerToTriggerDocSlug(provider: string): string {
  return triggerDocSlugOverrides[provider] || provider
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

export function collectGeneratedToolSlugs(
  blocksPath: string,
  rootDir: string
): Set<string> {
  const toolSlugs = new Set<string>()

  for (const blockFile of globSync(`${blocksPath}/*.ts`)) {
    if (blockFile.endsWith('.test.ts')) continue

    const fileContent = fs.readFileSync(blockFile, 'utf-8')
    const config = extractBlockConfig(fileContent, {
      includeTriggerDerivedSubBlocks: true,
      triggersPath: `${rootDir}/apps/tradinggoose/triggers`,
    })

    if (!config || !shouldGenerateToolDoc(config)) continue
    toolSlugs.add(config.type)
  }

  return toolSlugs
}

export function shouldGenerateToolDoc(config: BlockConfig): boolean {
  if (
    config.category === 'triggers' ||
    config.type.includes('_trigger') ||
    config.type.includes('_webhook')
  ) {
    return false
  }

  if (
    (config.category === 'blocks' && config.type !== 'memory' && config.type !== 'knowledge') ||
    config.type === 'evaluator' ||
    config.type === 'number'
  ) {
    return false
  }

  return true
}

function findNormalizedDocSlugMatch(
  source: string,
  slugs: Set<string>
): string | undefined {
  const normalizedSource = normalizeDocSlug(source)
  for (const slug of slugs) {
    if (normalizeDocSlug(slug) === normalizedSource) return slug
  }

  return undefined
}

function normalizeDocSlug(slug: string): string {
  return slug.replace(/[-_]/g, '').toLowerCase()
}
