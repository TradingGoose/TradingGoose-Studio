import { type NextRequest, NextResponse } from 'next/server'
import {
  checkApiEndpointRateLimit,
  checkPublicApiEndpointRateLimit,
  type RateLimitResult,
} from '@/lib/api/rate-limit'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getCopilotRuntimeToolManifest } from '@/lib/copilot/runtime-tool-manifest'
import { getMcpServerToolIds, routeExecution } from '@/lib/copilot/tools/server/router'
import { getUserWorkspaces } from '@/lib/workspaces/service'

export const dynamic = 'force-dynamic'

const MCP_PROTOCOL_VERSION = '2025-03-26'
const SERVER_NAME = 'TradingGoose'
const SERVER_VERSION = '0.1.0'
const MAX_JSON_RPC_BATCH_SIZE = 10

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
}

type AuthenticatedMcpUser = {
  userId: string
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  }
}

function mcpJsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('MCP-Protocol-Version', MCP_PROTOCOL_VERSION)

  return NextResponse.json(body, {
    ...init,
    headers,
  })
}

function mcpRateLimitResponse(result: RateLimitResult) {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toISOString(),
  }
  const retryAfter = Math.max(0, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))
  headers['Retry-After'] = retryAfter.toString()

  const status =
    result.failureKind === 'auth' ? 401 : result.failureKind === 'dependency' ? 503 : 429
  const message =
    result.failureKind === 'dependency'
      ? result.error || 'Rate limit service unavailable'
      : result.error || 'Rate limit exceeded'

  return mcpJsonResponse(jsonRpcError(null, -32029, message), { status, headers })
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return null
  }

  const token = match[1].trim()
  return token || null
}

async function authenticateCopilotMcpRequest(
  request: NextRequest
): Promise<AuthenticatedMcpUser | { error: string }> {
  const token = getBearerToken(request)
  if (!token) {
    return { error: 'Bearer token required' }
  }

  const auth = await authenticateApiKeyFromHeader(token, { keyTypes: ['personal'] })
  if (!auth.success || !auth.userId) {
    return { error: 'Invalid TradingGoose MCP token' }
  }

  if (auth.keyId) {
    await updateApiKeyLastUsed(auth.keyId)
  }

  return { userId: auth.userId }
}

async function buildInstructions(userId: string) {
  const workspaces = await getUserWorkspaces({ userId, autoCreate: false })
  const workspaceLines =
    workspaces.length > 0
      ? workspaces.map(
          (workspace) =>
            `- ${workspace.name}: workspaceId=${workspace.id}, permissions=${workspace.permissions}`
        )
      : ['- No accessible workspaces were found.']

  return [
    'TradingGoose Copilot MCP exposes server-side Copilot tools for trusted personal coding agents, including direct mutation tools.',
    'Local MCP config stores only this user auth token. Do not store workspaceId, entityId, or entity targets in the local MCP config.',
    'Use tools/list as the source of truth for each tool input schema; target identifiers are tool-specific and come from list/read tool results. Mutating tools execute directly for the authenticated MCP key; Studio review tokens are not part of the external MCP protocol. Credential, OAuth, and environment reads require scope="personal" for the authenticated user or scope="workspace" with workspaceId. Workspace-scoped tools, including list/create, Google Drive, and workspace account reads, require workspaceId. Environment writes use the same personal/workspace scope rule.',
    'MCP server documents redact header/env secret values as [redacted]. Keep [redacted] to preserve an existing secret, send a concrete value to replace it, or omit the key to delete it.',
    'Accessible workspaces for the authenticated user:',
    ...workspaceLines,
  ].join('\n')
}

async function listMcpTools() {
  const serverToolIds = new Set<string>(getMcpServerToolIds())
  const manifest = await getCopilotRuntimeToolManifest()

  return manifest.tools
    .filter((tool) => serverToolIds.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters ?? {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    }))
}

function getToolCallParams(params: unknown) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return null
  }

  const { name, arguments: args } = params as { name?: unknown; arguments?: unknown }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return null
  }

  return {
    name,
    args: args ?? {},
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function handleJsonRpcRequest(entry: unknown, auth: AuthenticatedMcpUser) {
  if (!isJsonRpcRequest(entry)) {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC request')
  }

  const request = entry
  const id = request.id ?? null
  if (typeof request.method !== 'string') {
    return jsonRpcError(id, -32600, 'Invalid JSON-RPC request')
  }

  if (request.id === undefined) {
    return null
  }

  switch (request.method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
        instructions: await buildInstructions(auth.userId),
      })

    case 'ping':
      return jsonRpcResult(id, {})

    case 'tools/list':
      return jsonRpcResult(id, {
        tools: await listMcpTools(),
      })

    case 'tools/call': {
      const toolCall = getToolCallParams(request.params)
      if (!toolCall) {
        return jsonRpcError(id, -32602, 'Invalid tools/call params')
      }
      if (!getMcpServerToolIds().some((toolName) => toolName === toolCall.name)) {
        return jsonRpcError(id, -32601, `Unsupported MCP tool: ${toolCall.name}`)
      }

      try {
        const result = await routeExecution(toolCall.name, toolCall.args, {
          userId: auth.userId,
          accessLevel: 'full',
        })
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        })
      } catch (error) {
        return jsonRpcResult(id, {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Copilot MCP tool call failed',
            },
          ],
        })
      }
    }

    case 'resources/list':
      return jsonRpcResult(id, { resources: [] })

    case 'prompts/list':
      return jsonRpcResult(id, { prompts: [] })

    default:
      return jsonRpcError(id, -32601, `Unsupported MCP method: ${request.method}`)
  }
}

export async function POST(request: NextRequest) {
  const publicRateLimit = await checkPublicApiEndpointRateLimit(request, 'copilot-mcp-public')
  if (!publicRateLimit.allowed) {
    return mcpRateLimitResponse(publicRateLimit)
  }

  const auth = await authenticateCopilotMcpRequest(request)
  if ('error' in auth) {
    return mcpJsonResponse(jsonRpcError(null, -32001, auth.error), { status: 401 })
  }

  const rateLimit = await checkApiEndpointRateLimit(auth.userId, 'copilot-mcp')
  if (!rateLimit.allowed) {
    return mcpRateLimitResponse(rateLimit)
  }

  const body = (await request.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null
  if (!body) {
    return mcpJsonResponse(jsonRpcError(null, -32700, 'Invalid JSON body'), { status: 400 })
  }

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return mcpJsonResponse(jsonRpcError(null, -32600, 'Invalid JSON-RPC request'))
    }
    if (body.length > MAX_JSON_RPC_BATCH_SIZE) {
      return mcpJsonResponse(
        jsonRpcError(null, -32600, `JSON-RPC batch size cannot exceed ${MAX_JSON_RPC_BATCH_SIZE}`)
      )
    }

    const responses = []
    for (const entry of body) {
      const response = await handleJsonRpcRequest(entry, auth)
      if (response) responses.push(response)
    }

    return responses.length > 0
      ? mcpJsonResponse(responses)
      : new NextResponse(null, { status: 204 })
  }

  const response = await handleJsonRpcRequest(body, auth)
  return response ? mcpJsonResponse(response) : new NextResponse(null, { status: 204 })
}
