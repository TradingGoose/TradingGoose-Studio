/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  provider: 's3',
  general: 'shared-private',
  actor: 'owner' as string | undefined,
  permitted: true,
  row: null as Record<string, unknown> | null,
  select: vi.fn(),
  access: vi.fn(),
  read: vi.fn(),
  parse: vi.fn(),
  fetcher: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: async () => ({ success: Boolean(state.actor), userId: state.actor }),
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: state.access }))
vi.mock('@tradinggoose/db', () => ({ db: { select: state.select } }))
vi.mock('@/lib/uploads/core/setup', () => ({
  getStorageProvider: () => state.provider,
  get USE_S3_STORAGE() {
    return state.provider === 's3'
  },
  get USE_AZURE_STORAGE() {
    return false
  },
  get USE_VERCEL_STORAGE() {
    return false
  },
  get USE_LOCAL_STORAGE() {
    return state.provider === 'local'
  },
  S3_EXECUTION_FILES_CONFIG: { bucket: 'execution-disjoint' },
  AZURE_EXECUTION_FILES_CONFIG: {},
}))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: (context: string) => ({
    bucket:
      context === 'copilot'
        ? 'shared-private'
        : context === 'execution'
          ? 'execution-disjoint'
          : state.general,
    region: context === 'copilot' ? 'a' : 'b',
  }),
}))
vi.mock('@/lib/uploads/core/setup.server', () => ({ UPLOAD_DIR_SERVER: '/disposable/uploads' }))
vi.mock('@/lib/uploads', async () => ({
  isUsingCloudStorage: () => state.provider !== 'local',
  getServePathPrefix: () => '/api/files/serve/s3/',
  StorageService: await import('@/lib/uploads/core/storage-service'),
}))
vi.mock('@/lib/uploads/providers/s3/s3-client', () => ({ downloadFromS3: state.read }))
vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: () => true,
  parseBuffer: state.parse,
  parseFile: state.parse,
}))
vi.mock('@/lib/security/input-validation', () => ({
  validateExternalUrl: () => ({ isValid: true }),
}))

import { fileParserTool } from '@/tools/file/parser'
import { POST } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  state.provider = 's3'
  state.general = 'shared-private'
  state.actor = 'owner'
  state.permitted = true
  state.row = {
    id: 'file-1',
    workspaceId: 'workspace-1',
    key: 'workspace-1/owned.txt',
    name: 'owned.txt',
    size: 14,
    type: 'text/plain',
    uploadedBy: 'uploader',
    uploadedAt: new Date(0),
  }
  state.access.mockImplementation(async () => ({ hasAccess: state.permitted }))
  state.select.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: async () => (state.row ? [state.row] : []) }) }),
  }))
  state.read.mockResolvedValue(Buffer.from('actual content'))
  state.parse.mockImplementation(async (buffer) => ({ content: buffer.toString(), metadata: {} }))
  state.fetcher.mockResolvedValue(
    new Response('external content', { headers: { 'content-type': 'text/plain' } })
  )
  vi.stubGlobal('fetch', state.fetcher)
})
afterEach(() => vi.unstubAllGlobals())
function request(body: unknown) {
  return new NextRequest('https://studio.example/api/files/parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function toolBody(params: {
  filePath?: string | string[]
  _context?: { workspaceId: string }
  file?: { path: string; name: string; id: string; userId: string }
}) {
  if (!fileParserTool.request.body) throw new Error('FileParser body is required')
  return fileParserTool.request.body({ filePath: '', ...params })
}
const transform = fileParserTool.transformResponse!

describe('FileParser actual tool and private-source parse route', () => {
  it.each([
    'old-flat.txt',
    '/api/files/serve/s3/old-flat.txt?context=general',
    '/api/files/serve/old-flat.txt?context=workspace',
    'https://shared-private.s3.us-west-2.amazonaws.com/old-flat.txt',
    'https://s3.amazonaws.com/shared-private/old-flat.txt',
    '/api/files/serve/%6fld-flat.txt?context=chat',
  ])('refuses unproved key/URL %s before read/parser/fetch', async (filePath) => {
    const response = await POST(
      request(toolBody({ filePath, _context: { workspaceId: 'caller-workspace' } }))
    )
    expect(response.status).toBe(403)
    await expect(transform(response)).rejects.toThrow('File access is unavailable')
    expect(state.read).not.toHaveBeenCalled()
    expect(state.parse).not.toHaveBeenCalled()
    expect(state.fetcher).not.toHaveBeenCalled()
  })
  it('refuses raw caller UserFile/workflow output rather than treating it as ownership', async () => {
    const response = await POST(
      request(
        toolBody({
          file: {
            path: '/api/files/serve/old-flat.txt',
            name: 'old-flat.txt',
            id: 'persisted-output',
            userId: 'owner',
          },
        })
      )
    )
    expect(response.status).toBe(403)
    await expect(transform(response)).rejects.toThrow('File access')
    expect(state.read).not.toHaveBeenCalled()
  })
  it('authorizes the complete reference batch before its first download', async () => {
    state.general = 'general-disjoint'
    const response = await POST(
      request(
        toolBody({
          filePath: ['public.txt', 'https://shared-private.s3.amazonaws.com/private.txt'],
        })
      )
    )
    expect(response.status).toBe(403)
    expect(state.read).not.toHaveBeenCalled()
    expect(state.fetcher).not.toHaveBeenCalled()
  })
  it('preserves actual successful disjoint cloud parsing through tool transform', async () => {
    state.general = 'general-disjoint'
    const response = await POST(request(toolBody({ filePath: '/api/files/serve/s3/public.txt' })))
    expect(response.status).toBe(200)
    const output = await transform(response)
    expect(output).toMatchObject({
      success: true,
      output: {
        combinedContent: 'actual content',
        files: [{ content: 'actual content', size: 14 }],
      },
    })
    expect(state.read).toHaveBeenCalledOnce()
    expect(state.parse).toHaveBeenCalledOnce()
  })
  it('retains complete successful multiple-file output', async () => {
    state.general = 'general-disjoint'
    const response = await POST(request(toolBody({ filePath: ['one.txt', 'two.txt'] })))
    const output = await transform(response)
    expect(output.success).toBe(true)
    expect(output.output.files).toHaveLength(2)
    expect(state.read).toHaveBeenCalledTimes(2)
  })
  it('does not turn an individual batch parsing failure into successful empty output', async () => {
    state.general = 'general-disjoint'
    state.read.mockRejectedValueOnce(new Error('synthetic unavailable file'))
    const response = await POST(request(toolBody({ filePath: ['one.txt', 'two.txt'] })))
    await expect(transform(response)).rejects.toThrow('synthetic unavailable file')
  })
  it('preserves canonical workspace parsing from actual authorized row even on shared storage', async () => {
    const response = await POST(
      request(
        toolBody({
          filePath:
            '/api/files/serve/s3/workspace-1%2Fowned.txt?context=workspace&workspaceId=workspace-1&fileId=file-1',
        })
      )
    )
    expect((await transform(response)).output.combinedContent).toBe('actual content')
    expect(state.access).toHaveBeenCalledWith('workspace-1', 'owner')
    expect(state.select).toHaveBeenCalledOnce()
    expect(state.read).toHaveBeenCalledWith(
      'workspace-1/owned.txt',
      expect.objectContaining({ bucket: 'shared-private' }),
      undefined
    )
  })
  it.each(['revoked', 'wrong-key', 'missing-row', 'unauthenticated'])(
    'refuses canonical workspace %s before any storage/parser contact',
    async (kind) => {
      if (kind === 'revoked') state.permitted = false
      if (kind === 'wrong-key' && state.row) state.row.key = 'different.txt'
      if (kind === 'missing-row') state.row = null
      if (kind === 'unauthenticated') state.actor = undefined
      const response = await POST(
        request(
          toolBody({
            filePath:
              '/api/files/serve/s3/workspace-1%2Fowned.txt?context=workspace&workspaceId=workspace-1&fileId=file-1',
          })
        )
      )
      expect(response.status).toBe(403)
      await expect(transform(response)).rejects.toThrow('File access is unavailable')
      expect(state.read).not.toHaveBeenCalled()
      expect(state.parse).not.toHaveBeenCalled()
      expect(state.fetcher).not.toHaveBeenCalled()
      if (kind === 'revoked' || kind === 'unauthenticated')
        expect(state.select).not.toHaveBeenCalled()
    }
  )
  it('refuses revoked caller workspace context before external fetch or canonical query', async () => {
    state.permitted = false
    const response = await POST(
      request({ filePath: 'https://public.example/readme.txt', workspaceId: 'revoked-workspace' })
    )
    expect(response.status).toBe(403)
    expect(state.select).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
    expect(state.fetcher).not.toHaveBeenCalled()
  })
  it('retains allowed external public parsing without source-store contact', async () => {
    const response = await POST(
      request(toolBody({ filePath: 'https://public.example/readme.txt' }))
    )
    expect((await transform(response)).output.combinedContent).toBe('external content')
    expect(state.fetcher).toHaveBeenCalledOnce()
    expect(state.read).not.toHaveBeenCalled()
  })
  it('rechecks external redirect before fetching a protected target', async () => {
    state.fetcher.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://shared-private.s3.amazonaws.com/private.txt' },
      })
    )
    const response = await POST(
      request(toolBody({ filePath: 'https://public.example/redirect.txt' }))
    )
    await expect(transform(response)).rejects.toThrow('File access is unavailable')
    expect(state.fetcher).toHaveBeenCalledTimes(1)
    expect(state.parse).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
  })
  it('refuses authenticated-looking raw local paths without authority', async () => {
    state.provider = 'local'
    const response = await POST(
      request({ filePath: 'old-flat.txt', userId: 'owner', workspaceId: 'workspace' })
    )
    expect(response.status).toBe(403)
    expect(state.parse).not.toHaveBeenCalled()
  })
  it.each([
    '../private.txt',
    '/api/files/serve/%252e%252e%252fprivate.txt',
    '/api/files/serve/a%00.txt',
    'archived-enhanced-logs/private.txt',
  ])('keeps path/archive rejection before any source contact: %s', async (filePath) => {
    const response = await POST(request({ filePath }))
    expect(response.status).not.toBe(200)
    expect(state.read).not.toHaveBeenCalled()
    expect(state.parse).not.toHaveBeenCalled()
    expect(state.fetcher).not.toHaveBeenCalled()
  })
  it('returns explicit validation for missing and malformed references', async () => {
    expect((await POST(request({}))).status).toBe(400)
    expect((await POST(request({ filePath: 42 }))).status).toBe(400)
    expect(state.read).not.toHaveBeenCalled()
  })
})
