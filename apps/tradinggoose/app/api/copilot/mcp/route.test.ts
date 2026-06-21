/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateMcpApiKey,
  mockGetCopilotRuntimeToolManifest,
  mockGetServerToolIds,
  mockGetUserWorkspaces,
  mockRouteExecution,
  mockUpdateApiKeyLastUsed,
} = vi.hoisted(() => ({
  mockAuthenticateMcpApiKey: vi.fn(),
  mockGetCopilotRuntimeToolManifest: vi.fn(),
  mockGetServerToolIds: vi.fn(),
  mockGetUserWorkspaces: vi.fn(),
  mockRouteExecution: vi.fn(),
  mockUpdateApiKeyLastUsed: vi.fn(),
}))

vi.mock('@/lib/api-key/service', () => ({
  updateApiKeyLastUsed: (...args: unknown[]) => mockUpdateApiKeyLastUsed(...args),
}))

vi.mock('@/lib/mcp/auth', () => ({
  authenticateMcpApiKey: (...args: unknown[]) => mockAuthenticateMcpApiKey(...args),
}))

vi.mock('@/lib/copilot/runtime-tool-manifest', () => ({
  getCopilotRuntimeToolManifest: (...args: unknown[]) => mockGetCopilotRuntimeToolManifest(...args),
}))

vi.mock('@/lib/copilot/tools/server/router', () => ({
  getServerToolIds: (...args: unknown[]) => mockGetServerToolIds(...args),
  routeExecution: (...args: unknown[]) => mockRouteExecution(...args),
}))

vi.mock('@/lib/workspaces/service', () => ({
  getUserWorkspaces: (...args: unknown[]) => mockGetUserWorkspaces(...args),
}))

function createMcpRequest(body: unknown, authorization = 'Bearer sk-tradinggoose-test') {
  return new NextRequest('https://studio.example.test/api/copilot/mcp', {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('Copilot MCP route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuthenticateMcpApiKey.mockResolvedValue({
      success: true,
      userId: 'user-1',
      keyId: 'key-1',
    })
    mockGetUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Research', permissions: 'admin' },
      { id: 'workspace-2', name: 'Ops', permissions: 'read' },
    ])
    mockGetServerToolIds.mockReturnValue(['list_workflows', 'read_workflow'])
    mockGetCopilotRuntimeToolManifest.mockResolvedValue({
      version: 'v1',
      tools: [
        {
          name: 'list_workflows',
          description: 'List workflows.',
          parameters: { type: 'object', properties: { workspaceId: { type: 'string' } } },
        },
        {
          name: 'plan',
          description: 'Client-only planning tool.',
          parameters: { type: 'object', properties: {} },
        },
      ],
    })
    mockRouteExecution.mockResolvedValue({ workflows: [] })
  })

  it('rejects requests without bearer auth', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, '')
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Bearer token required')
    expect(mockAuthenticateMcpApiKey).not.toHaveBeenCalled()
  })

  it('returns initialize metadata with authenticated workspace context', async () => {
    const { POST } = await import('./route')

    const response = await POST(createMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    const body = await response.json()

    expect(response.headers.get('MCP-Protocol-Version')).toBe('2025-03-26')
    expect(mockAuthenticateMcpApiKey).toHaveBeenCalledWith('sk-tradinggoose-test')
    expect(mockUpdateApiKeyLastUsed).toHaveBeenCalledWith('key-1')
    expect(mockGetUserWorkspaces).toHaveBeenCalledWith({ userId: 'user-1', autoCreate: false })
    expect(body.result.capabilities).toEqual({ tools: {} })
    expect(body.result.serverInfo).toEqual({ name: 'TradingGoose', version: '0.1.0' })
    expect(body.result.instructions).toContain('workspaceId=workspace-1, permissions=admin')
    expect(body.result.instructions).toContain('workspaceId=workspace-2, permissions=read')
    expect(body.result.instructions).toContain(
      'Do not store workspaceId, entityId, or entity targets'
    )
  })

  it('accepts a case-insensitive bearer auth scheme', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, 'bearer sk-lowercase')
    )

    expect(response.status).toBe(200)
    expect(mockAuthenticateMcpApiKey).toHaveBeenCalledWith('sk-lowercase')
  })

  it('lists only executable server copilot tools', async () => {
    const { POST } = await import('./route')

    const response = await POST(createMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    const body = await response.json()

    expect(body.result.tools).toEqual([
      {
        name: 'list_workflows',
        description: 'List workflows.',
        inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' } } },
      },
    ])
  })

  it('dispatches tool calls through the server tool router', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createMcpRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'list_workflows',
          arguments: { workspaceId: 'workspace-1' },
        },
      })
    )
    const body = await response.json()

    expect(mockRouteExecution).toHaveBeenCalledWith(
      'list_workflows',
      { workspaceId: 'workspace-1' },
      { userId: 'user-1', accessLevel: 'full' }
    )
    expect(body.result.structuredContent).toEqual({ workflows: [] })
    expect(body.result.content[0].text).toBe(JSON.stringify({ workflows: [] }, null, 2))
  })

  it('returns per-entry invalid request errors for malformed batches', async () => {
    const { POST } = await import('./route')

    const response = await POST(createMcpRequest([null]))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC request',
        },
      },
    ])
    expect(mockRouteExecution).not.toHaveBeenCalled()
  })

  it('rejects empty JSON-RPC batches as invalid requests', async () => {
    const { POST } = await import('./route')

    const response = await POST(createMcpRequest([]))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'Invalid JSON-RPC request',
      },
    })
    expect(mockRouteExecution).not.toHaveBeenCalled()
  })
})
