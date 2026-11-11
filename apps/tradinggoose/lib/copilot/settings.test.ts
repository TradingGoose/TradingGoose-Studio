import { describe, expect, it } from 'vitest'
import { CopilotSettingsSchema, DEFAULT_COPILOT_SETTINGS, getCopilotModelId } from './settings'

describe('Copilot settings', () => {
  it('canonicalizes model IDs before a draft default is selected', () => {
    const row = { provider: 'openai' as const, model: ' future-model ' }
    expect(getCopilotModelId(row)).toBe('openai/future-model')
    expect(
      CopilotSettingsSchema.parse({ models: [row], defaultModel: getCopilotModelId(row) })
        .defaultModel
    ).toBe('openai/future-model')
  })

  it('accepts exact new model IDs without an installed model catalogue', () => {
    const settings = CopilotSettingsSchema.parse({
      models: [
        { provider: 'openai', model: ' future-model ' },
        { provider: 'anthropic', model: 'future-model' },
        { provider: 'openrouter', model: 'vendor/new-model' },
      ],
      defaultModel: ' openrouter/vendor/new-model ',
    })

    expect(settings.models.map(getCopilotModelId)).toEqual([
      'openai/future-model',
      'anthropic/future-model',
      'openrouter/vendor/new-model',
    ])
    expect(settings.defaultModel).toBe('openrouter/vendor/new-model')
  })

  it('allows clearing the catalogue and default together', () => {
    expect(CopilotSettingsSchema.parse(DEFAULT_COPILOT_SETTINGS)).toEqual({
      models: [],
      defaultModel: null,
    })
  })

  it.each([
    {
      models: [{ provider: 'openai', model: '' }],
      defaultModel: 'openai/',
    },
    {
      models: [{ provider: 'openai', model: 'model with spaces' }],
      defaultModel: 'openai/model with spaces',
    },
    {
      models: [{ provider: 'unknown', model: 'model' }],
      defaultModel: 'unknown/model',
    },
    {
      models: [
        { provider: 'openai', model: 'model' },
        { provider: 'openai', model: ' model ' },
      ],
      defaultModel: 'openai/model',
    },
    {
      models: [{ provider: 'openai', model: 'model' }],
      defaultModel: null,
    },
    {
      models: [{ provider: 'openai', model: 'model' }],
      defaultModel: 'openai/other-model',
    },
    { models: [], defaultModel: 'openai/model' },
  ])('rejects invalid settings %j', (settings) => {
    expect(CopilotSettingsSchema.safeParse(settings).success).toBe(false)
  })
})
