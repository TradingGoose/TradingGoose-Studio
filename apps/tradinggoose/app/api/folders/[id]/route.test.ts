/**
 * Tests for individual folder API route (/api/folders/[id])
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CapturedFolderValues,
  createMockRequest,
  type MockUser,
  mockAuth,
  mockLogger,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

interface FolderDbMockOptions {
  folderLookupResult?: any
  transactionSelectResults?: any[][]
  updateResults?: any[][]
  captureUpdate?: (values: CapturedFolderValues, index: number) => void
  throwError?: boolean
}

describe('Individual Folder API Route', () => {
  const TEST_USER: MockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  }

  const mockFolder = {
    id: 'folder-1',
    name: 'Test Folder',
    userId: TEST_USER.id,
    workspaceId: 'workspace-123',
    parentId: null,
    color: '#6B7280',
    sortOrder: 1,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  }

  const { mockAuthenticatedUser, mockUnauthenticated } = mockAuth(TEST_USER)
  const mockGetUserEntityPermissions = vi.fn()
  const mockRefreshWorkflowList = vi.fn()

  function createFolderDbMock(options: FolderDbMockOptions = {}) {
    const {
      folderLookupResult = mockFolder,
      transactionSelectResults = [
        [{ id: 'parent-folder-1', workspaceId: mockFolder.workspaceId, parentId: null }],
        [],
      ],
      updateResults = [[{ ...mockFolder, name: 'Updated Folder' }]],
      captureUpdate,
      throwError = false,
    } = options

    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          then: vi.fn().mockImplementation((callback) => {
            if (throwError) {
              throw new Error('Database error')
            }

            return Promise.resolve(callback(folderLookupResult ? [folderLookupResult] : []))
          }),
        })),
      })),
    })

    const queuedSelectResults = transactionSelectResults.map((rows) => [...rows])
    const mockTransactionSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockReturnValue(queuedSelectResults.shift() ?? []),
        })),
      }),
    })

    const queuedUpdateResults = updateResults.map((rows) => [...rows])
    let updateIndex = 0
    const mockExecute = vi.fn()
    const mockUpdate = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((values) => {
        captureUpdate?.(values, updateIndex++)
        const rows = queuedUpdateResults.shift() ?? []
        return {
          where: vi.fn().mockImplementation(() => ({
            returning: vi.fn().mockReturnValue(rows),
          })),
        }
      }),
    }))

    const mockDelete = vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => Promise.resolve()),
    }))

    return {
      db: {
        select: mockSelect,
        transaction: vi.fn(async (callback) =>
          callback({
            execute: mockExecute,
            select: mockTransactionSelect,
            update: mockUpdate,
            delete: mockDelete,
          })
        ),
      },
      mocks: {
        select: mockSelect,
        execute: mockExecute,
        transactionSelect: mockTransactionSelect,
        update: mockUpdate,
        delete: mockDelete,
      },
    }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonApiMocks()

    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockRefreshWorkflowList.mockResolvedValue(undefined)

    vi.doMock('@/lib/permissions/utils', () => ({
      getUserEntityPermissions: mockGetUserEntityPermissions,
    }))
    vi.doMock('@/lib/workflows/db-helpers', () => ({
      refreshWorkflowList: mockRefreshWorkflowList,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('PUT /api/folders/[id]', () => {
    it('should update folder successfully', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock()
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder Name',
        color: '#FF0000',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
      expect(data.folder).toMatchObject({
        name: 'Updated Folder',
      })
      expect(dbMock.mocks.execute).toHaveBeenCalledOnce()
    })

    it('should update parent folder successfully', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock()
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
        parentId: 'parent-folder-1',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const dbMock = createFolderDbMock()
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 403 when user has only read permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read') // Read-only permissions

      const dbMock = createFolderDbMock()
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Write access required to update folders')
    })

    it.each(['write', 'admin'])(
      'should allow folder update for %s permissions',
      async (permission) => {
        mockAuthenticatedUser()
        mockGetUserEntityPermissions.mockResolvedValue(permission)

        const dbMock = createFolderDbMock()
        vi.doMock('@tradinggoose/db', () => dbMock)

        const req = createMockRequest('PUT', {
          name: 'Updated Folder',
        })
        const params = Promise.resolve({ id: 'folder-1' })

        const { PUT } = await import('@/app/api/folders/[id]/route')

        const response = await PUT(req, { params })

        expect(response.status).toBe(200)

        const data = await response.json()
        expect(data).toHaveProperty('folder')
      }
    )

    it('should return 400 when trying to set folder as its own parent', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock()
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
        parentId: 'folder-1', // Same as the folder ID
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Folder cannot be its own parent')
    })

    it('should trim folder name when updating', async () => {
      mockAuthenticatedUser()

      let capturedUpdates: CapturedFolderValues | null = null
      const dbMock = createFolderDbMock({
        updateResults: [[{ ...mockFolder, name: 'Folder With Spaces' }]],
        captureUpdate: (updates) => {
          capturedUpdates = updates
        },
      })

      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: '  Folder With Spaces  ',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      await PUT(req, { params })

      expect(capturedUpdates).not.toBeNull()
      expect(capturedUpdates!.name).toBe('Folder With Spaces')
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock({
        throwError: true,
      })
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error updating folder:', {
        error: expect.any(Error),
      })
    })
  })

  describe('Input Validation', () => {
    it('should handle empty folder name', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock()
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: '', // Empty name
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      const response = await PUT(req, { params })

      // Should still work as the API doesn't validate empty names
      expect(response.status).toBe(200)
    })

    it('should handle invalid JSON payload', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock()
      vi.doMock('@tradinggoose/db', () => dbMock)

      // Create a request with invalid JSON
      const req = new Request('http://localhost:3000/api/folders/folder-1', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid-json',
      }) as any

      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('@/app/api/folders/[id]/route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(500) // Should handle JSON parse error gracefully
    })
  })

  describe('Folder depth validation', () => {
    it.each([
      {
        label: 'nested',
        parentFolder: { id: 'nested-parent', workspaceId: 'workspace-123', parentId: 'root' },
      },
      {
        label: 'cross-workspace',
        parentFolder: { id: 'foreign-parent', workspaceId: 'other-workspace', parentId: null },
      },
    ])('should reject a $label parent folder', async ({ parentFolder }) => {
      mockAuthenticatedUser()
      const dbMock = createFolderDbMock({
        transactionSelectResults: [[parentFolder]],
      })
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', { parentId: parentFolder.id })
      const { PUT } = await import('@/app/api/folders/[id]/route')
      const response = await PUT(req, { params: Promise.resolve({ id: mockFolder.id }) })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Parent folder must be a root folder in this workspace',
      })
    })

    it('should reject nesting a folder that already has a child', async () => {
      mockAuthenticatedUser()
      const dbMock = createFolderDbMock({
        transactionSelectResults: [
          [{ id: 'root-parent', workspaceId: 'workspace-123', parentId: null }],
          [{ id: 'child-folder' }],
        ],
      })
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('PUT', { parentId: 'root-parent' })
      const { PUT } = await import('@/app/api/folders/[id]/route')
      const response = await PUT(req, { params: Promise.resolve({ id: mockFolder.id }) })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'A folder with subfolders cannot be nested under another folder',
      })
    })
  })

  describe('DELETE /api/folders/[id]', () => {
    it('should delete the folder and move direct child folders and workflows up one level', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock({
        folderLookupResult: { ...mockFolder, parentId: 'parent-folder' },
        transactionSelectResults: [[{ ...mockFolder, parentId: 'parent-folder' }]],
        updateResults: [[{ id: 'child-folder' }], [{ id: 'workflow-1' }]],
      })

      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('@/app/api/folders/[id]/route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('success', true)
      expect(data).toMatchObject({
        deletedFolderId: 'folder-1',
        parentId: 'parent-folder',
        movedFolders: 1,
        movedWorkflows: 1,
      })
      expect(mockRefreshWorkflowList).toHaveBeenCalledWith('workspace-123')
    })

    it('should return 401 for unauthenticated delete requests', async () => {
      mockUnauthenticated()

      const dbMock = createFolderDbMock()
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('@/app/api/folders/[id]/route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it.each(['read', 'write'])(
      'should return 403 for %s permissions on delete',
      async (permission) => {
        mockAuthenticatedUser()
        mockGetUserEntityPermissions.mockResolvedValue(permission)

        const dbMock = createFolderDbMock()
        vi.doMock('@tradinggoose/db', () => dbMock)

        const req = createMockRequest('DELETE')
        const params = Promise.resolve({ id: 'folder-1' })

        const { DELETE } = await import('@/app/api/folders/[id]/route')

        const response = await DELETE(req, { params })

        expect(response.status).toBe(403)

        const data = await response.json()
        expect(data).toHaveProperty('error', 'Admin access required to delete folders')
      }
    )

    it('should allow folder deletion for admin permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('admin') // Admin permissions

      const dbMock = createFolderDbMock({
        folderLookupResult: mockFolder,
        transactionSelectResults: [[mockFolder]],
        updateResults: [[], []],
      })
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('@/app/api/folders/[id]/route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('success', true)
    })

    it('should handle database errors during deletion', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock({
        throwError: true,
      })
      vi.doMock('@tradinggoose/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('@/app/api/folders/[id]/route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error deleting folder:', {
        error: expect.any(Error),
      })
    })
  })
})
