/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow Status API Route', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }

  const mockValidateWorkflowAccess = vi.fn()
  const mockLoadWorkflowStateWithFallback = vi.fn()
  const mockLimit = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id-12345678'),
    })

    vi.doMock('drizzle-orm', async (importOriginal) => {
      const actual = await importOriginal<typeof import('drizzle-orm')>()
      return {
        ...actual,
        and: vi.fn((...conditions) => conditions),
        desc: vi.fn((value) => value),
        eq: vi.fn((field, value) => ({ field, value })),
      }
    })

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-id'),
    }))

    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: mockValidateWorkflowAccess,
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      createSuccessResponse: vi.fn((data) => Response.json({ success: true, data })),
      createErrorResponse: vi.fn((error, status) =>
        Response.json({ success: false, error }, { status })
      ),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowStateWithFallback: mockLoadWorkflowStateWithFallback,
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: mockLimit,
              }),
            }),
          }),
        }),
      },
      workflowDeploymentVersion: {
        state: 'state',
        workflowId: 'workflowId',
        isActive: 'isActive',
        createdAt: 'createdAt',
      },
    }))

    mockValidateWorkflowAccess.mockReset()
    mockLoadWorkflowStateWithFallback.mockReset()
    mockLimit.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it(
    'marks variable-only edits as needing redeployment',
    { timeout: 10_000 },
    async () => {
    mockValidateWorkflowAccess.mockResolvedValue({
      error: null,
      workflow: {
        isDeployed: true,
        deployedAt: null,
        isPublished: false,
      },
    })

    mockLoadWorkflowStateWithFallback.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {
        region: {
          id: 'var-1',
          name: 'region',
          value: 'us-west-2',
        },
      },
      source: 'normalized',
    })

    mockLimit.mockResolvedValue([
      {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          variables: {
            region: {
              id: 'var-1',
              name: 'region',
              value: 'us-east-1',
            },
          },
        },
      },
    ])

    const request = new NextRequest('http://localhost:3000/api/workflows/workflow-123/status')
    const params = Promise.resolve({ id: 'workflow-123' })

    const { GET } = await import('@/app/api/workflows/[id]/status/route')
    const response = await GET(request, { params })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.data.needsRedeployment).toBe(true)
    }
  )

  it('does not report redeployment for legacy deployment rows missing variables', async () => {
    mockValidateWorkflowAccess.mockResolvedValue({
      error: null,
      workflow: {
        isDeployed: true,
        deployedAt: null,
        isPublished: false,
      },
    })

    mockLoadWorkflowStateWithFallback.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {
        region: {
          id: 'var-1',
          name: 'region',
          value: 'us-west-2',
        },
      },
      source: 'normalized',
    })

    mockLimit.mockResolvedValue([
      {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        },
      },
    ])

    const request = new NextRequest('http://localhost:3000/api/workflows/workflow-123/status')
    const params = Promise.resolve({ id: 'workflow-123' })

    const { GET } = await import('@/app/api/workflows/[id]/status/route')
    const response = await GET(request, { params })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.data.needsRedeployment).toBe(false)
  })
})
