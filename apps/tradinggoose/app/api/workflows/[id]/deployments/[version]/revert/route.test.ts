/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Revert To Deployment Version API Route', () => {
  const mockValidateWorkflowPermissions = vi.fn()
  const mockApplyWorkflowState = vi.fn()
  const mockDbSelectLimit = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockValidateWorkflowPermissions.mockResolvedValue({ error: null })
    mockApplyWorkflowState.mockResolvedValue(undefined)
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
      ensureUniqueBlockIds: vi.fn(async (_workflowId: string, state: any) => state),
      ensureUniqueEdgeIds: vi.fn(async (_workflowId: string, state: any) => state),
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      applyWorkflowState: mockApplyWorkflowState,
    }))

    vi.doMock('@/lib/yjs/workflow-session', () => ({
      createWorkflowSnapshot: vi.fn((partial) => ({
        blocks: partial.blocks ?? {},
        edges: partial.edges ?? [],
        loops: partial.loops ?? {},
        parallels: partial.parallels ?? {},
        lastSaved: partial.lastSaved,
      })),
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      createErrorResponse: vi.fn((error, status) => Response.json({ error }, { status })),
      createSuccessResponse: vi.fn((data) => Response.json({ data }, { status: 200 })),
    }))

    vi.doMock('@/app/api/monitors/reconcile', () => ({
      notifyMonitorsReconcile: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/app/api/monitors/shared', () => ({
      pauseMonitorsMissingDeployedTrigger: vi.fn().mockResolvedValue(undefined),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('applies the reverted deployment state through the workflow state helper', async () => {
    const { POST } = await import('@/app/api/workflows/[id]/deployments/[version]/revert/route')
    const request = new NextRequest(
      'http://localhost:3000/api/workflows/workflow-1/deployments/active/revert'
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1', version: 'active' }),
    })

    expect(response.status).toBe(200)
    expect(mockApplyWorkflowState).toHaveBeenCalledWith(
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

  it('reports workflow state apply failures', async () => {
    mockApplyWorkflowState.mockRejectedValueOnce(new Error('database unavailable'))

    const { POST } = await import('@/app/api/workflows/[id]/deployments/[version]/revert/route')
    const request = new NextRequest(
      'http://localhost:3000/api/workflows/workflow-1/deployments/active/revert'
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1', version: 'active' }),
    })

    expect(response.status).toBe(500)
    expect(mockApplyWorkflowState).toHaveBeenCalledOnce()
  })

  it('preserves current variables when the deployment snapshot omits variables', async () => {
    mockDbSelectLimit.mockResolvedValueOnce([
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
        },
      },
    ])

    const { POST } = await import('@/app/api/workflows/[id]/deployments/[version]/revert/route')
    const request = new NextRequest(
      'http://localhost:3000/api/workflows/workflow-1/deployments/active/revert'
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1', version: 'active' }),
    })

    expect(response.status).toBe(200)
    expect(mockApplyWorkflowState).toHaveBeenCalledWith('workflow-1', expect.any(Object), undefined)
  })
})
