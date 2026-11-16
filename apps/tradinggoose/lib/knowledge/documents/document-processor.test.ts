import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifyInternalTokenDetailed } from '@/lib/auth/internal'
import { GET } from '@/app/api/files/serve/[...path]/route'
import { processDocument } from './document-processor'

const state = vi.hoisted(() => ({
  mode: 'parser',
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
  env: { INTERNAL_API_SECRET: '01234567890123456789012345678901' },
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
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
}))
vi.mock('@/lib/uploads/core/setup', () => ({ UPLOAD_DIR: '/unused-test-path' }))
vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: () => true,
  StorageService: {
    uploadFile: async () => ({ key: 'knowledge/owned.pdf' }),
    generatePresignedDownloadUrl: async () => 'https://storage.example/owned.pdf',
  },
}))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureMistralOcrServiceConfig: async () =>
    state.mode === 'azure'
      ? { apiKey: 'azure-key', endpoint: 'https://azure.example/ocr', modelName: 'ocr' }
      : {},
  resolveMistralServiceConfig: async () =>
    state.mode === 'mistral' ? { apiKey: 'mistral-key' } : {},
}))
vi.mock('@/lib/file-parsers', () => ({
  parseBuffer: async (buffer: Buffer) => ({ content: buffer.toString() }),
  parseFile: vi.fn(),
}))

const fileUrl = 'https://studio.example/api/files/serve/s3/workspace/owned.txt?context=workspace'
beforeEach(() => {
  state.mode = 'parser'
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
afterEach(() => vi.unstubAllGlobals())

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
