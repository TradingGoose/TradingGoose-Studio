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

  const mockReadWorkflowById = vi.fn()
  const mockReadWorkflowAccessContext = vi.fn()
  const mockLoadWorkflowState = vi.fn()
  const mockRefreshWorkflowListForWorkflow = vi.fn()
  const mockRefreshWorkflowList = vi.fn()
  const mockDeleteYjsSession = vi.fn()
  const mockAssertCanDeleteWorkspaceEntityDocument = vi.fn()
  const mockDbUpdateReturning = vi.fn()
  const mockDbUpdateWhere = vi.fn()
  const mockDbUpdateSet = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id-12345678'),
    })

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      WORKFLOW_REALTIME_REQUIRED_CODE: 'WORKFLOW_REALTIME_REQUIRED',
      isWorkflowRealtimeRequiredError: vi.fn(() => false),
      requireWorkflowRealtimeState: mockLoadWorkflowState,
      refreshWorkflowListForWorkflow: mockRefreshWorkflowListForWorkflow,
      refreshWorkflowList: mockRefreshWorkflowList,
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: mockDbUpdateSet,
        }),
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      workflow: {
        id: 'id',
        folderId: 'folderId',
      },
    }))

    vi.doMock('@/lib/listing/hydrate-ui', () => ({
      hydrateListingUI: vi.fn().mockImplementation(async (blocks) => blocks),
    }))

    mockReadWorkflowById.mockReset()
    mockReadWorkflowAccessContext.mockReset()
    mockLoadWorkflowState.mockReset()
    mockRefreshWorkflowListForWorkflow.mockReset()
    mockRefreshWorkflowList.mockReset()
    mockDeleteYjsSession.mockReset()
    mockAssertCanDeleteWorkspaceEntityDocument.mockReset()
    mockDbUpdateReturning.mockReset()
    mockDbUpdateWhere.mockReset()
    mockDbUpdateSet.mockReset()
    mockLoadWorkflowState.mockResolvedValue(null)
    mockRefreshWorkflowListForWorkflow.mockResolvedValue(undefined)
    mockDbUpdateWhere.mockReturnValue({ returning: mockDbUpdateReturning })
    mockDbUpdateSet.mockReturnValue({ where: mockDbUpdateWhere })
    mockDbUpdateReturning.mockResolvedValue([
      {
        id: 'workflow-123',
        name: 'Updated Workflow',
        description: 'Updated description',
        folderId: 'folder-1',
        workspaceId: null,
      },
    ])
    mockRefreshWorkflowList.mockResolvedValue(undefined)
    mockDeleteYjsSession.mockResolvedValue(undefined)
    mockAssertCanDeleteWorkspaceEntityDocument.mockResolvedValue(undefined)

    vi.doMock('@/lib/workspaces/entity-documents', () => ({
      assertCanDeleteWorkspaceEntityDocument: mockAssertCanDeleteWorkspaceEntityDocument,
      WorkspaceEntityDocumentDeletionError: class extends Error {
        status = 400
      },
    }))

    vi.doMock('@/lib/yjs/server/snapshot-bridge', () => ({
      deleteYjsSessionInSocketServer: mockDeleteYjsSession,
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      readWorkflowById: mockReadWorkflowById,
      readWorkflowAccessContext: mockReadWorkflowAccessContext,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function expectWorkflowRenameApplied() {
    expect(mockLoadWorkflowState).not.toHaveBeenCalled()
    expect(mockDbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated Workflow' })
    )
    expect(mockRefreshWorkflowListForWorkflow).toHaveBeenCalledWith('workflow-123')
  }

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

      mockReadWorkflowById.mockResolvedValueOnce(null)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
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
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      mockLoadWorkflowState.mockResolvedValueOnce(mockWorkflowState)

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
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
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: 'admin',
        isOwner: false,
        isWorkspaceOwner: false,
      })

      mockLoadWorkflowState.mockResolvedValueOnce(mockWorkflowState)

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: 'read',
        isOwner: false,
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

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
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

    it('should return current workflow state when the loader has it', async () => {
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
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      mockLoadWorkflowState.mockResolvedValueOnce(mockWorkflowState)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('@/app/api/workflows/[id]/route')
      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.state.blocks).toEqual(mockWorkflowState.blocks)
      expect(data.data.state.edges).toEqual(mockWorkflowState.edges)
    })

    it('should return 409 when current workflow state is missing', async () => {
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

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
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

      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data.error).toBe('Workflow state is missing')
    })
  })

  describe('DELETE /api/workflows/[id]', () => {
    it('should delete the workflow row before non-blocking Yjs cleanup', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: null,
      }
      const events: string[] = []
      mockDeleteYjsSession.mockImplementation(async () => {
        events.push('yjs-delete')
        throw new Error('socket offline')
      })

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
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
      expect(events).toEqual(['db-delete', 'yjs-delete'])
    })

    it('should return 500 if workflow row deletion fails before session cleanup', async () => {
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

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
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
      expect(mockDeleteYjsSession).not.toHaveBeenCalled()
      expect(deleteWhereMock).toHaveBeenCalledOnce()
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

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
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
      expect(mockRefreshWorkflowList).toHaveBeenCalledWith('workspace-456')
      expect(mockAssertCanDeleteWorkspaceEntityDocument).toHaveBeenCalledWith({
        entityKind: 'workflow',
        workspaceId: 'workspace-456',
      })
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

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
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

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

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
      expectWorkflowRenameApplied()
    })

    it('should allow users with write permission to update workflow', async () => {
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

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: 'workspace-456',
        workspacePermission: 'write',
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

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.name).toBe('Updated Workflow')
      expectWorkflowRenameApplied()
    })

    it('updates workflow metadata without loading workflow state', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        description: 'Old description',
        folderId: null,
        workspaceId: null,
      }

      const updateData = { description: 'New description' }
      mockDbUpdateReturning.mockResolvedValueOnce([
        {
          ...mockWorkflow,
          ...updateData,
          updatedAt: new Date(),
        },
      ])

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { PUT } = await import('@/app/api/workflows/[id]/route')
      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.description).toBe('New description')
      expect(mockLoadWorkflowState).not.toHaveBeenCalled()
      expect(mockDbUpdateSet).toHaveBeenCalledWith(expect.objectContaining(updateData))
      expect(mockRefreshWorkflowListForWorkflow).toHaveBeenCalledWith('workflow-123')
    })

    it('updates workflow row metadata and publishes list fields', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        description: 'Old description',
        folderId: null,
        workspaceId: null,
      }
      const updateData = {
        name: 'Updated Workflow',
        description: 'New description',
        folderId: 'folder-1',
      }
      mockDbUpdateReturning.mockResolvedValueOnce([
        {
          ...mockWorkflow,
          ...updateData,
          updatedAt: new Date(),
        },
      ])

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

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
      expect(data.workflow.description).toBe('New description')
      expect(data.workflow.folderId).toBe('folder-1')
      expect(mockLoadWorkflowState).not.toHaveBeenCalled()
      expect(mockDbUpdateSet).toHaveBeenCalledWith(expect.objectContaining(updateData))
      expect(mockRefreshWorkflowListForWorkflow).toHaveBeenCalledWith('workflow-123')
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

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
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

      mockReadWorkflowById.mockResolvedValueOnce(mockWorkflow)
      mockReadWorkflowAccessContext.mockResolvedValueOnce({
        workflow: mockWorkflow,
        workspaceOwnerId: null,
        workspacePermission: null,
        isOwner: true,
        isWorkspaceOwner: false,
      })

      const invalidData = { name: '   ' }

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
      expect(mockDbUpdateSet).not.toHaveBeenCalled()
    })

    it('should reject generated workflow color updates', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ color: '#3972F6' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { PUT } = await import('@/app/api/workflows/[id]/route')
      const response = await PUT(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Invalid request data')
      expect(JSON.stringify(data.details)).toContain('color')
    })
  })

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      mockReadWorkflowById.mockRejectedValueOnce(new Error('Database connection timeout'))

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
