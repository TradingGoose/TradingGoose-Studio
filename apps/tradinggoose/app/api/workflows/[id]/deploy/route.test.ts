/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockValidateWorkflowPermissions = vi.fn()
const mockLoadWorkflowStateWithFallback = vi.fn()
const mockDbLimit = vi.fn()

describe('Workflow Deploy API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockLoadWorkflowStateWithFallback.mockResolvedValue(null)
    mockDbLimit.mockReset()

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
      validateWorkflowPermissions: (...args: unknown[]) =>
        mockValidateWorkflowPermissions(...args),
      hasWorkflowChanged: vi.fn().mockReturnValue(false),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      deployWorkflow: vi.fn(),
      loadWorkflowStateWithFallback: (...args: unknown[]) =>
        mockLoadWorkflowStateWithFallback(...args),
    }))

    vi.doMock('@/lib/chat/published-deployment', () => ({
      hasChatTriggerBlocks: vi.fn().mockReturnValue(false),
      removePublishedChatsForWorkflowTx: vi.fn(),
    }))

    vi.doMock('@/app/api/indicator-monitors/reconcile', () => ({
      notifyIndicatorMonitorsReconcile: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/app/api/indicator-monitors/shared', () => ({
      pauseMonitorsMissingDeployedIndicatorTrigger: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      createErrorResponse: vi.fn((error: string, status: number) =>
        Response.json({ error }, { status })
      ),
      createSuccessResponse: vi.fn((data: unknown) => Response.json(data, { status: 200 })),
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => conditions),
      desc: vi.fn((value) => value),
      eq: vi.fn((field, value) => ({ field, value })),
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: (...args: unknown[]) => mockDbLimit(...args),
              orderBy: vi.fn().mockReturnValue({
                limit: (...args: unknown[]) => mockDbLimit(...args),
              }),
            }),
          }),
        }),
      },
      apiKey: {
        id: 'apiKey.id',
        key: 'apiKey.key',
        name: 'apiKey.name',
        type: 'apiKey.type',
        userId: 'apiKey.userId',
        expiresAt: 'apiKey.expiresAt',
        lastUsed: 'apiKey.lastUsed',
        createdAt: 'apiKey.createdAt',
      },
      workflow: {
        id: 'workflow.id',
      },
      workflowDeploymentVersion: {
        state: 'workflowDeploymentVersion.state',
        workflowId: 'workflowDeploymentVersion.workflowId',
        isActive: 'workflowDeploymentVersion.isActive',
        createdAt: 'workflowDeploymentVersion.createdAt',
      },
    }))
  })

  it('returns deployment info when the workflow is not deployed', async () => {
    mockValidateWorkflowPermissions.mockResolvedValueOnce({
      error: null,
      workflow: {
        id: 'workflow-1',
        userId: 'user-1',
        isDeployed: false,
      },
    })

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost:3000/api/workflows/workflow-1/deploy'),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      isDeployed: false,
      hasReusableApiKey: false,
    })
  })

  it('returns deployment info when the workflow is already deployed', async () => {
    mockValidateWorkflowPermissions.mockResolvedValueOnce({
      error: null,
      workflow: {
        id: 'workflow-1',
        userId: 'user-1',
        isDeployed: true,
        pinnedApiKeyId: null,
        deployedAt: new Date('2026-04-13T00:00:00.000Z').toISOString(),
        lastSynced: new Date('2026-04-13T00:00:00.000Z').toISOString(),
      },
    })
    mockDbLimit
      .mockResolvedValueOnce([
        {
          key: 'api-key',
          name: 'Primary key',
          type: 'personal',
        },
      ])
      .mockResolvedValueOnce([
        {
          state: null,
        },
      ])

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost:3000/api/workflows/workflow-1/deploy'),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      isDeployed: true,
      apiKey: 'Primary key (personal)',
    })
  })
})
