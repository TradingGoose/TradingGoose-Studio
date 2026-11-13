import { describe, expect, it } from 'vitest'
import { CopilotSettingsSchema, DEFAULT_COPILOT_SETTINGS, getCopilotModelId } from './settings'

describe('Copilot settings', () => {
  it('canonicalizes model IDs', () => {
    const row = { provider: 'openai' as const, model: ' future-model ' }
    expect(getCopilotModelId(row)).toBe('openai/future-model')
    expect(CopilotSettingsSchema.parse({ models: [row] }).models).toEqual([
      { provider: 'openai', model: 'future-model' },
    ])
  })

  it('accepts exact new model IDs without an installed model catalogue', () => {
    const settings = CopilotSettingsSchema.parse({
      models: [
        { provider: 'openai', model: ' future-model ' },
        { provider: 'anthropic', model: 'future-model' },
        { provider: 'openrouter', model: 'vendor/new-model' },
        { provider: 'native/new-provider', model: 'namespace/future-model' },
      ],
    })

    expect(settings.models.map(getCopilotModelId)).toEqual([
      'openai/future-model',
      'anthropic/future-model',
      'openrouter/vendor/new-model',
      'native/new-provider/namespace/future-model',
    ])
  })

  it('allows clearing the catalogue', () => {
    expect(CopilotSettingsSchema.parse(DEFAULT_COPILOT_SETTINGS)).toEqual({
      models: [],
    })
  })

  it.each([
    'provider//other',
    'provider/../other',
    'provider?host=other',
    'provider#other',
    'provider%2Fother',
    '/provider',
  ])('rejects an unsafe provider path %s', (provider) => {
    expect(
      CopilotSettingsSchema.safeParse({
        models: [{ provider, model: 'future-model' }],
      }).success
    ).toBe(false)
  })

  it.each([
    {
      models: [{ provider: 'openai', model: '' }],
    },
    {
      models: [{ provider: 'openai', model: 'model with spaces' }],
    },
    {
      models: [{ provider: 'https://provider', model: 'model' }],
    },
    {
      models: [
        { provider: 'openai', model: 'model' },
        { provider: 'openai', model: ' model ' },
      ],
    },
  ])('rejects invalid settings %j', (settings) => {
    expect(CopilotSettingsSchema.safeParse(settings).success).toBe(false)
  })
})
