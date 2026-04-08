import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { DeployWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/deploy-workflow'

const mockRegistryState = {
  getActiveWorkflowId: vi.fn(),
  getWorkflowDeploymentStatus: vi.fn(),
  setDeploymentStatus: vi.fn(),
  workflows: {} as Record<string, { workspaceId?: string }>,
}

const mockCopilotState = {
  toolCallsById: {} as Record<string, { params?: Record<string, any> }>,
}

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => mockRegistryState,
  },
}))

vi.mock('@/stores/copilot/store', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => mockCopilotState,
  }),
}))

vi.mock('@/lib/workflows/operations/deployment-utils', () => ({
  getInputFormatExample: vi.fn(() => ''),
}))

describe('DeployWorkflowClientTool channel-safe workflow scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockRegistryState.getActiveWorkflowId.mockReset()
    mockRegistryState.getWorkflowDeploymentStatus.mockReset()
    mockRegistryState.setDeploymentStatus.mockReset()
    mockRegistryState.workflows = {}
    mockCopilotState.toolCallsById = {}
  })

  it('getInterruptDisplays resolves workflow from params/context without default-channel active fallback', () => {
    mockRegistryState.getActiveWorkflowId.mockImplementation(() => {
      throw new Error('default-channel fallback must not be used')
    })
    mockRegistryState.getWorkflowDeploymentStatus.mockReturnValue({ isDeployed: true })

    const toolCallId = 'deploy-tool-call-interrupt'
    mockCopilotState.toolCallsById[toolCallId] = {
      params: {
        action: 'deploy',
      },
    }

    const tool = new DeployWorkflowClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'deploy_workflow',
      channelId: 'pair-red',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    const displays = tool.getInterruptDisplays()

    expect(displays?.accept.text).toBe('Redeploy')
    expect(mockRegistryState.getActiveWorkflowId).not.toHaveBeenCalled()
    expect(mockRegistryState.getWorkflowDeploymentStatus).toHaveBeenCalledWith('wf-context')
  })

  it('dynamic text does not consult default active workflow when workflowId param is absent', () => {
    mockRegistryState.getActiveWorkflowId.mockImplementation(() => {
      throw new Error('default-channel fallback must not be used')
    })
    mockRegistryState.getWorkflowDeploymentStatus.mockReturnValue({ isDeployed: true })

    const textWithoutWorkflowId = DeployWorkflowClientTool.metadata.getDynamicText?.(
      { action: 'deploy' },
      ClientToolCallState.pending
    )
    const textWithWorkflowId = DeployWorkflowClientTool.metadata.getDynamicText?.(
      { action: 'deploy', workflowId: 'wf-explicit' },
      ClientToolCallState.pending
    )

    expect(textWithoutWorkflowId).toBe('Deploy workflow?')
    expect(textWithWorkflowId).toBe('Redeploy workflow?')
    expect(mockRegistryState.getActiveWorkflowId).not.toHaveBeenCalled()
    expect(mockRegistryState.getWorkflowDeploymentStatus).toHaveBeenCalledWith('wf-explicit')
  })

  it('handleAccept deploys using execution-context workflow without default active fallback', async () => {
    mockRegistryState.getActiveWorkflowId.mockImplementation(() => {
      throw new Error('default-channel fallback must not be used')
    })
    mockRegistryState.getWorkflowDeploymentStatus.mockReturnValue(null)
    mockRegistryState.workflows = {
      'wf-context': { workspaceId: 'ws-1' },
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/workspaces/ws-1/api-keys')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ keys: [{ id: 'workspace-key' }] }),
        }
      }

      if (url.includes('/api/users/me/api-keys')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ keys: [] }),
        }
      }

      if (url.includes('/api/workflows/wf-context/deploy')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ deployedAt: '2026-03-03T00:00:00.000Z', apiKey: 'server-key' }),
        }
      }

      if (url.includes('/api/copilot/tools/mark-complete')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} ${init?.method || 'GET'}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const toolCallId = 'deploy-tool-call-accept'
    const tool = new DeployWorkflowClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'deploy_workflow',
      channelId: 'pair-blue',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.handleAccept({ action: 'deploy', deployType: 'api' })

    const deployRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url.includes('/api/workflows/wf-context/deploy')
    })

    expect(deployRequest).toBeDefined()
    expect(mockRegistryState.getActiveWorkflowId).not.toHaveBeenCalled()
    expect(mockRegistryState.setDeploymentStatus).toHaveBeenCalledWith(
      'wf-context',
      true,
      expect.any(Date),
      'server-key'
    )
  })
})
