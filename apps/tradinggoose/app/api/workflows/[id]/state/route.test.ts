import { NextRequest } from 'next/server'
/**
 * @vitest-environment node
 */
import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setVariables } from '@/lib/yjs/workflow-session'

describe('Workflow State API Route', () => {
  let liveDoc: Y.Doc | null
  let saveWorkflowToNormalizedTablesMock: ReturnType<typeof vi.fn>
  let tryApplyWorkflowStateMock: ReturnType<typeof vi.fn>
  let updateSetMock: ReturnType<typeof vi.fn>

  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost:3000/api/workflows/workflow-id/state', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    })

  const validStateBody = {
    blocks: {
      'block-1': {
        id: 'block-1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    liveDoc = null
    saveWorkflowToNormalizedTablesMock = vi.fn().mockResolvedValue({ success: true })
    tryApplyWorkflowStateMock = vi.fn().mockResolvedValue({ success: true })
    updateSetMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    })

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value })),
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      workflow: {
        id: 'id',
      },
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        update: vi.fn().mockReturnValue({
          set: updateSetMock,
        }),
      },
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-id'),
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      getWorkflowAccessContext: vi.fn().mockResolvedValue({
        isOwner: true,
        workflow: {
          id: 'workflow-id',
          workspaceId: 'workspace-id',
          variables: {
            'db-var': {
              id: 'db-var',
              workflowId: 'workflow-id',
              name: 'dbVar',
              type: 'plain',
              value: 'db value',
            },
          },
        },
      }),
    }))

    vi.doMock('@/lib/workflows/validation', () => ({
      sanitizeAgentToolsInBlocks: vi.fn((blocks) => ({
        blocks,
        warnings: [],
      })),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      saveWorkflowToNormalizedTables: saveWorkflowToNormalizedTablesMock,
    }))

    vi.doMock('@/lib/workflows/custom-tools-persistence', () => ({
      extractAndPersistCustomTools: vi.fn().mockResolvedValue({
        saved: 0,
        errors: [],
      }),
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      tryApplyWorkflowState: tryApplyWorkflowStateMock,
    }))

    vi.doMock('@/socket-server/yjs/upstream-utils', () => ({
      getExistingDocument: vi.fn(async () => liveDoc),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to live Yjs variables when the request body omits them', async () => {
    liveDoc = new Y.Doc()
    setVariables(
      liveDoc,
      {
        'live-var': {
          id: 'live-var',
          workflowId: 'workflow-id',
          name: 'liveVar',
          type: 'plain',
          value: 'live value',
        },
      },
      'test'
    )

    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(createRequest(validStateBody), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(200)
    expect(tryApplyWorkflowStateMock).toHaveBeenCalledWith(
      'workflow-id',
      expect.any(Object),
      {
        'live-var': expect.objectContaining({
          name: 'liveVar',
          value: 'live value',
        }),
      }
    )
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          'live-var': expect.objectContaining({
            name: 'liveVar',
            value: 'live value',
          }),
        },
      })
    )
  })

  it('falls back to canonical workflow-row variables when no live doc is mounted', async () => {
    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(createRequest(validStateBody), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(200)
    expect(tryApplyWorkflowStateMock).toHaveBeenCalledWith(
      'workflow-id',
      expect.any(Object),
      {
        'db-var': expect.objectContaining({
          name: 'dbVar',
          value: 'db value',
        }),
      }
    )
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          'db-var': expect.objectContaining({
            name: 'dbVar',
            value: 'db value',
          }),
        },
      })
    )
  })

  it('does not apply Yjs state when the canonical save fails', async () => {
    saveWorkflowToNormalizedTablesMock.mockResolvedValueOnce({
      success: false,
      error: 'validation failed',
    })

    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(createRequest(validStateBody), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(500)
    expect(tryApplyWorkflowStateMock).not.toHaveBeenCalled()
  })
})
