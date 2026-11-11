import { afterEach, describe, expect, it, vi } from 'vitest'

const provider = {
  name: 'Configured Provider',
  models: ['listed', 'other', 'embedding'],
  apiKeyEnvVar: 'PRIVATE_KEY_NAME',
  apiKeyHeader: 'secret-header',
  url: 'https://private.invalid',
  headers: { Authorization: 'secret' },
}
vi.mock('@mastra/core/llm', () => ({
  GatewayRegistry: { getInstance: () => ({ getProviders: () => ({ configured: provider }) }) },
  EMBEDDING_MODELS: [
    {
      id: 'embedding',
      provider: 'configured',
      dimensions: 1536,
      maxInputTokens: 8191,
      description: 'private-native-extra-field',
    },
    { id: 'unlisted', provider: 'configured', dimensions: 10, maxInputTokens: 100 },
  ],
  parseModelString: (id: string) => ({
    provider: id.includes('/') ? id.split('/')[0] : null,
    modelId: id.slice(id.indexOf('/') + 1),
  }),
  getModelReasoningOptions: (id: string) => (id.endsWith('/listed') ? [] : undefined),
  modelSupportsTemperature: (id: string) => (id.endsWith('/listed') ? false : undefined),
  modelSupportsStructuredOutput: () => true,
  modelSupportsAttachments: () => undefined,
}))

import {
  assertListedEmbeddingModel,
  assertListedModel,
  getEmbeddingModelRegistry,
  getModelProviders,
  getModelRegistry,
} from './registry'

afterEach(() => vi.unstubAllEnvs())

describe('public Mastra registry transport', () => {
  it('provides current native provider identities without connection configuration', () => {
    expect(getModelProviders()).toEqual([{ id: 'configured', name: 'Configured Provider' }])
    vi.stubEnv(
      'MASTRA_MODEL_PROVIDERS',
      JSON.stringify({
        custom: { name: 'Custom', url: 'https://private.invalid', models: ['exact'] },
      })
    )
    expect(getModelProviders()).toEqual([
      { id: 'configured', name: 'Configured Provider' },
      { id: 'custom', name: 'Custom' },
    ])
  })
  it('projects names, exact model IDs and helpers without serializing provider credentials or config', () => {
    const json = JSON.parse(JSON.stringify(getModelRegistry()))
    expect(json).toEqual([
      {
        id: 'configured',
        name: 'Configured Provider',
        models: [
          { id: 'configured/listed', reasoning: [], temperature: false, structuredOutput: true },
          { id: 'configured/other', structuredOutput: true },
        ],
      },
    ])
    expect(JSON.stringify(json)).not.toMatch(
      /PRIVATE_KEY_NAME|secret|private.invalid|apiKey|headers/
    )
  })
  it('accepts exact listed canonical IDs and rejects aliases, drafts and unlisted names actionably', () => {
    expect(() => assertListedModel('configured/listed')).not.toThrow()
    for (const id of [
      'listed',
      'configured/missing',
      'unknown/listed',
      '{{MODEL}}',
      'configured/',
    ]) {
      expect(() => assertListedModel(id)).toThrow('Select a listed provider/model')
    }
  })

  it.each(['unknown', 'constructor', 'toString', 'hasOwnProperty'])(
    'rejects the unlisted %s provider with an actionable 400',
    (providerId) => {
      vi.stubEnv('MASTRA_MODEL_PROVIDERS', '{}')
      expect(() => assertListedModel(`${providerId}/missing`)).toThrowError(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining('Select a listed provider/model'),
        })
      )
    }
  )
})

it('projects only native embedding metadata and exact current provider membership', () => {
  expect(getEmbeddingModelRegistry()).toEqual([
    { id: 'configured/embedding', provider: 'configured', dimensions: 1536, maxInputTokens: 8191 },
  ])
  expect(() => assertListedEmbeddingModel('configured/embedding')).not.toThrow()
  for (const id of [
    'listed',
    'configured/other',
    'configured/unlisted',
    '{{MODEL}}',
    'unknown/listed',
  ])
    expect(() => assertListedEmbeddingModel(id)).toThrowError(
      expect.objectContaining({ status: 400 })
    )
  expect(JSON.stringify(getEmbeddingModelRegistry())).not.toMatch(
    /PRIVATE_KEY_NAME|secret|private.invalid|apiKey|headers|private-native-extra-field/
  )
})
it('configured provider overrides remove embedding models that are no longer listed', () => {
  vi.stubEnv(
    'MASTRA_MODEL_PROVIDERS',
    JSON.stringify({
      configured: { name: 'Configured', url: 'https://private.invalid', models: ['other'] },
    })
  )
  expect(getEmbeddingModelRegistry()).toEqual([])
  expect(() => assertListedEmbeddingModel('configured/embedding')).toThrow(
    'Select a listed provider/model'
  )
})

it('rejects the exact native embedding identity for generation while keeping its embedding lane', () => {
  expect(() => assertListedModel('configured/embedding')).toThrowError(
    expect.objectContaining({ status: 400 })
  )
  expect(getModelRegistry().flatMap(({ models }) => models.map(({ id }) => id))).not.toContain(
    'configured/embedding'
  )
  expect(() => assertListedEmbeddingModel('configured/embedding')).not.toThrow()
})

it('does not infer purpose from a different provider or a model name', () => {
  vi.stubEnv(
    'MASTRA_MODEL_PROVIDERS',
    JSON.stringify({
      custom: { name: 'Custom', url: 'https://private.invalid', models: ['embedding'] },
    })
  )
  expect(() => assertListedModel('custom/embedding')).not.toThrow()
  expect(getModelRegistry().find(({ id }) => id === 'custom')?.models).toEqual([
    { id: 'custom/embedding', structuredOutput: true },
  ])
})
