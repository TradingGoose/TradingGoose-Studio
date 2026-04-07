/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Revert To Deployment Version API Route', () => {
  const callOrder: string[] = []

  const mockValidateWorkflowPermissions = vi.fn()
  const mockSaveWorkflowToNormalizedTables = vi.fn()
  const mockTryApplyWorkflowState = vi.fn()
  const mockDbSelectLimit = vi.fn()
  const mockDbUpdateWhere = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    callOrder.length = 0

    mockValidateWorkflowPermissions.mockResolvedValue({ error: null })
    mockSaveWorkflowToNormalizedTables.mockImplementation(async () => {
      callOrder.push('save')
      return { success: true }
    })
    mockTryApplyWorkflowState.mockImplementation(async () => {
      callOrder.push('apply')
      return { success: true }
    })
    mockDbSelectLimit.mockResolvedValue([
      {
        state: {
          blocks: {
            'block-1': {
              id: 'block-1',
              type: 'script',
              subBlocks: {},
            },
          },
          edges: [],
          loops: {},
          parallels: {},
          variables: {
            'var-1': {
              id: 'var-1',
              workflowId: 'workflow-1',
              name: 'region',
              type: 'plain',
              value: 'us-west-2',
            },
          },
        },
      },
    ])
    mockDbUpdateWhere.mockImplementation(async () => {
      callOrder.push('db-update')
    })

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => conditions),
      eq: vi.fn((field, value) => ({ field, value })),
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: mockDbSelectLimit,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: mockDbUpdateWhere,
          }),
        }),
      },
      workflow: {
        id: 'workflow.id',
      },
      workflowDeploymentVersion: {
        state: 'state',
        workflowId: 'workflowId',
        isActive: 'isActive',
        version: 'version',
        createdAt: 'createdAt',
      },
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-id'),
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      validateWorkflowPermissions: mockValidateWorkflowPermissions,
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      tryApplyWorkflowState: mockTryApplyWorkflowState,
    }))

    vi.doMock('@/lib/yjs/workflow-session', () => ({
      createWorkflowSnapshot: vi.fn((partial) => ({
        blocks: partial.blocks ?? {},
        edges: partial.edges ?? [],
        loops: partial.loops ?? {},
        parallels: partial.parallels ?? {},
        lastSaved: partial.lastSaved,
        isDeployed: partial.isDeployed,
        deployedAt: partial.deployedAt,
      })),
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      createErrorResponse: vi.fn((error, status) =>
        Response.json({ error }, { status })
      ),
      createSuccessResponse: vi.fn((data) =>
        Response.json({ data }, { status: 200 })
      ),
    }))

    vi.doMock('@/app/api/indicator-monitors/reconcile', () => ({
      notifyIndicatorMonitorsReconcile: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/app/api/indicator-monitors/shared', () => ({
      pauseMonitorsMissingDeployedIndicatorTrigger: vi.fn().mockResolvedValue(undefined),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('publishes the reverted Yjs state only after the durable writes complete', async () => {
    const { POST } = await import('@/app/api/workflows/[id]/deployments/[version]/revert/route')
    const request = new NextRequest(
      'http://localhost:3000/api/workflows/workflow-1/deployments/active/revert'
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1', version: 'active' }),
    })

    expect(response.status).toBe(200)
    expect(callOrder).toEqual(['save', 'db-update', 'apply'])
    expect(mockTryApplyWorkflowState).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        blocks: expect.any(Object),
        edges: [],
        loops: {},
        parallels: {},
      }),
      expect.objectContaining({
        'var-1': expect.objectContaining({
          name: 'region',
          value: 'us-west-2',
        }),
      })
    )
  })

  it('does not publish the reverted Yjs state when the workflow row update fails', async () => {
    mockDbUpdateWhere.mockRejectedValueOnce(new Error('database unavailable'))

    const { POST } = await import('@/app/api/workflows/[id]/deployments/[version]/revert/route')
    const request = new NextRequest(
      'http://localhost:3000/api/workflows/workflow-1/deployments/active/revert'
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1', version: 'active' }),
    })

    expect(response.status).toBe(500)
    expect(callOrder).toEqual(['save'])
    expect(mockTryApplyWorkflowState).not.toHaveBeenCalled()
  })
})
