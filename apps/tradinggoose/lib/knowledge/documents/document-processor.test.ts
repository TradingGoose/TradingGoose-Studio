import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifyInternalTokenDetailed } from '@/lib/auth/internal-token'
import { GET } from '@/app/api/files/serve/[...path]/route'
import { processDocument } from './document-processor'
import { retryWithExponentialBackoff } from './utils'

const state = vi.hoisted(() => ({
  mode: 'parser',
  ocrConfigCalls: 0,
  actors: [] as Array<string | undefined>,
  file: {
    id: 'file',
    key: 'workspace/owned.txt',
    workspaceId: 'workspace',
    name: 'owned.txt',
    type: 'text/plain',
  },
}))
vi.mock('@/lib/env', () => ({
  getEnv: () => 'https://studio.example',
}))
vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.file] }) }) }) },
}))
vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: vi.fn(),
  decrementStorageUsage: vi.fn(),
  incrementStorageUsage: vi.fn(),
}))
vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: async (_workspaceId: string, actor: string) => ({
    hasAccess: actor === 'actor',
  }),
}))
vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: vi.fn(),
  updateApiKeyLastUsed: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: async () => null }))
vi.mock('@/lib/chunkers/docs-chunker', () => ({ DocsChunker: vi.fn() }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: async () => Buffer.from('Authorized workspace text'),
  uploadFile: async () => ({ key: 'knowledge/owned.pdf' }),
  generatePresignedDownloadUrl: async () => 'https://storage.example/owned.pdf',
  deleteFile: vi.fn(),
}))
vi.mock('@/lib/uploads/core/setup', () => ({ UPLOAD_DIR: '/unused-test-path' }))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureMistralOcrServiceConfig: async () => {
    state.ocrConfigCalls += 1
    return state.mode === 'azure'
      ? { apiKey: 'azure-key', endpoint: 'https://azure.example/ocr', modelName: 'ocr' }
      : {}
  },
  resolveMistralServiceConfig: async () =>
    state.mode === 'mistral' ? { apiKey: 'mistral-key' } : {},
}))
vi.mock('@/lib/file-parsers', () => ({
  parseBuffer: async (buffer: Buffer) => ({ content: buffer.toString() }),
  parseFile: vi.fn(),
}))

const fileUrl = 'https://studio.example/api/files/serve/s3/workspace/owned.txt?context=workspace'
beforeEach(() => {
  vi.stubEnv('INTERNAL_API_SECRET', '01234567890123456789012345678901')
  state.mode = 'parser'
  state.ocrConfigCalls = 0
  state.actors = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input)
      if (url.origin !== 'https://studio.example')
        return Response.json({ pages: [{ markdown: 'OCR text' }] })
      const token = new Headers(init.headers).get('Authorization')?.slice(7)
      const claims = await verifyInternalTokenDetailed(token!)
      state.actors.push(claims.userId)
      expect(claims.valid).toBe(true)
      if (url.pathname === '/api/tools/mistral/parse')
        return Response.json({ pages: [{ markdown: 'OCR text' }] })
      expect(init.redirect).toBe('error')
      return GET(new NextRequest(input, { headers: init.headers }), {
        params: Promise.resolve({ path: ['s3', ...state.file.key.split('/')] }),
      })
    })
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each(['parser', 'azure', 'mistral'])(
  'preserves the queued actor through %s file downloads',
  async (mode) => {
    state.mode = mode
    const result = await processDocument(
      fileUrl,
      'owned.pdf',
      mode === 'parser' ? 'text/plain' : 'application/pdf',
      'actor'
    )
    expect(result.chunks[0].text).toBe(mode === 'parser' ? 'Authorized workspace text' : 'OCR text')
    expect(state.actors).toEqual(mode === 'mistral' ? ['actor', 'actor'] : ['actor'])
    if (mode === 'parser') expect(state.ocrConfigCalls).toBe(0)
  }
)

it('retains workspace authorization when the queued actor loses access', async () => {
  await expect(processDocument(fileUrl, 'owned.txt', 'text/plain', 'revoked')).rejects.toThrow(
    'Failed to download file'
  )
  expect(state.actors).toEqual(['revoked'])
})

it('does not attach internal credentials to an external URL with a serve pathname', async () => {
  await processDocument(
    'https://external.example/api/files/serve/owned.txt',
    'owned.txt',
    'text/plain',
    'actor'
  )
  const [, init] = vi.mocked(fetch).mock.calls[0]
  expect(new Headers(init?.headers).has('Authorization')).toBe(false)
})

it.each(['parser', 'azure', 'mistral'])(
  'cancels %s downloads without OCR fallback or retry',
  async (mode) => {
    state.mode = mode
    const controller = new AbortController()
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      controller.abort(new Error('Native task cancelled'))
      init!.signal!.throwIfAborted()
      return new Response('unused')
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(
      processDocument(
        fileUrl,
        'owned.pdf',
        mode === 'parser' ? 'text/plain' : 'application/pdf',
        'actor',
        1000,
        200,
        1,
        controller.signal
      )
    ).rejects.toThrow('Native task cancelled')
    expect(fetcher).toHaveBeenCalledOnce()
  }
)

it('interrupts retry backoff when the native task is cancelled', async () => {
  const controller = new AbortController()
  const operation = vi.fn(async () => {
    throw Object.assign(new Error('Service unavailable'), { status: 503 })
  })
  const pending = retryWithExponentialBackoff(operation, {
    initialDelayMs: 60_000,
    signal: controller.signal,
  })
  const outcome = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce())
  controller.abort()
  await outcome
  expect(operation).toHaveBeenCalledOnce()
})
