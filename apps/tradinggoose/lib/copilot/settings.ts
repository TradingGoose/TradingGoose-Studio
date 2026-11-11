import { z } from 'zod'

export interface CopilotModelOption {
  id: string
  label: string
}

export function getCopilotModelId(row: { provider: string; model: string }): string {
  return `${row.provider}/${row.model.trim()}`
}

export const CopilotSettingsSchema = z
  .object({
    models: z.array(
      z.object({
        provider: z
          .string()
          .trim()
          .regex(
            /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/,
            'Choose a valid native provider ID'
          ),
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
