import { NextRequest } from 'next/server'
/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow YAML Export API Route', () => {
  let loadWorkflowStateWithFallbackMock: ReturnType<typeof vi.fn>
  let makeRequestMock: ReturnType<typeof vi.fn>

  const workflowRow = {
    id: 'workflow-id',
    userId: 'user-id',
    workspaceId: 'workspace-id',
    variables: {
      'db-var': {
        id: 'db-var',
        workflowId: 'workflow-id',
        name: 'fallbackVar',
        type: 'plain',
        value: 'fallback',
      },
    },
    isDeployed: false,
    deployedAt: null,
  }

  const createRequest = (workflowId = 'workflow-id') =>
    new NextRequest(`http://localhost:3000/api/workflows/yaml/export?workflowId=${workflowId}`)

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    loadWorkflowStateWithFallbackMock = vi.fn()
    makeRequestMock = vi.fn().mockResolvedValue({
      success: true,
      data: { yaml: 'name: exported' },
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
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([workflowRow]),
          }),
        }),
      },
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      getUserEntityPermissions: vi.fn().mockResolvedValue('write'),
    }))

    vi.doMock('@/lib/copilot/agent/client', () => ({
      simAgentClient: {
        makeRequest: makeRequestMock,
      },
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

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowStateWithFallback: loadWorkflowStateWithFallbackMock,
    }))

    vi.doMock('@/lib/copilot/tools/client/workflow/block-output-utils', () => ({
      extractSubBlockValuesFromBlocks: vi.fn((blocks: Record<string, any>) =>
        Object.fromEntries(
          Object.entries(blocks).map(([blockId, block]) => [
            blockId,
            Object.fromEntries(
              Object.entries(block?.subBlocks || {}).map(([subBlockId, subBlock]: [string, any]) => [
                subBlockId,
                subBlock?.value,
              ])
            ),
          ])
        )
      ),
    }))

    vi.doMock('@/blocks/registry', () => ({
      getAllBlocks: vi.fn(() => []),
    }))

    vi.doMock('@/blocks/utils', () => ({
      resolveOutputType: vi.fn(),
    }))

    vi.doMock('@/stores/workflows/workflow/utils', () => ({
      generateLoopBlocks: vi.fn(),
      generateParallelBlocks: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it(
    'prefers the live Yjs workflow snapshot and includes variables in the export payload',
    { timeout: 10_000 },
    async () => {
    loadWorkflowStateWithFallbackMock.mockResolvedValue({
      blocks: {
        'live-block': {
          id: 'live-block',
          type: 'agent',
          name: 'Live Agent',
          position: { x: 0, y: 0 },
          subBlocks: {
            prompt: { id: 'prompt', type: 'long-input', value: 'live value' },
          },
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {
        'live-var': {
          id: 'live-var',
          workflowId: 'workflow-id',
          name: 'liveVar',
          type: 'plain',
          value: 'live',
        },
      },
      lastSaved: Date.now(),
      source: 'yjs',
    })

    const { GET } = await import('@/app/api/workflows/yaml/export/route')
    const response = await GET(createRequest())

    expect(response.status).toBe(200)
      expect(makeRequestMock).toHaveBeenCalledWith(
        '/api/workflow/to-yaml',
        expect.objectContaining({
          body: expect.objectContaining({
            workflowState: expect.objectContaining({
              blocks: expect.objectContaining({
                'live-block': expect.objectContaining({ name: 'Live Agent' }),
              }),
              variables: {
                'live-var': expect.objectContaining({
                  name: 'liveVar',
                  value: 'live',
                }),
              },
            }),
            subBlockValues: {
              'live-block': {
                prompt: 'live value',
              },
            },
          }),
        })
      )
    }
  )

  it('falls back to canonical saved state and workflow-row variables when no live doc exists', async () => {
    loadWorkflowStateWithFallbackMock.mockResolvedValue({
      blocks: {
        'db-block': {
          id: 'db-block',
          type: 'agent',
          name: 'Saved Agent',
          position: { x: 10, y: 20 },
          subBlocks: {
            prompt: { id: 'prompt', type: 'long-input', value: 'saved value' },
          },
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {
        'db-var': {
          id: 'db-var',
          workflowId: 'workflow-id',
          name: 'fallbackVar',
          type: 'plain',
          value: 'fallback',
        },
      },
      lastSaved: Date.now(),
      source: 'normalized',
    })

    const { GET } = await import('@/app/api/workflows/yaml/export/route')
    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    expect(loadWorkflowStateWithFallbackMock).toHaveBeenCalledWith('workflow-id')
    expect(makeRequestMock).toHaveBeenCalledWith(
      '/api/workflow/to-yaml',
      expect.objectContaining({
        body: expect.objectContaining({
          workflowState: expect.objectContaining({
            blocks: expect.objectContaining({
              'db-block': expect.objectContaining({ name: 'Saved Agent' }),
            }),
            variables: {
              'db-var': expect.objectContaining({
                name: 'fallbackVar',
                value: 'fallback',
              }),
            },
          }),
          subBlockValues: {
            'db-block': {
              prompt: 'saved value',
            },
          },
        }),
      })
    )
  }, 10000)
})
