import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { ToolArgSchemas, ToolResultSchemas } from '@/lib/copilot/registry'
import { EditMonitorClientTool } from '@/lib/copilot/tools/client/monitor/edit-monitor'
import { GetMonitorClientTool } from '@/lib/copilot/tools/client/monitor/get-monitor'
import { ListMonitorsClientTool } from '@/lib/copilot/tools/client/monitor/list-monitors'

const mockRegistryState = {
  workflows: {} as Record<string, { workspaceId?: string }>,
}

const mockCopilotState = {
  toolCallsById: {} as Record<string, { params?: Record<string, unknown> }>,
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

describe('monitor tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockRegistryState.workflows = {}
    mockCopilotState.toolCallsById = {}
  })

  it('list_monitors returns workspace monitor entries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/indicator-monitors?workspaceId=ws-1' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                monitorId: 'monitor-1',
                workflowId: 'wf-1',
                blockId: 'trigger-1',
                isActive: true,
                providerConfig: {
                  monitor: {
                    providerId: 'alpaca',
                    interval: '1m',
                    indicatorId: 'rsi',
                    listing: {
                      listing_type: 'default',
                      listing_id: 'AAPL',
                      base_id: '',
                      quote_id: '',
                      name: 'Apple Inc.',
                    },
                  },
                },
                createdAt: '2026-04-11T00:00:00.000Z',
                updatedAt: '2026-04-11T01:00:00.000Z',
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

    const tool = new ListMonitorsClientTool('list-monitors')
    tool.setExecutionContext({
      toolCallId: 'list-monitors',
      toolName: 'list_monitors',
      channelId: 'pair-blue',
      workspaceId: 'ws-1',
      log: vi.fn(),
    })

    await tool.execute()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(fetchMock).toHaveBeenCalledWith('/api/indicator-monitors?workspaceId=ws-1')

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const body = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(body.data).toMatchObject({
      entityKind: 'monitor',
      count: 1,
    })
    expect(body.data.entities[0]).toMatchObject({
      entityId: 'monitor-1',
      entityName: 'rsi on Apple Inc. (1m)',
      workflowId: 'wf-1',
      blockId: 'trigger-1',
      providerId: 'alpaca',
      indicatorId: 'rsi',
      interval: '1m',
      isActive: true,
    })
  })

  it('get_monitor returns a monitor document', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/indicator-monitors/monitor-1' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              monitorId: 'monitor-1',
              workflowId: 'wf-1',
              blockId: 'trigger-1',
              isActive: true,
              providerConfig: {
                monitor: {
                  providerId: 'alpaca',
                  interval: '5m',
                  indicatorId: 'rsi',
                  listing: {
                    listing_type: 'default',
                    listing_id: 'AAPL',
                    base_id: '',
                    quote_id: '',
                  },
                  auth: {
                    secretReferences: {
                      apiKey: 'secret-value',
                    },
                  },
                  providerParams: {
                    exchange: 'NASDAQ',
                  },
                },
              },
              createdAt: '2026-04-11T00:00:00.000Z',
              updatedAt: '2026-04-11T01:00:00.000Z',
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

    const tool = new GetMonitorClientTool('get-monitor')
    tool.setExecutionContext({
      toolCallId: 'get-monitor',
      toolName: 'get_monitor',
      channelId: 'pair-green',
      workspaceId: 'ws-1',
      log: vi.fn(),
    })

    await tool.execute({ entityId: 'monitor-1' })

    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const body = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(body.data).toMatchObject({
      entityKind: 'monitor',
      entityId: 'monitor-1',
      documentFormat: 'tg-monitor-document-v1',
    })
    expect(body.data.entityDocument).toContain('"providerId": "alpaca"')
    expect(body.data.entityDocument).toContain('"interval": "5m"')
    expect(body.data.entityDocument).toContain('"secrets"')
  })

  it('edit_monitor patches the monitor after accept', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/indicator-monitors/monitor-1' && method === 'PATCH') {
        const payload = JSON.parse(String(init?.body))
        expect(payload).toMatchObject({
          workspaceId: 'ws-1',
          workflowId: 'wf-1',
          blockId: 'trigger-1',
          providerId: 'alpaca',
          interval: '15m',
          indicatorId: 'rsi',
          isActive: false,
        })

        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              monitorId: 'monitor-1',
              workflowId: 'wf-1',
              blockId: 'trigger-1',
              isActive: false,
              providerConfig: {
                monitor: {
                  providerId: 'alpaca',
                  interval: '15m',
                  indicatorId: 'rsi',
                  listing: {
                    listing_type: 'default',
                    listing_id: 'AAPL',
                    base_id: '',
                    quote_id: '',
                  },
                  providerParams: {
                    exchange: 'NASDAQ',
                  },
                },
              },
              createdAt: '2026-04-11T00:00:00.000Z',
              updatedAt: '2026-04-11T02:00:00.000Z',
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

    const tool = new EditMonitorClientTool('edit-monitor')
    tool.setExecutionContext({
      toolCallId: 'edit-monitor',
      toolName: 'edit_monitor',
      channelId: 'pair-red',
      workspaceId: 'ws-1',
      log: vi.fn(),
    })

    const entityDocument = JSON.stringify(
      {
        workflowId: 'wf-1',
        blockId: 'trigger-1',
        providerId: 'alpaca',
        interval: '15m',
        indicatorId: 'rsi',
        listing: {
          listing_type: 'default',
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
        },
        isActive: false,
        providerParams: {
          exchange: 'NASDAQ',
        },
      },
      null,
      2
    )

    await tool.execute({
      entityId: 'monitor-1',
      entityDocument,
      documentFormat: 'tg-monitor-document-v1',
    })
    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const body = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(body.data).toMatchObject({
      success: true,
      entityKind: 'monitor',
      entityId: 'monitor-1',
      documentFormat: 'tg-monitor-document-v1',
    })
    expect(body.data.entityDocument).toContain('"interval": "15m"')
    expect(body.data.entityDocument).toContain('"isActive": false')
  })

  it('exposes monitor tool schemas', () => {
    expect(
      ToolArgSchemas.list_monitors.parse({
        workflowId: 'wf-1',
      })
    ).toMatchObject({ workflowId: 'wf-1' })

    expect(
      ToolArgSchemas.edit_monitor.parse({
        entityId: 'monitor-1',
        entityDocument:
          '{"workflowId":"wf-1","blockId":"trigger-1","providerId":"alpaca","interval":"1m","indicatorId":"rsi","listing":{"listing_type":"default","listing_id":"AAPL","base_id":"","quote_id":""},"isActive":true}',
      })
    ).toMatchObject({
      entityId: 'monitor-1',
    })

    expect(
      ToolResultSchemas.get_monitor.parse({
        entityKind: 'monitor',
        entityId: 'monitor-1',
        entityName: 'rsi on AAPL (1m)',
        documentFormat: 'tg-monitor-document-v1',
        entityDocument:
          '{"workflowId":"wf-1","blockId":"trigger-1","providerId":"alpaca","interval":"1m","indicatorId":"rsi","listing":{"listing_type":"default","listing_id":"AAPL","base_id":"","quote_id":""},"isActive":true}',
      })
    ).toMatchObject({
      entityKind: 'monitor',
      entityId: 'monitor-1',
    })
  })
})
