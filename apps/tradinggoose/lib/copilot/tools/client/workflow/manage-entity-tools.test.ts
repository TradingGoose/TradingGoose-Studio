import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolArgSchemas, ToolResultSchemas } from '@/lib/copilot/registry'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { ManageCustomToolClientTool } from '@/lib/copilot/tools/client/workflow/manage-custom-tool'
import { ManageMcpToolClientTool } from '@/lib/copilot/tools/client/workflow/manage-mcp-tool'
import { ManageSkillClientTool } from '@/lib/copilot/tools/client/workflow/manage-skill'

const mockRegistryState = {
  workflows: {} as Record<string, { workspaceId?: string }>,
}

const mockCopilotState = {
  toolCallsById: {} as Record<string, { params?: Record<string, unknown> }>,
}

const mockCustomToolsStore = {
  getTool: vi.fn(),
}

const mockSkillsStore = {
  getSkill: vi.fn(),
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

vi.mock('@/stores/custom-tools/store', () => ({
  useCustomToolsStore: {
    getState: () => mockCustomToolsStore,
  },
}))

vi.mock('@/stores/skills/store', () => ({
  useSkillsStore: {
    getState: () => mockSkillsStore,
  },
}))

describe('manage_* tool TradingGoose parity', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockRegistryState.workflows = {
      'wf-context': { workspaceId: 'ws-1' },
    }
    mockCopilotState.toolCallsById = {}
    mockCustomToolsStore.getTool.mockReset()
    mockSkillsStore.getSkill.mockReset()
  })

  it('ManageCustomToolClientTool auto-executes list and scopes to the execution-context workspace', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/tools/custom?workspaceId=ws-1' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'tool-1',
                title: 'marketTool',
                schema: { type: 'function', function: { name: 'marketTool' } },
                code: 'return true',
              },
            ],
          }),
        }
      }

      if (url === '/api/copilot/tools/mark-complete' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} (${method})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const toolCallId = 'manage-custom-tool-list'
    const tool = new ManageCustomToolClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'manage_custom_tool',
      channelId: 'pair-blue',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute({ operation: 'list' })

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/tools/custom?workspaceId=ws-1')
    expect(tool.getInterruptDisplays()).toBeUndefined()
    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(
      ManageCustomToolClientTool.metadata.getDynamicText?.(
        { operation: 'list' },
        ClientToolCallState.pending
      )
    ).toBe('List custom tools?')
    expect(markCompleteCall).toBeDefined()

    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.data).toMatchObject({
      success: true,
      operation: 'list',
      count: 1,
    })
    expect(markCompleteBody.data.tools).toHaveLength(1)
  })

  it('ManageSkillClientTool auto-executes list and returns skill results', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/skills?workspaceId=ws-1' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'skill-1',
                name: 'market-research',
                description: 'Research a market before trading.',
              },
            ],
          }),
        }
      }

      if (url === '/api/copilot/tools/mark-complete' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} (${method})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const toolCallId = 'manage-skill-list'
    const tool = new ManageSkillClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'manage_skill',
      channelId: 'pair-green',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute({ operation: 'list' })

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/skills?workspaceId=ws-1')
    expect(tool.getInterruptDisplays()).toBeUndefined()
    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(
      ManageSkillClientTool.metadata.getDynamicText?.(
        { operation: 'list' },
        ClientToolCallState.pending
      )
    ).toBe('List skills?')
    expect(markCompleteCall).toBeDefined()

    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.data).toMatchObject({
      success: true,
      operation: 'list',
      count: 1,
    })
    expect(markCompleteBody.data.skills).toHaveLength(1)
  })

  it('ManageMcpToolClientTool auto-executes list and returns server results', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/mcp/servers?workspaceId=ws-1' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              servers: [
                {
                  id: 'mcp-1',
                  name: 'Alpha Server',
                  url: 'https://alpha.example.com',
                  transport: 'streamable-http',
                  enabled: true,
                  connectionStatus: 'connected',
                },
              ],
            },
          }),
        }
      }

      if (url === '/api/copilot/tools/mark-complete' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} (${method})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const toolCallId = 'manage-mcp-list'
    const tool = new ManageMcpToolClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'manage_mcp_tool',
      channelId: 'pair-red',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute({ operation: 'list' })

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/mcp/servers?workspaceId=ws-1')
    expect(tool.getInterruptDisplays()).toBeUndefined()
    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(
      ManageMcpToolClientTool.metadata.getDynamicText?.(
        { operation: 'list' },
        ClientToolCallState.pending
      )
    ).toBe('List MCP servers?')
    expect(markCompleteCall).toBeDefined()

    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.data).toMatchObject({
      success: true,
      operation: 'list',
      count: 1,
    })
    expect(markCompleteBody.data.servers).toHaveLength(1)
  })

  it('registry schemas accept TradingGoose-style list operations and list results', () => {
    expect(ToolArgSchemas.manage_custom_tool.parse({ operation: 'list' })).toMatchObject({
      operation: 'list',
    })
    expect(ToolArgSchemas.manage_skill.parse({ operation: 'list' })).toMatchObject({
      operation: 'list',
    })
    expect(ToolArgSchemas.manage_mcp_tool.parse({ operation: 'list' })).toMatchObject({
      operation: 'list',
    })

    expect(
      ToolResultSchemas.manage_custom_tool.parse({
        success: true,
        operation: 'list',
        tools: [],
        count: 0,
      })
    ).toBeDefined()

    expect(
      ToolResultSchemas.manage_skill.parse({
        success: true,
        operation: 'list',
        skills: [],
        count: 0,
      })
    ).toBeDefined()

    expect(
      ToolResultSchemas.manage_mcp_tool.parse({
        success: true,
        operation: 'list',
        servers: [],
        count: 0,
      })
    ).toBeDefined()
  })

  it('keeps mutating manage_* operations behind an interrupt', async () => {
    const customTool = new ManageCustomToolClientTool('manage-custom-tool-add')
    await customTool.execute({ operation: 'add' })

    const skillTool = new ManageSkillClientTool('manage-skill-edit')
    await skillTool.execute({ operation: 'edit' })

    const mcpTool = new ManageMcpToolClientTool('manage-mcp-edit')
    await mcpTool.execute({ operation: 'edit' })

    expect(customTool.getInterruptDisplays()).toBeDefined()
    expect(skillTool.getInterruptDisplays()).toBeDefined()
    expect(mcpTool.getInterruptDisplays()).toBeDefined()
    expect(customTool.getState()).toBe(ClientToolCallState.generating)
    expect(skillTool.getState()).toBe(ClientToolCallState.generating)
    expect(mcpTool.getState()).toBe(ClientToolCallState.generating)
  })
})
