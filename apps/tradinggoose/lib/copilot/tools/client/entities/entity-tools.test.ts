import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolArgSchemas, ToolResultSchemas } from '@/lib/copilot/registry'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import {
  EditSkillClientTool,
  GetCustomToolClientTool,
  ListSkillsClientTool,
} from '@/lib/copilot/tools/client/entities/entity-document-tools'

const mockRegistryState = {
  workflows: {} as Record<string, { workspaceId?: string }>,
}

const mockCopilotState = {
  toolCallsById: {} as Record<string, { params?: Record<string, unknown> }>,
}

const mockEntitySessionRegistry = {
  session: null as any,
}

const mockEntityFieldState = {
  values: {} as Record<string, unknown>,
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

vi.mock('@/lib/yjs/entity-session-registry', () => ({
  getRegisteredEntitySession: () => mockEntitySessionRegistry.session,
  getRegisteredEntitySessionByIdentity: () => mockEntitySessionRegistry.session,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  getEntityFields: () => ({ ...mockEntityFieldState.values }),
  setEntityField: (_doc: unknown, key: string, value: unknown) => {
    mockEntityFieldState.values[key] = value
  },
  replaceEntityTextField: (_doc: unknown, key: string, value: string) => {
    mockEntityFieldState.values[key] = value
  },
}))

describe('entity document tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockRegistryState.workflows = {
      'wf-context': { workspaceId: 'ws-1' },
    }
    mockCopilotState.toolCallsById = {}
    mockEntitySessionRegistry.session = null
    mockEntityFieldState.values = {}
  })

  it('list_skills auto-executes and returns generic entity list results', async () => {
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

    const toolCallId = 'list-skills'
    const tool = new ListSkillsClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'list_skills',
      channelId: 'pair-yellow',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute()

    expect(fetchMock).toHaveBeenCalledWith('/api/skills?workspaceId=ws-1')
    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.data).toMatchObject({
      entityKind: 'skill',
      count: 1,
    })
    expect(markCompleteBody.data.entities).toEqual([
      {
        entityId: 'skill-1',
        entityName: 'market-research',
        entityDescription: 'Research a market before trading.',
      },
    ])
  })

  it('get_custom_tool reads the explicit target entity and returns an entity document', async () => {
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
                title: 'market-tool',
                schema: {
                  type: 'function',
                  function: {
                    name: 'marketTool',
                    description: 'Fetch market data',
                    parameters: { type: 'object', properties: {} },
                  },
                },
                code: 'return 1',
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

    const toolCallId = 'get-custom-tool'
    const tool = new GetCustomToolClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'get_custom_tool',
      channelId: 'pair-orange',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute({ entityId: 'tool-1' })

    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))

    expect(markCompleteBody.data).toMatchObject({
      entityKind: 'custom_tool',
      entityId: 'tool-1',
      entityName: 'market-tool',
      documentFormat: 'tg-custom-tool-document-v1',
    })
    expect(markCompleteBody.data.entityDocument).toContain('"title": "market-tool"')
    expect(markCompleteBody.data.entityDocument).toContain('"codeText": "return 1"')
  })

  it('get_custom_tool reads a matching live entity session by explicit entityId', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

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

    mockEntityFieldState.values = {
      title: 'live-market-tool',
      schemaText: JSON.stringify({
        type: 'function',
        function: {
          name: 'liveMarketTool',
          description: 'Fetch live market data',
          parameters: { type: 'object', properties: {} },
        },
      }),
      codeText: 'return 2',
    }

    mockEntitySessionRegistry.session = {
      descriptor: {
        entityKind: 'custom_tool',
        entityId: 'tool-1',
        reviewSessionId: 'review-1',
        draftSessionId: 'draft-1',
        workspaceId: 'ws-1',
      },
      doc: {},
    }

    const toolCallId = 'get-custom-tool-live-session'
    const tool = new GetCustomToolClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'get_custom_tool',
      channelId: 'pair-orange',
      workspaceId: 'ws-1',
      log: vi.fn(),
    })

    await tool.execute({ entityId: 'tool-1' })

    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))

    expect(markCompleteBody.data).toMatchObject({
      entityKind: 'custom_tool',
      entityId: 'tool-1',
      entityName: 'live-market-tool',
      documentFormat: 'tg-custom-tool-document-v1',
    })
    expect(markCompleteBody.data.entityDocument).toContain('"title": "live-market-tool"')
    expect(markCompleteBody.data.entityDocument).toContain('"codeText": "return 2"')
  })

  it('edit_skill applies the edited document to the active draft on accept', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

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

    mockEntityFieldState.values = {
      name: 'old-skill',
      description: 'Old description',
      content: 'Old content',
    }

    mockEntitySessionRegistry.session = {
      descriptor: {
        entityKind: 'skill',
        entityId: 'skill-1',
        reviewSessionId: 'review-1',
        draftSessionId: 'draft-1',
      },
      doc: {
        transact: (cb: () => void) => cb(),
      },
    }

    const toolCallId = 'edit-skill'
    const tool = new EditSkillClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'edit_skill',
      channelId: 'pair-purple',
      workflowId: 'wf-context',
      reviewSessionId: 'review-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      draftSessionId: 'draft-1',
      log: vi.fn(),
    })

    await tool.execute({
      entityId: 'skill-1',
      entityDocument: JSON.stringify(
        {
          name: 'new-skill',
          description: 'New description',
          content: 'New content',
        },
        null,
        2
      ),
      documentFormat: 'tg-skill-document-v1',
    })

    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockEntityFieldState.values).toEqual({
      name: 'new-skill',
      description: 'New description',
      content: 'New content',
    })

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.data).toMatchObject({
      success: true,
      entityKind: 'skill',
      entityId: 'skill-1',
      entityName: 'new-skill',
      documentFormat: 'tg-skill-document-v1',
      reviewSessionId: 'review-1',
      draftSessionId: 'draft-1',
    })
  })

  it('edit_skill rejects edits without an explicit entityId even when current skill context exists', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

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

    mockEntitySessionRegistry.session = {
      descriptor: {
        entityKind: 'skill',
        entityId: 'skill-current',
        reviewSessionId: 'review-current',
        draftSessionId: null,
      },
      doc: {
        transact: (cb: () => void) => cb(),
      },
    }

    const toolCallId = 'edit-skill-without-entity-id'
    const tool = new EditSkillClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'edit_skill',
      channelId: 'pair-purple',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute({
      entityDocument: JSON.stringify({
        name: 'new-skill',
        description: '',
        content: '',
      }),
      documentFormat: 'tg-skill-document-v1',
    } as any)
    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.error)
    expect(mockEntityFieldState.values).toEqual({})

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.status).toBe(500)
    expect(markCompleteBody.message).toContain('entityId is required')
  })

  it('registry schemas accept entity read and full-entity edit contracts', () => {
    expect(ToolArgSchemas.list_skills.parse({})).toMatchObject({})
    expect(ToolArgSchemas.get_skill.parse({ entityId: 'skill-1' })).toMatchObject({
      entityId: 'skill-1',
    })
    expect(() => ToolArgSchemas.get_skill.parse({})).toThrow()
    expect(
      ToolArgSchemas.edit_skill.parse({
        entityId: 'skill-1',
        entityDocument: '{"name":"skill","description":"","content":""}',
      })
    ).toMatchObject({
      entityId: 'skill-1',
      entityDocument: '{"name":"skill","description":"","content":""}',
    })

    expect(
      ToolResultSchemas.get_custom_tool.parse({
        entityKind: 'custom_tool',
        entityId: 'tool-1',
        entityName: 'market-tool',
        documentFormat: 'tg-custom-tool-document-v1',
        entityDocument: '{}',
      })
    ).toBeDefined()
    expect(
      ToolResultSchemas.list_skills.parse({
        entityKind: 'skill',
        entities: [],
        count: 0,
      })
    ).toBeDefined()
  })
})
