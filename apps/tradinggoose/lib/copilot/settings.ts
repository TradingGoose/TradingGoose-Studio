import { z } from 'zod'

export const COPILOT_PROVIDERS = {
  openai: { name: 'OpenAI', credentialKey: 'defaultApiKey' },
  anthropic: { name: 'Anthropic', credentialKey: 'apiKey' },
  deepseek: { name: 'DeepSeek', credentialKey: 'apiKey' },
  xai: { name: 'xAI', credentialKey: 'apiKey' },
  google: { name: 'Google', credentialKey: 'apiKey' },
  mistral: { name: 'Mistral', credentialKey: 'apiKey' },
  groq: { name: 'Groq', credentialKey: 'apiKey' },
  openrouter: { name: 'OpenRouter', credentialKey: 'apiKey' },
} as const

export type CopilotProvider = keyof typeof COPILOT_PROVIDERS

export function getCopilotModelId(row: { provider: CopilotProvider; model: string }): string {
  return `${row.provider}/${row.model.trim()}`
}

export const CopilotSettingsSchema = z
  .object({
    models: z.array(
      z.object({
        provider: z.enum(Object.keys(COPILOT_PROVIDERS) as [CopilotProvider, ...CopilotProvider[]]),
        model: z.string().trim().min(1).regex(/^\S+$/, 'Model must not contain whitespace'),
      })
    ),
    defaultModel: z.string().trim().min(1).nullable(),
  })
  .superRefine((settings, context) => {
    const ids = new Set<string>()
    settings.models.forEach((row, index) => {
      const id = getCopilotModelId(row)
      if (ids.has(id)) {
        context.addIssue({
          code: 'custom',
          message: 'Copilot provider/model pairs must be unique',
          path: ['models', index, 'model'],
        })
      }
      ids.add(id)
    })
    if (
      settings.models.length === 0
        ? settings.defaultModel !== null
        : settings.defaultModel === null || !ids.has(settings.defaultModel)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Choose a configured default model, or clear the default when no models remain',
        path: ['defaultModel'],
      })
    }
  })

export type CopilotSettings = z.infer<typeof CopilotSettingsSchema>

export const DEFAULT_COPILOT_SETTINGS: CopilotSettings = { models: [], defaultModel: null }
