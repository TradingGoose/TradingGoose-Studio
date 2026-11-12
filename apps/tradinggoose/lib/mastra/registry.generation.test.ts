import { EMBEDDING_MODELS, GatewayRegistry } from '@mastra/core/llm'
import { providers as modelCatalog } from '@opencode-ai/models/snapshot'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: auth }))

import { GET } from '@/app/api/models/route'
import * as registry from './registry'
import {
  assertListedEmbeddingModel,
  assertListedModel,
  getEmbeddingModelRegistry,
  getModelRegistry,
  getNativeRegistryModel,
} from './registry'

beforeEach(() => {
  auth.mockResolvedValue({ success: true })
  vi.stubEnv('MASTRA_AZURE_OPENAI', '')
  const providers: Record<string, { name: string; url: string; models: string[] }> = {}
  for (const { provider, id } of EMBEDDING_MODELS) {
    providers[provider] ??= { name: provider, url: 'https://not-contacted.invalid', models: [] }
    providers[provider].models.push(id)
  }
  providers.openai.models.push('gpt-4.1')
  providers.custom = {
    name: 'Custom',
    url: 'https://not-contacted.invalid',
    models: ['text-embedding-3-small', 'embedding-named-generation-model'],
  }
  vi.stubEnv('MASTRA_MODEL_PROVIDERS', JSON.stringify(providers))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it.each(['openai', 'custom'])(
  'does not borrow built-in capabilities for the configured %s endpoint',
  (provider) => {
    vi.stubEnv(
      'MASTRA_MODEL_PROVIDERS',
      JSON.stringify({
        [provider]: { name: 'Configured', url: 'https://not-contacted.invalid', models: ['exact'] },
      })
    )
    const model = `${provider}/exact`
    expect(() => assertListedModel(model)).not.toThrow()
    expect(getNativeRegistryModel(model)).toEqual({ id: model })
    expect(getModelRegistry().find(({ id }) => id === provider)?.models).toEqual([{ id: model }])
  }
)

it('excludes every exact installed native embedding identity from generation and keeps embedding access', () => {
  const generation = new Set(getModelRegistry().flatMap(({ models }) => models.map(({ id }) => id)))
  const embeddings = getEmbeddingModelRegistry()
  expect(EMBEDDING_MODELS).not.toHaveLength(0)
  for (const entry of EMBEDDING_MODELS) {
    const id = `${entry.provider}/${entry.id}`
    expect(generation.has(id)).toBe(false)
    expect(() => assertListedModel(id)).toThrowError(expect.objectContaining({ status: 400 }))
    expect(assertListedEmbeddingModel(id)).toEqual({
      id,
      provider: entry.provider,
      dimensions: entry.dimensions,
      maxInputTokens: entry.maxInputTokens,
    })
    expect(embeddings).toContainEqual(assertListedEmbeddingModel(id))
  }
})

it('retains exact registered generation and custom identities without purpose name heuristics', () => {
  const generation = getModelRegistry().flatMap(({ models }) => models)
  for (const id of [
    'openai/gpt-4.1',
    'custom/text-embedding-3-small',
    'custom/embedding-named-generation-model',
  ]) {
    expect(() => assertListedModel(id)).not.toThrow()
    expect(generation).toContainEqual(getNativeRegistryModel(id))
  }
  expect(() => assertListedModel('openai/text-embedding-3-small-unlisted')).toThrow()
  expect(() => assertListedModel('gpt-4.1')).toThrow()
})

it('excludes every published non-chat API from native generation pickers and validation', () => {
  vi.stubEnv('MASTRA_MODEL_PROVIDERS', '{}')
  const generation = new Set(getModelRegistry().flatMap(({ models }) => models.map(({ id }) => id)))
  const excluded = new Set<string>()
  for (const [provider, config] of Object.entries(GatewayRegistry.getInstance().getProviders())) {
    for (const modelId of config.models) {
      const type = modelCatalog[provider]?.models[modelId]?.type
      if (type === undefined || type === 'chat') continue
      const id = `${provider}/${modelId}`
      excluded.add(id)
      expect(generation.has(id)).toBe(false)
      expect(() => assertListedModel(id)).toThrowError(expect.objectContaining({ status: 400 }))
    }
  }
  expect(excluded).toContain('openai/gpt-image-1.5')
  expect(excluded).toContain('google/gemini-embedding-2')
  for (const id of ['openai/gpt-5', 'google/gemini-2.5-pro']) {
    expect(generation.has(id)).toBe(true)
    expect(() => assertListedModel(id)).not.toThrow()
  }
})

it('uses the same generation filter in the authenticated picker API and leaves embedding discovery separate', async () => {
  const response = await GET(new NextRequest('http://localhost/api/models'))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toEqual({ providers: getModelRegistry() })
  const selected = new Set(
    body.providers.flatMap((provider: { models: { id: string }[] }) =>
      provider.models.map(({ id }) => id)
    )
  )
  for (const entry of EMBEDDING_MODELS)
    expect(selected.has(`${entry.provider}/${entry.id}`)).toBe(false)
  expect(selected.has('openai/gpt-4.1')).toBe(true)
  expect(JSON.stringify(body)).not.toMatch(/not-contacted|apiKey|headers/)
  const embeddingResponse = await GET(new NextRequest('http://localhost/api/models?type=embedding'))
  expect(await embeddingResponse.json()).toEqual({ models: getEmbeddingModelRegistry() })
})

it.each(['', '?type=embedding'])(
  'rejects unauthenticated discovery %s before reading the registry',
  async (query) => {
    const generation = vi.spyOn(registry, 'getModelRegistry')
    const embeddings = vi.spyOn(registry, 'getEmbeddingModelRegistry')
    auth.mockResolvedValue({ success: false })
    expect((await GET(new NextRequest(`http://localhost/api/models${query}`))).status).toBe(401)
    expect(generation).not.toHaveBeenCalled()
    expect(embeddings).not.toHaveBeenCalled()
  }
)
