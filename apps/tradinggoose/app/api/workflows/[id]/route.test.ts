/**
 * Integration tests for workflow by ID API route
 * Tests the new centralized permissions system
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow By ID API Route', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }

  const mockGetWorkflowById = vi.fn()
  const mockGetWorkflowAccessContext = vi.fn()
  const mockDeleteYjsSessionInSocketServer = vi.fn()
  const mockLoadWorkflowStateWithFallback = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id-12345678'),
    })

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowStateWithFallback: mockLoadWorkflowStateWithFallback,
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      templates: {
        workflowId: 'workflowId',
        id: 'id',
        name: 'name',
        views: 'views',
        stars: 'stars',
      },
      workflow: {
        id: 'id',
      },
    }))

    vi.doMock('@/lib/listing/hydrate-ui', () => ({
      hydrateListingUI: vi.fn().mockImplementation(async (blocks) => blocks),
    }))

    mockGetWorkflowById.mockReset()
    mockGetWorkflowAccessContext.mockReset()
    mockDeleteYjsSessionInSocketServer.mockReset()
    mockLoadWorkflowStateWithFallback.mockReset()
    mockDeleteYjsSessionInSocketServer.mockResolvedValue(undefined)
    mockLoadWorkflowStateWithFallback.mockResolvedValue(null)

    vi.doMock('@/lib/yjs/server/snapshot-bridge', () => ({
      deleteYjsSessionInSocketServer: mockDeleteYjsSessionInSocketServer,
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      getWorkflowById: mockGetWorkflowById,
      getWorkflowAccessContext: mockGetWorkflowAccessContext,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/workflows/[id]', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when workflow does not exist', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(null)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: null,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: false,
        isWorkspaceOwner: false,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/nonexistent')
      const params = Promise.resolve({ id: 'nonexistent' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
    })

    it('should allow access when user owns the workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }

      const mockWorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        source: 'normalized',
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      mockLoadWorkflowStateWithFallback.mockResolvedValueOnce(mockWorkflowState)

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.id).toBe('workflow-123')
    })

    it('should allow access when user has workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const mockWorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        source: 'normalized',
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: 'admin',
        isOwner: false,
        isWorkspaceOwner: false,
      })

      mockLoadWorkflowStateWithFallback.mockResolvedValueOnce(mockWorkflowState)

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: 'read',
        isOwner: false,
        isWorkspaceOwner: false,
      })

      vi.doMock('@/lib/permissions/utils', () => ({
        getUserEntityPermissions: vi.fn().mockResolvedValue('read'),
        hasAdminPermission: vi.fn().mockResolvedValue(false),
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.id).toBe('workflow-123')
    })

    it('should deny access when user has no workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: null,
        isOwner: false,
        isWorkspaceOwner: false,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Access denied')
    })

    it('should return Yjs-backed workflow state when the authoritative loader has it', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }

      const mockWorkflowState = {
        blocks: { 'block-1': { id: 'block-1', type: 'input_trigger' } },
        edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2' }],
        loops: {},
        parallels: {},
        source: 'yjs',
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      mockLoadWorkflowStateWithFallback.mockResolvedValueOnce(mockWorkflowState)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.state.blocks).toEqual(mockWorkflowState.blocks)
      expect(data.data.state.edges).toEqual(mockWorkflowState.edges)
    })

    it('should return an empty state when no normalized data exists yet', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.state.blocks).toEqual({})
      expect(data.data.state.edges).toEqual([])
      expect(data.data.state.loops).toEqual({})
      expect(data.data.state.parallels).toEqual({})
    })
  })

  describe('DELETE /api/workflows/[id]', () => {
    it('should delete the socket/Yjs session after deleting the workflow row', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }
      const events: string[] = []

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })
      mockDeleteYjsSessionInSocketServer.mockImplementationOnce(async () => {
        events.push('socket-delete')
      })

      vi.doMock('@tradinggoose/db', () => ({
        db: {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(async () => {
              events.push('db-delete')
              return [{ id: 'workflow-123' }]
            }),
          }),
        },
        workflow: {},
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { DELETE } = await import('@/app/api/workflows/[id]/route')
      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(mockDeleteYjsSessionInSocketServer).toHaveBeenCalledWith('workflow-123')
      expect(events).toEqual(['db-delete', 'socket-delete'])
    })

    it('should not clean up the Yjs session if workflow row deletion fails', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }
      const deleteWhereMock = vi.fn().mockRejectedValue(new Error('db offline'))

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      vi.doMock('@tradinggoose/db', () => ({
        db: {
          delete: vi.fn().mockReturnValue({
            where: deleteWhereMock,
          }),
        },
        workflow: {},
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { DELETE } = await import('@/app/api/workflows/[id]/route')
      const response = await DELETE(req, { params })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Internal server error')
      expect(deleteWhereMock).toHaveBeenCalledOnce()
      expect(mockDeleteYjsSessionInSocketServer).not.toHaveBeenCalled()
    })

    it('should allow admin to delete workspace workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: 'admin',
        isOwner: false,
        isWorkspaceOwner: false,
      })

      vi.doMock('@tradinggoose/db', () => ({
        db: {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 'workflow-123' }]),
          }),
        },
        workflow: {},
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { DELETE } = await import('@/app/api/workflows/[id]/route')
      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })

    it('should continue deleting the workflow row when socket/Yjs cleanup fails', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }
      const deleteWhereMock = vi.fn().mockResolvedValue([{ id: 'workflow-123' }])

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })
      mockDeleteYjsSessionInSocketServer.mockRejectedValueOnce(new Error('socket offline'))

      vi.doMock('@tradinggoose/db', () => ({
        db: {
          delete: vi.fn().mockReturnValue({
            where: deleteWhereMock,
          }),
        },
        workflow: {},
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { DELETE } = await import('@/app/api/workflows/[id]/route')
      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(deleteWhereMock).toHaveBeenCalledOnce()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete socket/Yjs session for workflow workflow-123'),
        expect.objectContaining({
          workflowId: 'workflow-123',
        })
      )
    })

    it('should deny deletion for non-admin users', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: null,
        isOwner: false,
        isWorkspaceOwner: false,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { DELETE } = await import('@/app/api/workflows/[id]/route')
      const response = await DELETE(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Access denied')
    })
  })

  describe('PUT /api/workflows/[id]', () => {
    it('should allow owner to update workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }

      const updateData = { name: 'Updated Workflow' }
      const updatedWorkflow = { ...mockWorkflow, ...updateData, updatedAt: new Date() }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      vi.doMock('@tradinggoose/db', () => ({
        db: {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([updatedWorkflow]),
              }),
            }),
          }),
        },
        workflow: {},
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { PUT } = await import('@/app/api/workflows/[id]/route')
      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.name).toBe('Updated Workflow')
    })

    it('should allow users with write permission to update workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updateData = { name: 'Updated Workflow' }
      const updatedWorkflow = { ...mockWorkflow, ...updateData, updatedAt: new Date() }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: 'write',
        isOwner: false,
        isWorkspaceOwner: false,
      })

      vi.doMock('@tradinggoose/db', () => ({
        db: {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([updatedWorkflow]),
              }),
            }),
          }),
        },
        workflow: {},
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { PUT } = await import('@/app/api/workflows/[id]/route')
      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.name).toBe('Updated Workflow')
    })

    it('should deny update for users with only read permission', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updateData = { name: 'Updated Workflow' }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: 'read',
        isOwner: false,
        isWorkspaceOwner: false,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { PUT } = await import('@/app/api/workflows/[id]/route')
      const response = await PUT(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Access denied')
    })

    it('should validate request data', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockGetWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      // Invalid data - empty name
      const invalidData = { name: '' }

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(invalidData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { PUT } = await import('@/app/api/workflows/[id]/route')
      const response = await PUT(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Invalid request data')
    })
  })

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockGetWorkflowById.mockRejectedValueOnce(new Error('Database connection timeout'))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Internal server error')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })
})
