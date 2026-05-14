import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolArgSchemas, ToolResultSchemas } from '@/lib/copilot/registry'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import {
  CreateSkillClientTool,
  EditSkillClientTool,
  ListIndicatorsClientTool,
  ListSkillsClientTool,
  ReadCustomToolClientTool,
  ReadIndicatorClientTool,
  RenameSkillClientTool,
} from '@/lib/copilot/tools/client/entities/entity-document-tools'
import {
  getActiveEntitySession,
  resolveCopilotEntityYjsSessionLease,
} from '@/lib/copilot/tools/client/entities/entity-document-tool-utils'

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
const mockBootstrapYjsProvider = vi.fn()
const mockWaitForYjsWriteSync = vi.fn()

const originalFetch = globalThis.fetch

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
  getRegisteredEntitySession: vi.fn((reviewSessionId?: string | null) => {
    if (
      !reviewSessionId ||
      mockEntitySessionRegistry.session?.descriptor?.reviewSessionId !== reviewSessionId
    ) {
      return null
    }

    return mockEntitySessionRegistry.session
  }),
  getRegisteredEntitySessionByIdentity: vi.fn(
    (entityKind: string, entityId?: string | null, workspaceId?: string | null) => {
      const session = mockEntitySessionRegistry.session
      if (!entityId || !session) {
        return null
      }

      if (
        session.descriptor.entityKind !== entityKind ||
        session.descriptor.entityId !== entityId
      ) {
        return null
      }

      if (workspaceId != null && session.descriptor.workspaceId !== workspaceId) {
        return null
      }

      return session
    }
  ),
  getRegisteredEntitySessionByKind: vi.fn((entityKind: string, workspaceId?: string | null) => {
    const session = mockEntitySessionRegistry.session
    if (!session?.descriptor.entityId || session.descriptor.entityKind !== entityKind) {
      return null
    }

    if (workspaceId != null && session.descriptor.workspaceId !== workspaceId) {
      return null
    }

    return session
  }),
}))

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: (...args: any[]) => mockBootstrapYjsProvider(...args),
  waitForYjsWriteSync: (...args: any[]) => mockWaitForYjsWriteSync(...args),
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
    vi.unstubAllGlobals?.()
    globalThis.fetch = originalFetch
    mockRegistryState.workflows = {
      'wf-context': { workspaceId: 'ws-1' },
    }
    mockCopilotState.toolCallsById = {}
    mockEntitySessionRegistry.session = null
    mockEntityFieldState.values = {}
    mockBootstrapYjsProvider.mockReset()
    mockWaitForYjsWriteSync.mockReset()
    mockWaitForYjsWriteSync.mockResolvedValue(undefined)
  })

  it('list_skills returns generic entity list results', async () => {
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

  it('read_custom_tool reads the explicit target entity and returns an entity document', async () => {
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
    const tool = new ReadCustomToolClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'read_custom_tool',
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

  it('create_skill inserts through the canonical skills API after approval', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/skills' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({
          workspaceId: 'ws-1',
          skills: [
            {
              name: 'new-skill',
              description: 'New skill description',
              content: 'Do useful work.',
            },
          ],
        })

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [
              {
                id: 'skill-new',
                name: 'new-skill',
                description: 'New skill description',
                content: 'Do useful work.',
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

    const toolCallId = 'create-skill'
    const tool = new CreateSkillClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'create_skill',
      channelId: 'pair-yellow',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute({
      entityDocument: JSON.stringify({
        name: 'new-skill',
        description: 'New skill description',
        content: 'Do useful work.',
      }),
      documentFormat: 'tg-skill-document-v1',
    })

    expect(tool.getState()).toBe(ClientToolCallState.review)
    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockBootstrapYjsProvider).not.toHaveBeenCalled()

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.name).toBe('create_skill')
    expect(markCompleteBody.data).toMatchObject({
      success: true,
      entityKind: 'skill',
      entityId: 'skill-new',
      entityName: 'new-skill',
      documentFormat: 'tg-skill-document-v1',
    })
    expect(markCompleteBody.data.entityDocument).toContain('"name": "new-skill"')
    expect(markCompleteBody.data).not.toHaveProperty('reviewSessionId')
    expect(markCompleteBody.data).not.toHaveProperty('draftSessionId')
  })

  it('list_indicators returns built-in and custom indicators with capability flags', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/indicators/options?workspaceId=ws-1&surface=copilot' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'RSI',
                name: 'Relative Strength Index',
                source: 'default',
                color: '#3972F6',
                editable: false,
                callableInFunctionBlock: true,
                inputTitles: ['Length'],
                runtimeId: 'RSI',
              },
              {
                id: 'indicator-1',
                name: 'My Custom Indicator',
                source: 'custom',
                color: '#ff0000',
                editable: true,
                callableInFunctionBlock: false,
                inputTitles: ['Fast Length'],
                entityId: 'indicator-1',
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

    const toolCallId = 'list-indicators'
    const tool = new ListIndicatorsClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'list_indicators',
      channelId: 'pair-cyan',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute()

    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.data).toMatchObject({
      entityKind: 'indicator',
      count: 2,
    })
    expect(markCompleteBody.data.indicators).toEqual([
      {
        name: 'Relative Strength Index',
        source: 'default',
        color: '#3972F6',
        editable: false,
        callableInFunctionBlock: true,
        inputTitles: ['Length'],
        runtimeId: 'RSI',
      },
      {
        name: 'My Custom Indicator',
        source: 'custom',
        color: '#ff0000',
        editable: true,
        callableInFunctionBlock: false,
        inputTitles: ['Fast Length'],
        entityId: 'indicator-1',
      },
    ])
  })

  it('read_indicator reads a built-in default indicator by runtimeId', async () => {
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

    const toolCallId = 'get-indicator-default'
    const tool = new ReadIndicatorClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'read_indicator',
      channelId: 'pair-yellow',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.execute({ runtimeId: 'RSI' })

    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))

    expect(markCompleteBody.data).toMatchObject({
      entityKind: 'indicator',
      entityName: 'Relative Strength Index',
      documentFormat: 'tg-indicator-document-v1',
    })
    expect(markCompleteBody.data.entityDocument).toContain('"name": "Relative Strength Index"')
    expect(markCompleteBody.data.entityDocument).toContain('"pineCode"')
    expect(markCompleteBody.data.entityDocument).toContain('"Length"')
  })

  it('matches active unsaved draft review targets by review session', () => {
    mockEntitySessionRegistry.session = {
      descriptor: {
        workspaceId: 'ws-1',
        entityKind: 'skill',
        entityId: null,
        reviewSessionId: 'review-draft',
        draftSessionId: 'draft-1',
        yjsSessionId: 'review-draft',
      },
      doc: {},
    }

    expect(
      getActiveEntitySession(
        {
          toolCallId: 'read-draft-skill',
          toolName: 'read_skill',
          reviewSessionId: 'review-draft',
          draftSessionId: 'draft-1',
          workspaceId: 'ws-1',
        },
        'skill'
      )
    ).toBe(mockEntitySessionRegistry.session)
    expect(
      getActiveEntitySession(
        {
          toolCallId: 'read-other-draft',
          toolName: 'read_skill',
          reviewSessionId: 'review-draft',
          draftSessionId: 'draft-2',
          workspaceId: 'ws-1',
        },
        'skill'
      )
    ).toBeNull()
  })

  it('read_custom_tool reads a matching live entity session by explicit entityId', async () => {
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
        draftSessionId: null,
        workspaceId: 'ws-1',
      },
      doc: {},
    }

    const toolCallId = 'get-custom-tool-live-session'
    const tool = new ReadCustomToolClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'read_custom_tool',
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

  it('edit_skill applies the edited document to the active saved review target on accept', async () => {
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
        draftSessionId: null,
      },
      doc: {
        transact: (cb: () => void) => cb(),
      },
      provider: { synced: true },
      accessMode: 'write',
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

    expect(tool.getState()).toBe(ClientToolCallState.review)
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
    })
  })

  it('edit_skill applies to the unique mounted saved session when entityId is omitted', async () => {
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
      description: '',
      content: '',
    }
    mockEntitySessionRegistry.session = {
      descriptor: {
        workspaceId: 'ws-1',
        entityKind: 'skill',
        entityId: 'skill-current',
        reviewSessionId: 'review-current',
        draftSessionId: null,
      },
      doc: {
        transact: (cb: () => void) => cb(),
      },
      provider: { synced: true },
      accessMode: 'write',
    }

    const toolCallId = 'edit-current-skill'
    const tool = new EditSkillClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'edit_skill',
      workspaceId: 'ws-1',
      log: vi.fn(),
    })

    await tool.execute({
      entityDocument: JSON.stringify({
        name: 'current-skill',
        description: 'Current description',
        content: 'Current content',
      }),
      documentFormat: 'tg-skill-document-v1',
    } as any)
    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockEntityFieldState.values).toMatchObject({
      name: 'current-skill',
      description: 'Current description',
      content: 'Current content',
    })

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.data).toMatchObject({
      entityId: 'skill-current',
      reviewSessionId: 'review-current',
    })
  })

  it('edit_skill resolves and bootstraps a Yjs session when no editor session is mounted', async () => {
    vi.useFakeTimers()
    try {
      const provider = {
        on: vi.fn(),
        off: vi.fn(),
        disconnect: vi.fn(),
        destroy: vi.fn(),
      }
      const doc = {
        transact: (cb: () => void) => cb(),
        destroy: vi.fn(),
      }
      const descriptor = {
        workspaceId: 'ws-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        reviewSessionId: 'review-1',
        draftSessionId: null,
        yjsSessionId: 'review-1',
      }

      mockBootstrapYjsProvider.mockResolvedValue({
        descriptor,
        doc,
        provider,
        runtime: null,
        accessMode: 'write',
      })

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method || 'GET'

        if (url === '/api/copilot/review-sessions/resolve' && method === 'POST') {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            workspaceId: 'ws-1',
            entityKind: 'skill',
            entityId: 'skill-1',
            accessMode: 'write',
          })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              descriptor,
              runtime: null,
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

      const toolCallId = 'edit-skill-bootstrap'
      const tool = new EditSkillClientTool(toolCallId)
      tool.setExecutionContext({
        toolCallId,
        toolName: 'edit_skill',
        workspaceId: 'ws-1',
        log: vi.fn(),
      })

      await tool.execute({
        entityId: 'skill-1',
        entityDocument: JSON.stringify({
          name: 'bootstrapped-skill',
          description: 'Updated through tool lease',
          content: 'Updated content',
        }),
        documentFormat: 'tg-skill-document-v1',
      })
      await tool.handleAccept()

      expect(tool.getState()).toBe(ClientToolCallState.success)
      expect(mockBootstrapYjsProvider).toHaveBeenCalledWith(descriptor, 'write')
      expect(mockEntityFieldState.values).toMatchObject({
        name: 'bootstrapped-skill',
        description: 'Updated through tool lease',
        content: 'Updated content',
      })

      await vi.runOnlyPendingTimersAsync()
      expect(provider.disconnect).toHaveBeenCalled()
      expect(provider.destroy).toHaveBeenCalled()
      expect(doc.destroy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires write-mode review resolution before bootstrapping a saved entity session', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/copilot/review-sessions/resolve' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          accessMode: 'write',
          entityKind: 'skill',
          entityId: 'skill-1',
        })
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'Access denied' }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} (${method})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      resolveCopilotEntityYjsSessionLease(
        { toolCallId: 'edit-skill', toolName: 'edit_skill', workspaceId: 'ws-1' },
        'skill',
        'skill-1'
      )
    ).rejects.toThrow('Access denied')
    expect(mockBootstrapYjsProvider).not.toHaveBeenCalled()
  })

  it('rename_skill applies the renamed document to a saved review target', async () => {
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
      name: 'old-skill-name',
      description: 'Existing description',
      content: 'Existing content',
    }

    mockEntitySessionRegistry.session = {
      descriptor: {
        entityKind: 'skill',
        entityId: 'skill-1',
        reviewSessionId: 'review-1',
        draftSessionId: null,
      },
      doc: {
        transact: (cb: () => void) => cb(),
      },
      provider: { synced: true },
      accessMode: 'write',
    }

    const toolCallId = 'rename-skill'
    const tool = new RenameSkillClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'rename_skill',
      channelId: 'pair-purple',
      workflowId: 'wf-context',
      reviewSessionId: 'review-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      log: vi.fn(),
    })

    await tool.execute({
      entityId: 'skill-1',
      entityDocument: JSON.stringify({
        name: 'renamed-skill',
        description: 'Existing description',
        content: 'Existing content',
      }),
      documentFormat: 'tg-skill-document-v1',
    })
    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockEntityFieldState.values).toEqual({
      name: 'renamed-skill',
      description: 'Existing description',
      content: 'Existing content',
    })

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.name).toBe('rename_skill')
    expect(markCompleteBody.data).toMatchObject({
      success: true,
      entityKind: 'skill',
      entityId: 'skill-1',
      entityName: 'renamed-skill',
      reviewSessionId: 'review-1',
    })
  })

  it('edit_skill rejects edits without an explicit entityId when no target session is active', async () => {
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
    expect(markCompleteBody.message).toContain('entityId is required to update a saved skill')
  })

  it('registry schemas accept optional explicit entity ids for entity document tools', () => {
    expect(ToolArgSchemas.list_skills.parse({})).toMatchObject({})
    expect(ToolArgSchemas.read_skill.parse({ entityId: 'skill-1' })).toMatchObject({
      entityId: 'skill-1',
    })
    expect(ToolArgSchemas.read_skill.parse({})).toMatchObject({})
    expect(ToolArgSchemas.read_indicator.parse({ runtimeId: 'RSI' })).toMatchObject({
      runtimeId: 'RSI',
    })
    expect(
      ToolArgSchemas.create_skill.parse({
        entityDocument: '{"name":"skill","description":"","content":""}',
      })
    ).toMatchObject({
      entityDocument: '{"name":"skill","description":"","content":""}',
    })
    expect(() =>
      ToolArgSchemas.create_skill.parse({
        entityId: 'skill-1',
        entityDocument: '{"name":"skill","description":"","content":""}',
      })
    ).toThrow()
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
      ToolArgSchemas.edit_skill.parse({
        entityDocument: '{"name":"skill","description":"","content":""}',
      })
    ).toMatchObject({
      entityDocument: '{"name":"skill","description":"","content":""}',
    })
    expect(
      ToolResultSchemas.read_custom_tool.parse({
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
    expect(
      ToolResultSchemas.list_indicators.parse({
        entityKind: 'indicator',
        indicators: [
          {
            name: 'Relative Strength Index',
            source: 'default',
            editable: false,
            callableInFunctionBlock: true,
            runtimeId: 'RSI',
            inputTitles: ['Length'],
          },
        ],
        count: 1,
      })
    ).toBeDefined()
    expect(
      ToolResultSchemas.rename_skill.parse({
        success: true,
        entityKind: 'skill',
        entityId: 'skill-1',
        entityName: 'renamed-skill',
        documentFormat: 'tg-skill-document-v1',
        entityDocument: '{"name":"renamed-skill","description":"","content":""}',
      })
    ).toBeDefined()
  })
})
