import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { DeployWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/deploy-workflow'

const mockRegistryState = {
  readWorkflowDeploymentStatus: vi.fn(),
  setDeploymentStatus: vi.fn(),
}

const mockCopilotState = {
  toolCallsById: {} as Record<string, { params?: Record<string, unknown> }>,
  currentChat: { workspaceId: null },
  readPendingTool: vi.fn(),
  readbackCopilotToolCall: vi.fn(),
  submitBrowserAssertion: vi.fn(),
  openWorkflowChatDeployment: vi.fn(),
  recordToolFailure: vi.fn(),
  setToolState: vi.fn(),
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

describe('DeployWorkflowClientTool channel-safe workflow scoping', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.restoreAllMocks()
    mockRegistryState.readWorkflowDeploymentStatus.mockReset()
    mockRegistryState.setDeploymentStatus.mockReset()
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
    mockCopilotState.setToolState.mockReset()
  })

  it('getInterruptDisplays resolves deployment state only from explicit params', () => {
    mockRegistryState.readWorkflowDeploymentStatus.mockReturnValue({ isDeployed: true })

    const toolCallId = 'deploy-tool-call-interrupt'
    mockCopilotState.toolCallsById[toolCallId] = {
      params: {
        action: 'deploy',
        entityId: 'wf-explicit',
      },
    }

    const tool = new DeployWorkflowClientTool(toolCallId)
    tool.setExecutionContext({})

    const displays = tool.getInterruptDisplays()

    expect(displays?.accept.text).toBe('Redeploy')
    expect(mockRegistryState.readWorkflowDeploymentStatus).toHaveBeenCalledWith('wf-explicit')
  })

  it('dynamic text uses deployment state only for the specified entity', () => {
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
    expect(mockRegistryState.readWorkflowDeploymentStatus).toHaveBeenCalledWith('wf-explicit')
  })

  it.each(['deploy', 'undeploy'] as const)(
    '%s uses the explicit target and authoritative readback without workspace discovery',
    async (action) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          deployedAt: action === 'deploy' ? '2026-03-03T00:00:00.000Z' : null,
          apiKey: action === 'deploy' ? 'server-key' : null,
        })
      )
      vi.stubGlobal('fetch', fetchMock)
      const tool = new DeployWorkflowClientTool('deployment-call')
      tool.setExecutionContext({})

      await tool.execute({ action, deployType: 'api', entityId: 'wf-target' })

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/workflows/wf-target/deploy', {
        method: action === 'deploy' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        signal: mockCopilotState.abortController.signal,
        body: JSON.stringify({
          native: {
            workspaceId: null,
            target: {
              threadId: 'thread',
              resourceId: 'personal-resource',
              runId: 'run',
              toolCallId: 'deployment-call',
              toolName: 'deploy_workflow',
            },
          },
        }),
      })
      expect(mockCopilotState.readbackCopilotToolCall).toHaveBeenCalledExactlyOnceWith(
        'deployment-call',
        undefined
      )
      expect(mockCopilotState.submitBrowserAssertion).not.toHaveBeenCalled()
      expect(mockRegistryState.setDeploymentStatus).toHaveBeenCalledExactlyOnceWith(
        'wf-target',
        action === 'deploy',
        action === 'deploy' ? new Date('2026-03-03T00:00:00.000Z') : undefined,
        action === 'deploy' ? 'server-key' : ''
      )
    }
  )
  it.each([false, true])(
    'reads a key refusal authoritatively (readback fails: %s)',
    async (fails) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'Select a valid API key', needsApiKey: true }, { status: 400 })
        )
      vi.stubGlobal('fetch', fetchMock)
      if (fails)
        mockCopilotState.readbackCopilotToolCall.mockRejectedValueOnce(
          new Error('Readback unavailable')
        )
      const tool = new DeployWorkflowClientTool('key-refusal')
      tool.setExecutionContext({ workspaceId: 'ws-1' })

      await tool.execute({ action: 'deploy', deployType: 'api', entityId: 'wf-target' })

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(mockCopilotState.readbackCopilotToolCall).toHaveBeenCalledExactlyOnceWith(
        'key-refusal',
        undefined
      )
      expect(tool.hasSubmittedResult()).toBe(!fails)
      expect(mockCopilotState.submitBrowserAssertion).not.toHaveBeenCalled()
      expect(mockRegistryState.setDeploymentStatus).not.toHaveBeenCalled()
      if (fails) {
        expect(mockCopilotState.recordToolFailure).toHaveBeenCalledWith(
          'key-refusal',
          'Readback unavailable'
        )
      } else expect(mockCopilotState.recordToolFailure).not.toHaveBeenCalled()
    }
  )

  it.each([
    { action: 'deploy', status: 400, needsApiKey: false },
    { action: 'deploy', status: 500, needsApiKey: true },
    { action: 'undeploy', status: 400, needsApiKey: true },
    { action: 'deploy', status: null, needsApiKey: false },
  ] as const)(
    'does not settle an uncertain or unrelated failure: %j',
    async ({ action, status, needsApiKey }) => {
      const fetchMock = vi.fn()
      if (status)
        fetchMock.mockResolvedValue(Response.json({ error: 'Failed', needsApiKey }, { status }))
      else fetchMock.mockRejectedValue(new Error('Failed'))
      vi.stubGlobal('fetch', fetchMock)
      const tool = new DeployWorkflowClientTool('failed-deployment')
      tool.setExecutionContext({ workspaceId: 'ws-1' })

      await tool.execute({ action, deployType: 'api', entityId: 'wf-target' })

      expect(mockCopilotState.recordToolFailure).toHaveBeenCalledWith(
        tool.toolCallId,
        expect.any(String)
      )
      expect(tool.hasSubmittedResult()).toBe(false)
      expect(mockCopilotState.readbackCopilotToolCall).not.toHaveBeenCalled()
      expect(mockCopilotState.submitBrowserAssertion).not.toHaveBeenCalled()
      expect(mockRegistryState.setDeploymentStatus).not.toHaveBeenCalled()
    }
  )

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
    expect(mockCopilotState.setToolState.mock.lastCall?.slice(0, 2)).toEqual([
      tool.toolCallId,
      ClientToolCallState.executing,
    ])
    rendered()
    await execution
    expect(mockCopilotState.setToolState.mock.lastCall?.slice(0, 2)).toEqual([
      tool.toolCallId,
      ClientToolCallState.success,
    ])
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
      expect(mockCopilotState.recordToolFailure).toHaveBeenCalledWith(
        tool.toolCallId,
        expect.any(String)
      )
      if (kind !== 'closed')
        expect(mockCopilotState.openWorkflowChatDeployment).not.toHaveBeenCalled()
    }
  )
})
