import { NextRequest } from 'next/server'
/**
 * @vitest-environment node
 */
import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setVariables } from '@/lib/yjs/workflow-session'

describe('Workflow State API Route', () => {
  let liveDoc: Y.Doc | null
  let loadWorkflowStateFromYjsMock: ReturnType<typeof vi.fn>
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
    loadWorkflowStateFromYjsMock = vi.fn().mockResolvedValue(null)
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
      loadWorkflowStateFromYjs: loadWorkflowStateFromYjsMock,
      saveWorkflowToNormalizedTables: saveWorkflowToNormalizedTablesMock,
      toISOStringOrUndefined: vi.fn((value: string | number | Date | null | undefined) =>
        value == null ? undefined : new Date(value).toISOString()
      ),
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

  it('falls back to persisted Yjs variables when no live doc is mounted in-process', async () => {
    loadWorkflowStateFromYjsMock.mockResolvedValueOnce({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {
        'persisted-var': {
          id: 'persisted-var',
          workflowId: 'workflow-id',
          name: 'persistedVar',
          type: 'plain',
          value: 'persisted value',
        },
      },
      lastSaved: Date.now(),
    })

    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(createRequest(validStateBody), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(200)
    expect(tryApplyWorkflowStateMock).toHaveBeenCalledWith(
      'workflow-id',
      expect.any(Object),
      {
        'persisted-var': expect.objectContaining({
          name: 'persistedVar',
          value: 'persisted value',
        }),
      }
    )
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          'persisted-var': expect.objectContaining({
            name: 'persistedVar',
            value: 'persisted value',
          }),
        },
      })
    )
  })

  it('does not republish workflow-row variables when no Yjs state is available in-process', async () => {
    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(createRequest(validStateBody), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(200)
    expect(tryApplyWorkflowStateMock).not.toHaveBeenCalled()
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        variables: expect.anything(),
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
