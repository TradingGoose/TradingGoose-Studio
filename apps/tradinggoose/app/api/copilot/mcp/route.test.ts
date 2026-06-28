/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateApiKeyFromHeader,
  mockCheckApiEndpointRateLimit,
  mockCheckPublicApiEndpointRateLimit,
  mockGetCopilotRuntimeToolManifest,
  mockGetMcpServerToolIds,
  mockGetUserWorkspaces,
  mockRouteExecution,
  mockUpdateApiKeyLastUsed,
} = vi.hoisted(() => ({
  mockAuthenticateApiKeyFromHeader: vi.fn(),
  mockCheckApiEndpointRateLimit: vi.fn(),
  mockCheckPublicApiEndpointRateLimit: vi.fn(),
  mockGetCopilotRuntimeToolManifest: vi.fn(),
  mockGetMcpServerToolIds: vi.fn(),
  mockGetUserWorkspaces: vi.fn(),
  mockRouteExecution: vi.fn(),
  mockUpdateApiKeyLastUsed: vi.fn(),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  checkApiEndpointRateLimit: (...args: unknown[]) => mockCheckApiEndpointRateLimit(...args),
  checkPublicApiEndpointRateLimit: (...args: unknown[]) =>
    mockCheckPublicApiEndpointRateLimit(...args),
}))

vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: (...args: unknown[]) => mockAuthenticateApiKeyFromHeader(...args),
  updateApiKeyLastUsed: (...args: unknown[]) => mockUpdateApiKeyLastUsed(...args),
}))

vi.mock('@/lib/copilot/runtime-tool-manifest', () => ({
  getCopilotRuntimeToolManifest: (...args: unknown[]) => mockGetCopilotRuntimeToolManifest(...args),
}))

vi.mock('@/lib/copilot/tools/server/router', () => ({
  getMcpServerToolIds: (...args: unknown[]) => mockGetMcpServerToolIds(...args),
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

function initializeRequest(id: string | number = 1, protocolVersion = '2025-03-26') {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion },
  }
}

describe('Copilot MCP route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuthenticateApiKeyFromHeader.mockResolvedValue({
      success: true,
      userId: 'user-1',
      keyId: 'key-1',
    })
    mockCheckApiEndpointRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 99,
      limit: 100,
      resetAt: new Date('2026-06-24T12:01:00.000Z'),
      userId: 'user-1',
    })
    mockCheckPublicApiEndpointRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 299,
      limit: 300,
      resetAt: new Date('2026-06-24T12:01:00.000Z'),
    })
    mockGetUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Research', permissions: 'admin' },
      { id: 'workspace-2', name: 'Ops', permissions: 'read' },
    ])
    mockGetMcpServerToolIds.mockReturnValue(['list_workflows', 'read_workflow'])
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
        {
          name: 'make_api_request',
          description: 'Make an HTTP request.',
          parameters: { type: 'object', properties: { url: { type: 'string' } } },
        },
      ],
    })
    mockRouteExecution.mockResolvedValue({ workflows: [] })
  })

  it('rejects requests without bearer auth', async () => {
    const { POST } = await import('./route')

    const response = await POST(createMcpRequest(initializeRequest(), ''))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Bearer token required')
    expect(mockAuthenticateApiKeyFromHeader).not.toHaveBeenCalled()
  })

  it('returns initialize metadata with authenticated workspace context', async () => {
    const { POST } = await import('./route')

    const response = await POST(createMcpRequest(initializeRequest()))
    const body = await response.json()

    expect(response.headers.get('MCP-Protocol-Version')).toBe('2025-03-26')
    expect(mockAuthenticateApiKeyFromHeader).toHaveBeenCalledWith('sk-tradinggoose-test', {
      keyTypes: ['personal'],
    })
    expect(mockUpdateApiKeyLastUsed).toHaveBeenCalledWith('key-1')
    expect(mockCheckApiEndpointRateLimit).toHaveBeenCalledWith('user-1', 'copilot-mcp')
    expect(mockGetUserWorkspaces).toHaveBeenCalledWith({ userId: 'user-1', autoCreate: false })
    expect(body.result.capabilities).toEqual({ tools: {} })
    expect(body.result.serverInfo).toEqual({ name: 'TradingGoose', version: '0.1.0' })
    expect(body.result.instructions).toContain('workspaceId=workspace-1, permissions=admin')
    expect(body.result.instructions).toContain('workspaceId=workspace-2, permissions=read')
    expect(body.result.instructions).toContain(
      'Do not store workspaceId, entityId, or entity targets'
    )
    expect(body.result.instructions).toContain('trusted personal coding agents')
    expect(body.result.instructions).toContain('Mutating tools execute directly')
    expect(body.result.instructions).toContain('authenticated MCP key')
    expect(body.result.instructions).not.toContain('No accessible workspaces')
  })

  it('treats missing workspaces as a bootstrap invariant failure instead of MCP onboarding', async () => {
    const { POST } = await import('./route')
    mockGetUserWorkspaces.mockResolvedValueOnce([])

    const response = await POST(createMcpRequest(initializeRequest(5)))
    const body = await response.json()

    expect(body.error.code).toBe(-32603)
    expect(body.error.data.code).toBe('server_tool_execution_failed')
    expect(JSON.stringify(body)).not.toContain('No accessible workspaces')
  })

  it('accepts a case-insensitive bearer auth scheme', async () => {
    const { POST } = await import('./route')

    const response = await POST(createMcpRequest(initializeRequest(), 'bearer sk-lowercase'))

    expect(response.status).toBe(200)
    expect(mockAuthenticateApiKeyFromHeader).toHaveBeenCalledWith('sk-lowercase', {
      keyTypes: ['personal'],
    })
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

  it('returns MCP rate-limit errors from the shared API limiter', async () => {
    const { POST } = await import('./route')
    mockCheckApiEndpointRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      limit: 10,
      resetAt: new Date('2026-06-24T12:01:00.000Z'),
      userId: 'user-1',
    })

    const response = await POST(createMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10')
    expect(response.headers.get('Retry-After')).toBeTruthy()
    expect(body.error.message).toBe('Rate limit exceeded')
    expect(mockGetCopilotRuntimeToolManifest).not.toHaveBeenCalled()
  })

  it('applies the public MCP rate limit before API-key authentication', async () => {
    const { POST } = await import('./route')
    mockCheckPublicApiEndpointRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      limit: 300,
      resetAt: new Date('2026-06-24T12:01:00.000Z'),
    })

    const response = await POST(createMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))

    expect(response.status).toBe(429)
    expect(mockAuthenticateApiKeyFromHeader).not.toHaveBeenCalled()
    expect(mockCheckApiEndpointRateLimit).not.toHaveBeenCalled()
  })

  it('rejects tools outside the external MCP allow-list', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createMcpRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'make_api_request',
          arguments: { url: 'https://example.test', method: 'GET' },
        },
      })
    )
    const body = await response.json()

    expect(body.error.message).toBe('Unsupported MCP tool: make_api_request')
    expect(mockRouteExecution).not.toHaveBeenCalled()
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

  it('dispatches external MCP mutation tools with full personal-agent access', async () => {
    const { POST } = await import('./route')
    mockGetMcpServerToolIds.mockReturnValueOnce(['edit_workflow'])
    mockRouteExecution.mockResolvedValueOnce({ success: true })

    const response = await POST(
      createMcpRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'edit_workflow',
          arguments: { workflowId: 'workflow-1', mermaid: 'graph TD' },
        },
      })
    )
    const body = await response.json()

    expect(mockRouteExecution).toHaveBeenCalledWith(
      'edit_workflow',
      { workflowId: 'workflow-1', mermaid: 'graph TD' },
      { userId: 'user-1', accessLevel: 'full' }
    )
    expect(body.result.structuredContent).toEqual({ success: true })
  })

  it('returns a sanitized tool result when a tool execution fails', async () => {
    const { POST } = await import('./route')
    mockGetMcpServerToolIds.mockReturnValue(['list_workflows'])
    mockRouteExecution.mockRejectedValueOnce(new Error('connection refused at db.internal:5432'))

    const response = await POST(
      createMcpRequest({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'list_workflows', arguments: {} },
      })
    )
    const body = await response.json()

    expect(body.error).toBeUndefined()
    expect(body.result.isError).toBe(true)
    expect(body.result.structuredContent.code).toBe('server_tool_execution_failed')
    expect(body.result.structuredContent.error).toBe('Server tool execution failed')
    expect(body.result.content[0].text).not.toContain('db.internal')
  })

  it('sanitizes errors thrown by non-tool methods instead of leaking a raw response', async () => {
    const { POST } = await import('./route')
    mockGetUserWorkspaces.mockRejectedValueOnce(new Error('workspace bootstrap failed at shard-3'))

    const response = await POST(createMcpRequest(initializeRequest(7)))
    const body = await response.json()

    expect(body.error.code).toBe(-32603)
    expect(body.error.data.code).toBe('server_tool_execution_failed')
    expect(body.error.message).toBe('Server tool execution failed')
    expect(JSON.stringify(body)).not.toContain('shard-3')
  })

  it('enforces JSON-RPC and MCP initialize request shape', async () => {
    const { POST } = await import('./route')

    const invalidJsonRpcResponse = await POST(
      createMcpRequest({ jsonrpc: '1.0', id: 8, method: 'ping' })
    )
    const nullIdResponse = await POST(
      createMcpRequest({ jsonrpc: '2.0', id: null, method: 'ping' })
    )
    const invalidInitializeResponse = await POST(
      createMcpRequest({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} })
    )
    const unsupportedVersionResponse = await POST(createMcpRequest(initializeRequest(10, '1.0')))

    expect((await invalidJsonRpcResponse.json()).error.code).toBe(-32600)
    expect((await nullIdResponse.json()).error.code).toBe(-32600)
    expect((await invalidInitializeResponse.json()).error.code).toBe(-32602)
    const unsupportedVersionBody = await unsupportedVersionResponse.json()
    expect(unsupportedVersionBody.error.code).toBe(-32000)
    expect(unsupportedVersionBody.error.data.supportedProtocolVersions).toEqual(['2025-03-26'])
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

  it('rejects oversized JSON-RPC batches before dispatch', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createMcpRequest(
        Array.from({ length: 11 }, (_, index) => ({
          jsonrpc: '2.0',
          id: index + 1,
          method: 'tools/call',
          params: { name: 'list_workflows', arguments: { workspaceId: 'workspace-1' } },
        }))
      )
    )
    const body = await response.json()

    expect(body.error.message).toBe('JSON-RPC batch size cannot exceed 10')
    expect(mockRouteExecution).not.toHaveBeenCalled()
  })

  it('rejects batched initialize requests', async () => {
    const { POST } = await import('./route')

    const response = await POST(createMcpRequest([initializeRequest()]))
    const body = await response.json()

    expect(body.error.code).toBe(-32600)
    expect(body.error.message).toBe('initialize cannot be batched')
    expect(mockGetUserWorkspaces).not.toHaveBeenCalled()
  })
})
