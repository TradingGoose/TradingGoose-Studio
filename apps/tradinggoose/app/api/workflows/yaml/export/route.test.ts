import { NextRequest } from 'next/server'
/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow YAML Export API Route', () => {
  let loadWorkflowStateMock: ReturnType<typeof vi.fn>
  let makeRequestMock: ReturnType<typeof vi.fn>
  let validateWorkflowPermissionsMock: ReturnType<typeof vi.fn>

  const workflowRow = {
    id: 'workflow-id',
    isDeployed: false,
    deployedAt: null,
  }

  const createRequest = (workflowId = 'workflow-id') =>
    new NextRequest(`http://localhost:3000/api/workflows/yaml/export?workflowId=${workflowId}`)

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    loadWorkflowStateMock = vi.fn()
    validateWorkflowPermissionsMock = vi.fn().mockResolvedValue({
      error: null,
      workflow: workflowRow,
    })
    makeRequestMock = vi.fn().mockResolvedValue({
      success: true,
      data: { yaml: 'name: exported' },
    })

    vi.doMock('@/lib/workflows/utils', () => ({
      validateWorkflowPermissions: validateWorkflowPermissionsMock,
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
      WORKFLOW_REALTIME_REQUIRED_CODE: 'WORKFLOW_REALTIME_REQUIRED',
      isWorkflowRealtimeRequiredError: vi.fn(() => false),
      requireWorkflowRealtimeState: loadWorkflowStateMock,
    }))

    vi.doMock('@/lib/copilot/workflow/block-output-utils', () => ({
      extractSubBlockValuesFromBlocks: vi.fn((blocks: Record<string, any>) =>
        Object.fromEntries(
          Object.entries(blocks).map(([blockId, block]) => [
            blockId,
            Object.fromEntries(
              Object.entries(block?.subBlocks || {}).map(
                ([subBlockId, subBlock]: [string, any]) => [subBlockId, subBlock?.value]
              )
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

  it('denies export before reading live workflow state', async () => {
    validateWorkflowPermissionsMock.mockResolvedValueOnce({
      error: { message: 'Unauthorized: Access denied to read this workflow', status: 403 },
      workflow: null,
    })

    const { GET } = await import('@/app/api/workflows/yaml/export/route')
    const response = await GET(createRequest())

    expect(response.status).toBe(403)
    expect(loadWorkflowStateMock).not.toHaveBeenCalled()
    expect(makeRequestMock).not.toHaveBeenCalled()
  })

  it(
    'uses the current workflow state and includes variables in the export payload',
    { timeout: 10_000 },
    async () => {
      loadWorkflowStateMock.mockResolvedValue({
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
      })

      const { GET } = await import('@/app/api/workflows/yaml/export/route')
      const response = await GET(createRequest())

      expect(response.status).toBe(200)
      expect(validateWorkflowPermissionsMock).toHaveBeenCalledWith(
        'workflow-id',
        'request-id',
        'read'
      )
      expect(loadWorkflowStateMock).toHaveBeenCalledWith('workflow-id')
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
})
