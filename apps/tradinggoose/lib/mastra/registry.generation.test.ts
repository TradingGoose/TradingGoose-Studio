import { EMBEDDING_MODELS, GatewayRegistry } from '@mastra/core/llm'
import { providers as modelCatalog } from '@opencode-ai/models/snapshot'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { managedServices } from './__test-utils__/managed-services'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: auth }))

import { GET } from '@/app/api/models/route'
import * as registry from './registry'
import {
  assertListedEmbeddingModel,
  assertListedModel,
  getEmbeddingModelRegistry,
  getModelRegistry,
  getNativeModel,
} from './registry'

beforeEach(() => {
  auth.mockResolvedValue({ success: true })
  managedServices.credentials.openai = { defaultApiKey: 'managed-openai-secret' }
})
afterEach(() => {
  expect(managedServices.readConfig).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

it('excludes every exact installed native embedding identity from generation and keeps embedding access', async () => {
  const generation = new Set(
    (await getModelRegistry()).providers.flatMap(({ models }) => models.map(({ id }) => id))
  )
  const embeddings = await getEmbeddingModelRegistry()
  expect(EMBEDDING_MODELS).not.toHaveLength(0)
  for (const entry of EMBEDDING_MODELS) {
    const id = `${entry.provider}/${entry.id}`
    expect(generation.has(id)).toBe(false)
    await expect(assertListedModel(id)).rejects.toThrowError(
      expect.objectContaining({ status: 400 })
    )
    const embedding = await assertListedEmbeddingModel(id)
    expect(embedding).toEqual({
      id,
      provider: entry.provider,
      dimensions: entry.dimensions,
      maxInputTokens: entry.maxInputTokens,
    })
    expect(embeddings).toContainEqual(embedding)
  }
})

it('retains exact native generation identities and capabilities', async () => {
  const generation = (await getModelRegistry()).providers.flatMap(({ models }) => models)
  for (const id of [
    'openai/gpt-4.1',
    'deepseek/deepseek-v4-pro',
    'openai/gpt-5',
    'google/gemini-2.5-pro',
    'perplexity/sonar-deep-research',
    'openai/gpt-3.5-turbo',
    'openrouter/openai/gpt-audio',
    'poe/openai/gpt-5.4',
    'tinfoil/gpt-oss-120b',
    'xai/grok-4.20-multi-agent-0309',
  ]) {
    await expect(assertListedModel(id)).resolves.toBeUndefined()
    expect(generation).toContainEqual(getNativeModel(id))
  }
  await expect(assertListedModel('openai/text-embedding-3-small-unlisted')).rejects.toThrow()
  await expect(assertListedModel('gpt-4.1')).rejects.toThrow()
  expect(getNativeModel('xai/grok-4.20-multi-agent-0309')).toMatchObject({ toolCall: false })
  expect(getNativeModel('openai/gpt-4.1')).toMatchObject({ toolCall: true })
})

it('excludes unsupported gateways and published non-chat APIs from generation', async () => {
  const generation = new Set(
    (await getModelRegistry()).providers.flatMap(({ models }) => models.map(({ id }) => id))
  )
  const excluded = new Set([
    'netlify/openai/gpt-image-1.5',
    'netlify/openai/gpt-4.1',
    'google/deep-research-preview-04-2026',
    'google/deep-research-max-preview-04-2026',
    'google/lyria-3-clip-preview',
    'google/lyria-3-pro-preview',
    'openrouter/google/lyria-3-clip-preview',
    'poe/google/lyria',
    'tinfoil/nomic-embed-text',
    'nvidia/nvidia/synthetic-video-detector',
  ])
  for (const [provider, config] of Object.entries(GatewayRegistry.getInstance().getProviders())) {
    for (const modelId of config.models) {
      const model = modelCatalog[provider]?.models[modelId]
      if (
        model &&
        ((model.type && model.type !== 'chat') ||
          !model.modalities.input.includes('text') ||
          !model.modalities.output.includes('text'))
      )
        excluded.add(`${provider}/${modelId}`)
    }
  }
  for (const id of excluded) {
    expect(generation.has(id)).toBe(false)
    await expect(assertListedModel(id)).rejects.toThrowError(
      expect.objectContaining({ status: 400 })
    )
  }
  expect(excluded).toContain('openai/gpt-image-1.5')
  expect(excluded).toContain('google/gemini-embedding-2')
})

it('serves native generation and embedding discovery without exposing credentials', async () => {
  const response = await GET(new NextRequest('http://localhost/api/models'))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toEqual(await getModelRegistry())
  expect(JSON.stringify(body)).not.toMatch(/not-contacted|apiKey|headers/)
  const embeddingResponse = await GET(new NextRequest('http://localhost/api/models?type=embedding'))
  expect(await embeddingResponse.json()).toEqual({ models: await getEmbeddingModelRegistry() })
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
