/**
 * @vitest-environment node
 */

import { apiKey, workflow, workflowDeploymentVersion } from '@tradinggoose/db/schema'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNativeEffect = vi.fn()
const mockValidateWorkflowPermissions = vi.fn()
const mockLoadWorkflowState = vi.fn()
const mockDbLimit = vi.fn()
const mockDeployWorkflow = vi.fn()
const mockTransaction = vi.fn()

const native = {
  workspaceId: null,
  target: {
    threadId: 'thread',
    resourceId: 'resource',
    runId: 'run',
    toolCallId: 'call',
    toolName: 'deploy_workflow',
  },
}
const validKey = { id: 'key', name: 'Selected key', type: 'personal', userId: 'actual-actor' }
const deploymentPermissions = {
  error: null,
  session: { user: { id: 'actual-actor' } },
  workflow: {
    id: 'workflow-1',
    userId: 'workflow-owner',
    workspaceId: 'workspace-1',
    pinnedApiKeyId: 'key',
  },
}

describe('Workflow Deploy API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockNativeEffect.mockReset()
    mockDeployWorkflow.mockReset().mockResolvedValue({ success: true, deployedAt: new Date() })

    mockLoadWorkflowState.mockResolvedValue(null)
    mockDbLimit.mockReset().mockResolvedValue([])
    mockTransaction.mockReset()
    mockValidateWorkflowPermissions.mockReset().mockResolvedValue(deploymentPermissions)

    vi.doMock('@/lib/copilot/native/workflow-effects', () => ({
      authorizeNativeWorkflowDeploymentEffect: mockNativeEffect,
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
      validateWorkflowPermissions: (...args: unknown[]) => mockValidateWorkflowPermissions(...args),
      hasWorkflowChanged: vi.fn().mockReturnValue(false),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      deployWorkflow: mockDeployWorkflow,
      requireWorkflowRealtimeState: (...args: unknown[]) => mockLoadWorkflowState(...args),
    }))

    vi.doMock('@/lib/chat/published-deployment', () => ({
      hasChatTriggerBlocks: vi.fn().mockReturnValue(false),
      removePublishedChatsForWorkflowTx: vi.fn(),
      reconcilePublishedChatsForDeploymentTx: vi.fn(),
    }))

    vi.doMock('@/app/api/monitors/reconcile', () => ({
      notifyMonitorsReconcile: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/app/api/monitors/shared', () => ({
      pauseMonitorsMissingDeployedTrigger: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      createErrorResponse: vi.fn((error: string, status: number) =>
        Response.json({ error }, { status })
      ),
      createSuccessResponse: vi.fn((data: unknown) => Response.json(data, { status: 200 })),
      createWorkflowRealtimeRequiredResponse: vi.fn(() => null),
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        transaction: mockTransaction,
        update: () => ({ set: () => ({ where: vi.fn() }) }),
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
      apiKey,
      workflow,
      workflowDeploymentVersion,
    }))
  })

  it.each([
    { isDeployed: false, pinnedApiKeyId: null, key: null, reusable: false },
    { isDeployed: true, pinnedApiKeyId: null, key: validKey, reusable: false },
    { isDeployed: true, pinnedApiKeyId: 'key', key: validKey, reusable: true },
    {
      isDeployed: true,
      pinnedApiKeyId: 'key',
      key: { ...validKey, userId: 'workflow-owner' },
      reusable: false,
    },
    {
      isDeployed: true,
      pinnedApiKeyId: 'key',
      key: { ...validKey, expiresAt: new Date(0) },
      reusable: false,
    },
  ])(
    'reads only the actor-accessible pinned key: %j',
    async ({ isDeployed, pinnedApiKeyId, key, reusable }) => {
      mockValidateWorkflowPermissions.mockResolvedValue({
        ...deploymentPermissions,
        workflow: { ...deploymentPermissions.workflow, isDeployed, pinnedApiKeyId },
      })
      if (isDeployed && pinnedApiKeyId) mockDbLimit.mockResolvedValueOnce(key ? [key] : [])
      const { GET } = await import('./route')
      const response = await GET(
        new NextRequest('http://localhost/api/workflows/workflow-1/deploy'),
        {
          params: Promise.resolve({ id: 'workflow-1' }),
        }
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        isDeployed,
        hasReusableApiKey: reusable,
        apiKey: reusable ? 'Selected key (personal)' : null,
      })
      expect(mockDbLimit).toHaveBeenCalledTimes(isDeployed ? (pinnedApiKeyId ? 2 : 1) : 0)
    }
  )
  it.each(['POST', 'DELETE'] as const)(
    'native %s rechecks real actor/target/finance before any deployment mutation',
    async (method) => {
      mockValidateWorkflowPermissions.mockResolvedValueOnce(deploymentPermissions)
      mockDbLimit.mockResolvedValue([validKey])
      const { NativeTargetError } = await import('@/lib/copilot/native/errors')
      mockNativeEffect.mockRejectedValueOnce(new NativeTargetError('Original target is stale', 409))
      const route = await import('./route')
      const response = await route[method](
        new NextRequest('http://localhost/api/workflows/workflow-1/deploy', {
          method,
          body: JSON.stringify({ native }),
        }),
        { params: Promise.resolve({ id: 'workflow-1' }) }
      )
      expect(response.status).toBe(409)
      expect(mockNativeEffect).toHaveBeenCalledWith(
        'actual-actor',
        'workflow-1',
        native,
        method === 'POST' ? 'deploy' : 'undeploy',
        expect.any(AbortSignal)
      )
      expect(mockDeployWorkflow).not.toHaveBeenCalled()
    }
  )

  it.each(
    ['deploy', 'activate'].flatMap((route) =>
      [null, { ...validKey, expiresAt: new Date(0) }, { ...validKey, userId: 'other' }].map(
        (key) => ({ route, key })
      )
    )
  )('refuses $route before mutation for invalid key $key', async ({ route, key }) => {
    mockDbLimit.mockResolvedValue(key ? [key] : [])
    const { POST } = await (route === 'deploy'
      ? import('./route')
      : import('../deployments/[version]/activate/route'))
    const deploy = () =>
      POST(
        new NextRequest('http://localhost/api/workflows/workflow-1/deploy', {
          method: 'POST',
          body: JSON.stringify({ native }),
        }),
        { params: Promise.resolve({ id: 'workflow-1', version: '1' }) }
      )
    const refused = await deploy()
    expect(refused.status).toBe(400)
    expect(mockNativeEffect).not.toHaveBeenCalled()
    expect(mockDeployWorkflow).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
    if (route === 'activate') return
    expect(await refused.json()).toMatchObject({ needsApiKey: true })

    mockDbLimit.mockResolvedValue([validKey])
    expect((await deploy()).status).toBe(200)
    expect(mockNativeEffect).toHaveBeenCalledOnce()
    expect(mockDeployWorkflow).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        pinnedApiKeyId: 'key',
        deployedBy: 'actual-actor',
      })
    )
    expect(mockNativeEffect.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeployWorkflow.mock.invocationCallOrder[0]!
    )
  })

  it.each(['GET', 'POST', 'activate'] as const)('requires an actor for %s', async (method) => {
    mockValidateWorkflowPermissions.mockResolvedValue({ ...deploymentPermissions, session: null })
    const handler =
      method === 'activate'
        ? (await import('../deployments/[version]/activate/route')).POST
        : (await import('./route'))[method]
    const response = await handler(
      new NextRequest('http://localhost/api/workflows/workflow-1/deploy', {
        method: method === 'GET' ? 'GET' : 'POST',
      }),
      { params: Promise.resolve({ id: 'workflow-1', version: '1' }) }
    )
    expect(response.status).toBe(401)
    expect(mockDbLimit).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockDeployWorkflow).not.toHaveBeenCalled()
  })
})
