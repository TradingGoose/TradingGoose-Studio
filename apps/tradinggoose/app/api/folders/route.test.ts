/**
 * Tests for folders API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CapturedFolderValues,
  createMockRequest,
  mockAuth,
  mockLogger,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

describe('Folders API Route', () => {
  const mockFolders = [
    {
      id: 'folder-1',
      name: 'Test Folder 1',
      userId: 'user-123',
      workspaceId: 'workspace-123',
      parentId: null,
      color: '#6B7280',
      isExpanded: true,
      sortOrder: 0,
      createdAt: new Date('2023-01-01T00:00:00.000Z'),
      updatedAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    {
      id: 'folder-2',
      name: 'Test Folder 2',
      userId: 'user-123',
      workspaceId: 'workspace-123',
      parentId: 'folder-1',
      color: '#EF4444',
      isExpanded: false,
      sortOrder: 1,
      createdAt: new Date('2023-01-02T00:00:00.000Z'),
      updatedAt: new Date('2023-01-02T00:00:00.000Z'),
    },
  ]

  const { mockAuthenticatedUser, mockUnauthenticated } = mockAuth()
  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'

  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockOrderBy = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()
  const mockReturning = vi.fn()
  const mockTransaction = vi.fn()
  const mockTxExecute = vi.fn()
  const mockGetUserEntityPermissions = vi.fn()

  function createFolderTransaction(options?: {
    selectResults?: any[][]
    insertResult?: any[]
    captureValues?: (values: CapturedFolderValues) => void
  }) {
    const selectResults = [...(options?.selectResults ?? [[]])]
    return async (callback: any) =>
      callback({
        execute: mockTxExecute,
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const rows = selectResults.shift() ?? []
              return {
                limit: vi.fn().mockReturnValue(rows),
                orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue(rows) }),
              }
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation((values) => {
            options?.captureValues?.(values)
            return {
              returning: vi.fn().mockReturnValue(options?.insertResult ?? [mockFolders[0]]),
            }
          }),
        }),
      })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    setupCommonApiMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ orderBy: mockOrderBy })
    mockOrderBy.mockReturnValue(mockFolders)

    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })
    mockReturning.mockReturnValue([mockFolders[0]])

    mockGetUserEntityPermissions.mockResolvedValue('admin')

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        transaction: mockTransaction,
      },
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      getUserEntityPermissions: mockGetUserEntityPermissions,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/folders', () => {
    it('should return folders for a valid workspace', async () => {
      mockAuthenticatedUser()

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const { GET } = await import('@/app/api/folders/route')
      const response = await GET(mockRequest)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folders')
      expect(data.folders).toHaveLength(2)
      expect(data.folders[0]).toMatchObject({
        id: 'folder-1',
        name: 'Test Folder 1',
        workspaceId: 'workspace-123',
      })
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const { GET } = await import('@/app/api/folders/route')
      const response = await GET(mockRequest)

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 400 when workspaceId is missing', async () => {
      mockAuthenticatedUser()

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders',
      })

      const { GET } = await import('@/app/api/folders/route')
      const response = await GET(mockRequest)

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Workspace ID is required')
    })

    it('should return 403 when user has no workspace permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue(null) // No permissions

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const { GET } = await import('@/app/api/folders/route')
      const response = await GET(mockRequest)

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Access denied to this workspace')
    })

    it('should return 403 when user has only read permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read') // Read-only permissions

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const { GET } = await import('@/app/api/folders/route')
      const response = await GET(mockRequest)

      expect(response.status).toBe(200) // Should work for read permissions

      const data = await response.json()
      expect(data).toHaveProperty('folders')
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()

      mockSelect.mockImplementationOnce(() => {
        throw new Error('Database connection failed')
      })

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const { GET } = await import('@/app/api/folders/route')
      const response = await GET(mockRequest)

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching folders:', {
        error: expect.any(Error),
      })
    })
  })

  describe('POST /api/folders', () => {
    it('should create a new folder successfully', async () => {
      mockAuthenticatedUser()

      mockTransaction.mockImplementationOnce(createFolderTransaction())

      const req = createMockRequest('POST', {
        name: 'New Test Folder',
        workspaceId: 'workspace-123',
        color: '#6B7280',
      })

      const { POST } = await import('@/app/api/folders/route')
      const response = await POST(req)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
      expect(data.folder).toMatchObject({
        id: 'folder-1',
        name: 'Test Folder 1',
        workspaceId: 'workspace-123',
      })
      expect(mockTxExecute).toHaveBeenCalledOnce()
    })

    it('should create folder with correct sort order', async () => {
      mockAuthenticatedUser()

      mockTransaction.mockImplementationOnce(
        createFolderTransaction({
          selectResults: [[{ sortOrder: 5 }]],
          insertResult: [{ ...mockFolders[0], sortOrder: 6 }],
        })
      )

      const req = createMockRequest('POST', {
        name: 'New Test Folder',
        workspaceId: 'workspace-123',
      })

      const { POST } = await import('@/app/api/folders/route')
      const response = await POST(req)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.folder).toMatchObject({
        sortOrder: 6,
      })
    })

    it('should create subfolder with parent reference', async () => {
      mockAuthenticatedUser()

      mockTransaction.mockImplementationOnce(
        createFolderTransaction({
          selectResults: [[mockFolders[0]], []],
          insertResult: [{ ...mockFolders[1] }],
        })
      )

      const req = createMockRequest('POST', {
        name: 'Subfolder',
        workspaceId: 'workspace-123',
        parentId: 'folder-1',
      })

      const { POST } = await import('@/app/api/folders/route')
      const response = await POST(req)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.folder).toMatchObject({
        parentId: 'folder-1',
      })
    })

    it.each([
      { parentFolder: mockFolders[1], label: 'nested' },
      {
        parentFolder: { ...mockFolders[0], workspaceId: 'other-workspace' },
        label: 'cross-workspace',
      },
    ])('should reject a $label parent folder', async ({ parentFolder }) => {
      mockAuthenticatedUser()
      mockTransaction.mockImplementationOnce(
        createFolderTransaction({ selectResults: [[parentFolder]] })
      )

      const req = createMockRequest('POST', {
        name: 'Invalid subfolder',
        workspaceId: 'workspace-123',
        parentId: parentFolder.id,
      })

      const { POST } = await import('@/app/api/folders/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Parent folder must be a root folder in this workspace',
      })
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      const { POST } = await import('@/app/api/folders/route')
      const response = await POST(req)

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 403 when user has only read permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read') // Read-only permissions

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      const { POST } = await import('@/app/api/folders/route')
      const response = await POST(req)

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Write or Admin access required to create folders')
    })

    it.each(['write', 'admin'])(
      'should allow folder creation for %s permissions',
      async (permission) => {
        mockAuthenticatedUser()
        mockGetUserEntityPermissions.mockResolvedValue(permission)

        mockTransaction.mockImplementationOnce(createFolderTransaction())

        const req = createMockRequest('POST', {
          name: 'Test Folder',
          workspaceId: 'workspace-123',
        })

        const { POST } = await import('@/app/api/folders/route')
        const response = await POST(req)

        expect(response.status).toBe(200)

        const data = await response.json()
        expect(data).toHaveProperty('folder')
      }
    )

    it('should return 400 when required fields are missing', async () => {
      const testCases = [
        { name: '', workspaceId: 'workspace-123' }, // Missing name
        { name: 'Test Folder', workspaceId: '' }, // Missing workspaceId
        { workspaceId: 'workspace-123' }, // Missing name entirely
        { name: 'Test Folder' }, // Missing workspaceId entirely
      ]

      for (const body of testCases) {
        mockAuthenticatedUser()

        const req = createMockRequest('POST', body)

        const { POST } = await import('@/app/api/folders/route')
        const response = await POST(req)

        expect(response.status).toBe(400)

        const data = await response.json()
        expect(data).toHaveProperty('error', 'Name and workspace ID are required')
      }
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()

      // Make transaction throw an error
      mockTransaction.mockImplementationOnce(() => {
        throw new Error('Database transaction failed')
      })

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      const { POST } = await import('@/app/api/folders/route')
      const response = await POST(req)

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error creating folder:', {
        error: expect.any(Error),
      })
    })

    it('should trim the folder name and apply the default color', async () => {
      mockAuthenticatedUser()

      let capturedValues: CapturedFolderValues | null = null

      mockTransaction.mockImplementationOnce(
        createFolderTransaction({ captureValues: (values) => (capturedValues = values) })
      )

      const req = createMockRequest('POST', {
        name: '  Test Folder With Spaces  ',
        workspaceId: 'workspace-123',
      })

      const { POST } = await import('@/app/api/folders/route')
      await POST(req)

      expect(capturedValues).not.toBeNull()
      expect(capturedValues!.name).toBe('Test Folder With Spaces')
      expect(capturedValues!.color).toBe('#6B7280')
    })
  })
})
