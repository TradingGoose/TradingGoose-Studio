import { NextRequest } from 'next/server'
/**
 * Tests for file upload API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFileApiMocks } from '@/app/api/__test-utils__/utils'

function mockKnowledgeBaseWriteAccess() {
  vi.doMock('@/app/api/knowledge/utils', () => ({
    checkKnowledgeBaseWriteAccess: vi.fn().mockResolvedValue({
      hasAccess: true,
      knowledgeBase: {
        id: 'kb-456',
        userId: 'test-user-id',
        workspaceId: 'workspace-123',
        embeddingModel: 'text-embedding-3-small',
      },
    }),
  }))
}

const createMockFile = (name = 'test.txt', type = 'text/plain', content = 'test content') =>
  new File([content], name, { type })

function createUploadRequest({
  files = [createMockFile()],
  fields = {},
  type = 'general',
}: {
  files?: File[]
  fields?: Record<string, string>
  type?: 'general' | 'knowledge-base'
} = {}) {
  const formData = new FormData()
  for (const file of files) formData.append('file', file)
  for (const [key, value] of Object.entries(fields)) formData.append(key, value)
  return new NextRequest(`http://localhost/api/files/upload?type=${type}`, {
    method: 'POST',
    body: formData,
  })
}

async function postUpload(options?: Parameters<typeof createUploadRequest>[0]) {
  return (await import('@/app/api/files/upload/route')).POST(createUploadRequest(options))
}

describe('File Upload API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/uploads/setup.server', () => ({
      UPLOAD_DIR_SERVER: '/tmp/test-uploads',
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['local', false],
    ['s3', true],
  ] as const)('uploads a file through %s storage', async (storageProvider, cloudEnabled) => {
    setupFileApiMocks({ cloudEnabled, storageProvider })

    const response = await postUpload()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.path).toMatch(/\/api\/files\/serve\/.*\.txt$/)
    expect(data).toMatchObject({ name: 'test.txt', type: 'text/plain' })
    expect(data).toHaveProperty('size')
    expect((await import('@/lib/uploads')).StorageService.uploadFile).toHaveBeenCalled()
  })

  it('should upload knowledge-base files through the requested storage context', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 'vercel',
    })
    mockKnowledgeBaseWriteAccess()

    const response = await postUpload({
      files: [createMockFile('jourwest.pdf', 'application/pdf', 'test pdf content')],
      fields: { workspaceId: 'workspace-123', knowledgeBaseId: 'kb-456' },
      type: 'knowledge-base',
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('context', 'knowledge-base')
    expect(data.path).toBe('/api/files/serve/test-key.txt?context=knowledge-base')

    const storageService = await import('@/lib/uploads/core/storage-service')
    expect(storageService.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'application/pdf',
        context: 'knowledge-base',
        customKey: 'workspace-123/kb-456/jourwest.pdf',
        fileName: 'workspace-123/kb-456/jourwest.pdf',
        preserveKey: true,
      })
    )
  })

  it('should handle multiple file uploads', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const response = await postUpload({
      files: [createMockFile('file1.txt'), createMockFile('file2.txt')],
    })
    const data = await response.json()

    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(600)
    expect(data).toBeDefined()
  })

  it('should handle missing files', async () => {
    setupFileApiMocks()

    const response = await postUpload({ files: [] })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No files provided')
  })

  it('should handle S3 upload errors', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    vi.doMock('@/lib/uploads/core/storage-service', () => ({
      uploadFile: vi.fn().mockRejectedValue(new Error('Upload failed')),
      hasCloudStorage: vi.fn().mockReturnValue(true),
    }))

    const response = await postUpload()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toHaveProperty('error')
    expect(typeof data.error).toBe('string')
  })

  it('should handle CORS preflight requests', async () => {
    const { OPTIONS } = await import('@/app/api/files/upload/route')

    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })
})

describe('File Upload Security Tests', () => {
  const readWorkflowAccessContext = vi.fn()
  const uploadExecutionFile = vi.fn()
  const storageHasCloudStorage = vi.fn().mockReturnValue(false)

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'test-user-id' },
      }),
    }))

    vi.doMock('@/lib/uploads', () => ({
      isUsingCloudStorage: vi.fn().mockReturnValue(false),
      StorageService: {
        uploadFile: vi.fn().mockResolvedValue({
          key: 'test-key',
          path: '/test/path',
        }),
        hasCloudStorage: vi.fn().mockReturnValue(false),
      },
    }))

    vi.doMock('@/lib/uploads/core/storage-service', () => ({
      uploadFile: vi.fn().mockResolvedValue({
        key: 'test-key',
        path: '/test/path',
      }),
      hasCloudStorage: storageHasCloudStorage,
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      readWorkflowAccessContext,
      hasWorkflowWriteAccess: (context: {
        isWorkspaceOwner: boolean
        workspacePermission: string | null
      }) =>
        context.isWorkspaceOwner ||
        context.workspacePermission === 'write' ||
        context.workspacePermission === 'admin',
    }))
    vi.doMock('@/lib/uploads/contexts/execution', () => ({ uploadExecutionFile }))
    readWorkflowAccessContext.mockResolvedValue({
      workflow: { workspaceId: 'workspace-1' },
      isOwner: false,
      isWorkspaceOwner: false,
      workspacePermission: 'write',
    })
    uploadExecutionFile.mockResolvedValue({ id: 'file-1', name: 'input.txt' })

    mockKnowledgeBaseWriteAccess()

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('File Extension Validation', () => {
    it('should accept allowed file types', async () => {
      const allowedTypes = [
        'pdf',
        'doc',
        'docx',
        'txt',
        'md',
        'png',
        'jpg',
        'jpeg',
        'gif',
        'csv',
        'xlsx',
        'xls',
      ]

      for (const ext of allowedTypes) {
        const response = await postUpload({
          files: [createMockFile(`test.${ext}`, 'application/octet-stream')],
        })

        expect(response.status).toBe(200)
      }
    })

    it('should reject HTML files to prevent XSS', async () => {
      const response = await postUpload({
        files: [createMockFile('malicious.html', 'text/html', '<script>alert("XSS")</script>')],
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'html' is not allowed")
    })

    it('should allow HTML files for knowledge-base document uploads', async () => {
      const response = await postUpload({
        files: [createMockFile('knowledge.html', 'text/html', '<h1>Knowledge</h1>')],
        fields: { workspaceId: 'workspace-123', knowledgeBaseId: 'kb-456' },
        type: 'knowledge-base',
      })

      expect(response.status).toBe(200)
    })

    it('should reject SVG files to prevent XSS', async () => {
      const maliciousSvg = '<svg onload="alert(\'XSS\')" xmlns="http://www.w3.org/2000/svg"></svg>'
      const response = await postUpload({
        files: [createMockFile('malicious.svg', 'image/svg+xml', maliciousSvg)],
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'svg' is not allowed")
    })

    it('should reject JavaScript files', async () => {
      const response = await postUpload({
        files: [createMockFile('malicious.js', 'application/javascript', 'alert("XSS")')],
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'js' is not allowed")
    })

    it('should reject files without extensions', async () => {
      const response = await postUpload({
        files: [createMockFile('noextension', 'application/octet-stream')],
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'noextension' is not allowed")
    })

    it('should handle multiple files with mixed valid/invalid types', async () => {
      const response = await postUpload({
        files: [
          createMockFile('valid.pdf', 'application/pdf', 'valid content'),
          createMockFile('malicious.html', 'text/html', '<script>alert("XSS")</script>'),
        ],
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'html' is not allowed")
    })
  })

  describe('Authentication Requirements', () => {
    it('should reject uploads without authentication', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))
      const response = await postUpload({ files: [createMockFile('test.pdf')] })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('Execution-scoped upload authorization', () => {
    const executionTuple = {
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
    }

    const without = (field: keyof typeof executionTuple) =>
      Object.fromEntries(Object.entries(executionTuple).filter(([key]) => key !== field))

    it('rejects invalid execution ownership before storage and accepts its canonical tuple', async () => {
      const malformed = [
        ['missing executionId', without('executionId')],
        ['missing workflowId', without('workflowId')],
        ['missing workspaceId', without('workspaceId')],
        ['blank workflowId', { ...executionTuple, workflowId: '' }],
        ['mixed owners', { ...executionTuple, knowledgeBaseId: 'knowledge-1' }, 'knowledge-base'],
      ] as const
      for (const [label, fields, type] of malformed) {
        readWorkflowAccessContext.mockClear()
        const response = await postUpload({ fields, type })
        expect(response.status, label).toBe(400)
        expect(readWorkflowAccessContext, label).not.toHaveBeenCalled()
      }

      readWorkflowAccessContext.mockResolvedValueOnce(null)
      expect((await postUpload({ fields: executionTuple })).status).toBe(404)
      readWorkflowAccessContext.mockResolvedValueOnce({
        workflow: { workspaceId: 'workspace-1' },
        isOwner: false,
        isWorkspaceOwner: false,
        workspacePermission: 'read',
      })
      expect((await postUpload({ fields: executionTuple })).status).toBe(403)
      expect(
        (
          await postUpload({
            fields: { ...executionTuple, workspaceId: 'other-workspace' },
          })
        ).status
      ).toBe(400)
      expect(storageHasCloudStorage).not.toHaveBeenCalled()
      expect(uploadExecutionFile).not.toHaveBeenCalled()

      expect((await postUpload({ fields: executionTuple })).status).toBe(200)
      expect(readWorkflowAccessContext).toHaveBeenLastCalledWith('workflow-1', 'test-user-id')
      expect(uploadExecutionFile).toHaveBeenCalledWith(
        {
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          workspaceId: 'workspace-1',
        },
        expect.any(Buffer),
        'test.txt',
        'text/plain'
      )
    })
  })
})
