import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { DeployWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/deploy-workflow'

const mockRegistryState = {
  getActiveWorkflowId: vi.fn(),
  readWorkflowDeploymentStatus: vi.fn(),
  setDeploymentStatus: vi.fn(),
  workflows: {} as Record<string, { workspaceId?: string }>,
}

const mockCopilotState = {
  toolCallsById: {} as Record<string, { params?: Record<string, unknown> }>,
  currentChat: { workspaceId: null },
  readPendingTool: vi.fn(),
  readbackCopilotToolCall: vi.fn(),
  submitBrowserAssertion: vi.fn(),
  openWorkflowChatDeployment: vi.fn(),
  recordToolFailure: vi.fn(),
  abortController: new AbortController(),
}

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => mockRegistryState,
  },
}))

vi.mock('@/stores/copilot/store-access', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => mockCopilotState,
  }),
}))

vi.mock('@/lib/workflows/operations/deployment-utils', () => ({
  getInputFormatExample: vi.fn(() => ''),
}))

describe('DeployWorkflowClientTool channel-safe workflow scoping', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.restoreAllMocks()
    mockRegistryState.getActiveWorkflowId.mockReset()
    mockRegistryState.readWorkflowDeploymentStatus.mockReset()
    mockRegistryState.setDeploymentStatus.mockReset()
    mockRegistryState.workflows = {}
    mockCopilotState.toolCallsById = {}
    mockCopilotState.abortController = new AbortController()
    mockCopilotState.readPendingTool.mockReset().mockImplementation(async (toolCallId: string) => ({
      stage: 'result',
      target: {
        threadId: 'thread',
        resourceId: 'personal-resource',
        runId: 'run',
        toolCallId,
        toolName: 'deploy_workflow',
      },
    }))
    mockCopilotState.readbackCopilotToolCall.mockReset().mockResolvedValue(undefined)
    mockCopilotState.submitBrowserAssertion.mockReset().mockResolvedValue(undefined)
    mockCopilotState.openWorkflowChatDeployment.mockReset().mockResolvedValue(undefined)
    mockCopilotState.recordToolFailure.mockReset()
  })

  it('getInterruptDisplays resolves deployment state only from explicit params', () => {
    mockRegistryState.getActiveWorkflowId.mockImplementation(() => {
      throw new Error('default active workflow must not be used')
    })
    mockRegistryState.readWorkflowDeploymentStatus.mockReturnValue({ isDeployed: true })

    const toolCallId = 'deploy-tool-call-interrupt'
    mockCopilotState.toolCallsById[toolCallId] = {
      params: {
        action: 'deploy',
        entityId: 'wf-explicit',
      },
    }

    const tool = new DeployWorkflowClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'deploy_workflow',
      contextEntityKind: 'workflow',
      contextEntityId: 'wf-context',
    })

    const displays = tool.getInterruptDisplays()

    expect(displays?.accept.text).toBe('Redeploy')
    expect(mockRegistryState.getActiveWorkflowId).not.toHaveBeenCalled()
    expect(mockRegistryState.readWorkflowDeploymentStatus).toHaveBeenCalledWith('wf-explicit')
  })

  it('dynamic text does not consult the default active workflow when entityId param is absent', () => {
    mockRegistryState.getActiveWorkflowId.mockImplementation(() => {
      throw new Error('default active workflow must not be used')
    })
    mockRegistryState.readWorkflowDeploymentStatus.mockReturnValue({ isDeployed: true })

    const textWithoutWorkflowId = DeployWorkflowClientTool.metadata.getDynamicText?.(
      { action: 'deploy' },
      ClientToolCallState.pending
    )
    const textWithWorkflowId = DeployWorkflowClientTool.metadata.getDynamicText?.(
      { action: 'deploy', entityId: 'wf-explicit' },
      ClientToolCallState.pending
    )

    expect(textWithoutWorkflowId).toBe('Deploy workflow?')
    expect(textWithWorkflowId).toBe('Redeploy workflow?')
    expect(mockRegistryState.getActiveWorkflowId).not.toHaveBeenCalled()
    expect(mockRegistryState.readWorkflowDeploymentStatus).toHaveBeenCalledWith('wf-explicit')
  })

  it('execute deploys using explicit entityId without default active workflow', async () => {
    mockRegistryState.getActiveWorkflowId.mockImplementation(() => {
      throw new Error('default active workflow must not be used')
    })
    mockRegistryState.readWorkflowDeploymentStatus.mockReturnValue(null)
    mockRegistryState.workflows = {}

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

      if (url.includes('/api/workflows/wf-target/deploy')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ deployedAt: '2026-03-03T00:00:00.000Z', apiKey: 'server-key' }),
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
      contextEntityKind: 'workflow',
      contextEntityId: 'wf-context',
      workspaceId: 'ws-1',
    })

    await tool.execute({ action: 'deploy', deployType: 'api', entityId: 'wf-target' })

    const deployRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url.includes('/api/workflows/wf-target/deploy')
    })

    expect(deployRequest).toBeDefined()
    expect(JSON.parse(String(deployRequest?.[1]?.body))).toEqual({
      native: {
        workspaceId: null,
        target: {
          threadId: 'thread',
          resourceId: 'personal-resource',
          runId: 'run',
          toolCallId,
          toolName: 'deploy_workflow',
        },
      },
    })
    expect(deployRequest?.[1]?.signal).toBe(mockCopilotState.abortController.signal)
    expect(mockCopilotState.readbackCopilotToolCall).toHaveBeenCalledExactlyOnceWith(
      toolCallId,
      undefined
    )
    expect(mockRegistryState.getActiveWorkflowId).not.toHaveBeenCalled()
    expect(mockRegistryState.setDeploymentStatus).toHaveBeenCalledWith(
      'wf-target',
      true,
      expect.any(Date),
      'server-key'
    )
  })
  it('waits for the actual target form before recording opened UI and native acknowledgement', async () => {
    let rendered!: () => void
    mockCopilotState.openWorkflowChatDeployment.mockReturnValue(
      new Promise<void>((resolve) => {
        rendered = resolve
      })
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const tool = new DeployWorkflowClientTool('chat-ui-call')
    tool.setExecutionContext({
      toolCallId: 'chat-ui-call',
      toolName: 'deploy_workflow',
      workspaceId: 'entity-workspace',
    })
    const execution = tool.execute({
      action: 'deploy',
      deployType: 'chat',
      entityId: 'explicit-workflow',
    })
    await vi.waitFor(() =>
      expect(mockCopilotState.openWorkflowChatDeployment).toHaveBeenCalledOnce()
    )
    expect(mockCopilotState.openWorkflowChatDeployment).toHaveBeenCalledWith('chat-ui-call', {
      workflowId: 'explicit-workflow',
      workspaceId: 'entity-workspace',
    })
    expect(mockCopilotState.submitBrowserAssertion).not.toHaveBeenCalled()
    expect(tool.getState()).toBe(ClientToolCallState.executing)
    rendered()
    await execution
    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockCopilotState.submitBrowserAssertion).toHaveBeenCalledExactlyOnceWith(
      'chat-ui-call',
      {
        kind: 'ui.opened',
        data: {
          opened: true,
          surface: 'chat-deployment',
          message: 'Opened chat deployment settings',
        },
      }
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockCopilotState.readbackCopilotToolCall).not.toHaveBeenCalled()
  })

  it('retains an opened UI after failed ACK and never reopens or claims deployment', async () => {
    mockCopilotState.submitBrowserAssertion.mockRejectedValue(new Error('ACK lost'))
    const tool = new DeployWorkflowClientTool('chat-failed-ack')
    tool.setExecutionContext({
      toolCallId: 'chat-failed-ack',
      toolName: 'deploy_workflow',
      workspaceId: 'entity-workspace',
    })
    const args = {
      action: 'deploy' as const,
      deployType: 'chat' as const,
      entityId: 'explicit-workflow',
    }
    await tool.execute(args)
    await tool.execute(args)
    expect(mockCopilotState.openWorkflowChatDeployment).toHaveBeenCalledOnce()
    expect(mockCopilotState.submitBrowserAssertion).toHaveBeenCalledOnce()
    expect(tool.getState()).toBe(ClientToolCallState.error)
    expect(tool.hasSubmittedResult()).toBe(false)
    expect(mockCopilotState.recordToolFailure).toHaveBeenCalledWith(
      'chat-failed-ack',
      'Chat deployment settings opened; native acknowledgement failed'
    )
    expect(mockRegistryState.setDeploymentStatus).not.toHaveBeenCalled()
    expect(mockCopilotState.readbackCopilotToolCall).not.toHaveBeenCalled()
  })

  it.each(['approval', 'closed', 'cancelled'] as const)(
    'refuses %s chat opening without an opened assertion',
    async (kind) => {
      const tool = new DeployWorkflowClientTool('chat-refusal')
      tool.setExecutionContext({
        toolCallId: 'chat-refusal',
        toolName: 'deploy_workflow',
        workspaceId: 'entity-workspace',
      })
      if (kind === 'approval')
        mockCopilotState.readPendingTool.mockResolvedValue({ stage: 'approval' })
      if (kind === 'closed')
        mockCopilotState.openWorkflowChatDeployment.mockRejectedValue(
          new Error('Dialog closed before rendering')
        )
      if (kind === 'cancelled') mockCopilotState.abortController.abort()
      await tool.execute({
        action: 'deploy',
        deployType: 'chat',
        entityId: 'explicit-workflow',
      })
      expect(mockCopilotState.submitBrowserAssertion).not.toHaveBeenCalled()
      expect(tool.getState()).toBe(ClientToolCallState.error)
      if (kind !== 'closed')
        expect(mockCopilotState.openWorkflowChatDeployment).not.toHaveBeenCalled()
    }
  )
  it('undeployment carries native target then reads actual postcondition without inventing a completion callback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ isDeployed: false, deployedAt: null }))
    vi.stubGlobal('fetch', fetchMock)
    const tool = new DeployWorkflowClientTool('undeploy-call')
    tool.setExecutionContext({
      toolCallId: 'undeploy-call',
      toolName: 'deploy_workflow',
      workspaceId: 'entity-workspace',
    })
    await tool.execute({
      action: 'undeploy',
      deployType: 'api',
      entityId: 'explicit-workflow',
    })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/workflows/explicit-workflow/deploy',
      expect.objectContaining({ method: 'DELETE', signal: mockCopilotState.abortController.signal })
    )
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      native: {
        workspaceId: null,
        target: { toolCallId: 'undeploy-call', toolName: 'deploy_workflow' },
      },
    })
    expect(mockCopilotState.readbackCopilotToolCall).toHaveBeenCalledExactlyOnceWith(
      'undeploy-call',
      undefined
    )
    expect(mockCopilotState.submitBrowserAssertion).not.toHaveBeenCalled()
  })
})
