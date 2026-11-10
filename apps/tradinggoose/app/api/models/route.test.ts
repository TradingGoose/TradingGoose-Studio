import { NextRequest } from 'next/server'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), registry: vi.fn(), embeddings: vi.fn() }))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.auth }))
vi.mock('@/lib/mastra/registry', () => ({
  getModelRegistry: mocks.registry,
  getEmbeddingModelRegistry: mocks.embeddings,
}))

import { GET } from './route'

it('requires authentication before returning registry data', async () => {
  mocks.auth.mockResolvedValue({ success: false })
  mocks.registry.mockReturnValue([])
  const denied = await GET(new NextRequest('http://localhost/api/models'))
  expect(denied.status).toBe(401)
  expect(mocks.registry).not.toHaveBeenCalled()
  mocks.auth.mockResolvedValue({ success: true })
  const allowed = await GET(new NextRequest('http://localhost/api/models'))
  expect(allowed.status).toBe(200)
  expect(await allowed.json()).toEqual({ providers: [] })
})

it('authenticates embedding discovery and returns only its native safe projection', async () => {
  mocks.embeddings.mockReturnValue([
    { id: 'openai/listed', provider: 'openai', dimensions: 3, maxInputTokens: 8191 },
  ])
  mocks.auth.mockResolvedValue({ success: false })
  expect((await GET(new NextRequest('http://localhost/api/models?type=embedding'))).status).toBe(
    401
  )
  expect(mocks.embeddings).not.toHaveBeenCalled()
  mocks.auth.mockResolvedValue({ success: true })
  const response = await GET(new NextRequest('http://localhost/api/models?type=embedding'))
  expect(await response.json()).toEqual({ models: mocks.embeddings() })
})
