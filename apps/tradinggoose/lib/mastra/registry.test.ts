import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { managedServices } from './__test-utils__/managed-services'

const provider = vi.hoisted(() => ({
  gateway: 'models.dev',
  name: 'Native Provider',
  models: ['listed', 'other', 'embedding'],
  apiKeyEnvVar: 'PRIVATE_KEY_NAME',
  apiKeyHeader: 'secret-header',
  url: 'https://private.invalid',
  headers: { Authorization: 'secret' },
}))
vi.mock('@mastra/core/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mastra/core/llm')>()),
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
  getModelRegistry,
  getNativeModel,
} from './registry'

beforeEach(() => {
  managedServices.credentials.configured = { apiKey: 'managed-provider-secret' }
  provider.models = ['listed', 'other', 'embedding']
  provider.url = 'https://private.invalid'
})
afterEach(() => {
  expect(managedServices.readConfig).not.toHaveBeenCalled()
})

describe('public Mastra registry transport', () => {
  it.each([
    'http://127.0.0.1:1234/v1',
    'https://localhost/v1',
    'https://127.1/v1',
    'https://10.0.0.1/v1',
    'https://169.254.169.254/v1',
    'https://[::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://inference.internal/v1',
    'data:text/plain,not-an-endpoint',
  ])('excludes non-public endpoints from discovery and admission: %s', async (url) => {
    provider.url = url
    expect(await getModelRegistry()).toEqual({ providers: [], managedProviders: [] })
    expect(await getEmbeddingModelRegistry()).toEqual([])
    await expect(assertListedModel('configured/listed')).rejects.toThrowError(
      expect.objectContaining({ status: 400 })
    )
    await expect(assertListedEmbeddingModel('configured/embedding')).rejects.toThrowError(
      expect.objectContaining({ status: 400 })
    )
  })
  it('projects names, exact model IDs and helpers without serializing provider credentials or config', async () => {
    const json = JSON.parse(JSON.stringify(await getModelRegistry()))
    expect(json).toEqual({
      providers: [
        {
          id: 'configured',
          name: 'Native Provider',
          models: [
            {
              id: 'configured/listed',
              temperature: false,
              structuredOutput: true,
            },
            { id: 'configured/other', structuredOutput: true },
          ],
        },
      ],
      managedProviders: ['configured'],
    })
    expect(JSON.stringify(json)).not.toMatch(
      /PRIVATE_KEY_NAME|secret|private.invalid|apiKey|headers/
    )
    expect(managedServices.listServices).toHaveBeenCalledOnce()
    await expect(assertListedModel('configured/listed')).resolves.toBeUndefined()
  })
  it('reads current managed credentials each time and does not treat native URLs as keyless', async () => {
    for (const present of [true, false, true]) {
      managedServices.credentials.configured = present ? { apiKey: 'rotated-secret' } : {}
      expect((await getModelRegistry()).managedProviders).toEqual(present ? ['configured'] : [])
    }
  })
  it.each([
    'listed',
    'configured/missing',
    'unknown/listed',
    '{{MODEL}}',
    'configured/',
    'constructor/missing',
    'toString/missing',
    'hasOwnProperty/missing',
  ])('rejects the invalid model %s with an actionable 400', async (model) => {
    await expect(assertListedModel(model)).rejects.toThrowError(
      expect.objectContaining({
        status: 400,
        message: expect.stringContaining('Select a listed provider/model'),
      })
    )
  })
})

it('distinguishes native reasoning controls, known absence, and missing metadata', () => {
  expect(
    getNativeModel('openai/gpt-5').reasoningOptions?.find((option) => option.type === 'effort')
      ?.values
  ).toEqual(expect.arrayContaining(['low', 'high']))
  expect(getNativeModel('openai/gpt-4o')).toMatchObject({
    reasoningOptions: [],
  })
  expect(getNativeModel('configured/unknown').reasoningOptions).toBeUndefined()
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
it('rejects embedding models removed from the native registry', async () => {
  provider.models = ['other']
  expect(await getEmbeddingModelRegistry()).toEqual([])
  await expect(assertListedEmbeddingModel('configured/embedding')).rejects.toThrow(
    'Select a listed provider/model'
  )
})
