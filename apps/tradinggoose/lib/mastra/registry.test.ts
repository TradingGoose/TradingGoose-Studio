import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { managedServices, setManagedProviders } from './__test-utils__/managed-services'

const provider = vi.hoisted(() => ({
  name: 'Configured Provider',
  models: ['listed', 'other', 'embedding'],
  apiKeyEnvVar: 'PRIVATE_KEY_NAME',
  apiKeyHeader: 'secret-header',
  url: 'https://private.invalid',
  headers: { Authorization: 'secret' },
}))
vi.mock('@mastra/core/llm', () => ({
  defaultGateways: [],
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
  modelSupportsTemperature: (id: string) => (id.endsWith('/listed') ? false : undefined),
  modelSupportsStructuredOutput: () => true,
}))

import {
  assertListedEmbeddingModel,
  assertListedModel,
  getEmbeddingModelRegistry,
  getModelProviders,
  getModelRegistry,
} from './registry'

beforeEach(() => {
  managedServices.credentials.configured = { apiKey: 'managed-provider-secret' }
  managedServices.credentials.mastra_model_providers = {
    apiKeys: JSON.stringify({ custom: 'managed-custom-secret' }),
  }
})
afterEach(() => {
  expect(managedServices.readConfig).not.toHaveBeenCalled()
  expect(managedServices.decrypt).not.toHaveBeenCalled()
})

describe('public Mastra registry transport', () => {
  it('provides current native provider identities without connection configuration', async () => {
    expect(await getModelProviders()).toEqual([{ id: 'configured', name: 'Configured Provider' }])
    setManagedProviders({
      custom: { name: 'Custom', url: 'https://private.invalid', models: ['exact'] },
    })
    expect(await getModelProviders()).toEqual([
      { id: 'configured', name: 'Configured Provider' },
      { id: 'custom', name: 'Custom' },
    ])
  })
  it('projects names, exact model IDs and helpers without serializing provider credentials or config', async () => {
    const json = JSON.parse(JSON.stringify(await getModelRegistry()))
    expect(json).toEqual([
      {
        id: 'configured',
        name: 'Configured Provider',
        models: [
          { id: 'configured/listed', temperature: false, structuredOutput: true },
          { id: 'configured/other', structuredOutput: true },
        ],
      },
    ])
    expect(JSON.stringify(json)).not.toMatch(
      /PRIVATE_KEY_NAME|secret|private.invalid|apiKey|headers/
    )
  })
  it('accepts exact listed canonical IDs and rejects aliases, drafts and unlisted names actionably', async () => {
    await expect(assertListedModel('configured/listed')).resolves.toBeUndefined()
    for (const id of [
      'listed',
      'configured/missing',
      'unknown/listed',
      '{{MODEL}}',
      'configured/',
    ]) {
      await expect(assertListedModel(id)).rejects.toThrow('Select a listed provider/model')
    }
  })

  it.each(['unknown', 'constructor', 'toString', 'hasOwnProperty'])(
    'rejects the unlisted %s provider with an actionable 400',
    async (providerId) => {
      await expect(assertListedModel(`${providerId}/missing`)).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining('Select a listed provider/model'),
        })
      )
    }
  )
})

it('projects only native embedding metadata and exact current provider membership', async () => {
  expect(await getEmbeddingModelRegistry()).toEqual([
    { id: 'configured/embedding', provider: 'configured', dimensions: 1536, maxInputTokens: 8191 },
  ])
  await expect(assertListedEmbeddingModel('configured/embedding')).resolves.toMatchObject({
    id: 'configured/embedding',
  })
  for (const id of [
    'listed',
    'configured/other',
    'configured/unlisted',
    '{{MODEL}}',
    'unknown/listed',
  ])
    await expect(assertListedEmbeddingModel(id)).rejects.toThrowError(
      expect.objectContaining({ status: 400 })
    )
  expect(JSON.stringify(await getEmbeddingModelRegistry())).not.toMatch(
    /PRIVATE_KEY_NAME|secret|private.invalid|apiKey|headers|private-native-extra-field/
  )
})
it('configured provider overrides remove embedding models that are no longer listed', async () => {
  setManagedProviders({
    configured: { name: 'Configured', url: 'https://private.invalid', models: ['other'] },
  })
  expect(await getEmbeddingModelRegistry()).toEqual([])
  await expect(assertListedEmbeddingModel('configured/embedding')).rejects.toThrow(
    'Select a listed provider/model'
  )
})
