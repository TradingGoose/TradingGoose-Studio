import { type NextRequest, NextResponse } from 'next/server'
import { updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getCopilotRuntimeToolManifest } from '@/lib/copilot/runtime-tool-manifest'
import { getServerToolIds, routeExecution } from '@/lib/copilot/tools/server/router'
import { authenticateMcpApiKey } from '@/lib/mcp/auth'
import { getUserWorkspaces } from '@/lib/workspaces/service'

export const dynamic = 'force-dynamic'

const MCP_PROTOCOL_VERSION = '2025-03-26'
const SERVER_NAME = 'TradingGoose'
const SERVER_VERSION = '0.1.0'

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

  const auth = await authenticateMcpApiKey(token)
  if (!auth.success || !auth.userId) {
    return { error: 'Invalid Copilot MCP bearer token' }
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
    'TradingGoose Copilot MCP exposes the same server-side Copilot tools used by TradingGoose Studio.',
    'Local MCP config stores only this user auth token. Do not store workspaceId, entityId, or entity targets in the local MCP config.',
    'Use entityId for read/edit/rename tools that target an existing entity. Use workspaceId for workspace-scoped tools, including list/create and environment, credential, OAuth, Google Drive, and workspace account reads.',
    'Accessible workspaces for the authenticated user:',
    ...workspaceLines,
  ].join('\n')
}

async function listMcpTools() {
  const serverToolIds = new Set<string>(getServerToolIds())
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

async function handleJsonRpcRequest(request: JsonRpcRequest, auth: AuthenticatedMcpUser) {
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
  const auth = await authenticateCopilotMcpRequest(request)
  if ('error' in auth) {
    return mcpJsonResponse(jsonRpcError(null, -32001, auth.error), { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null
  if (!body) {
    return mcpJsonResponse(jsonRpcError(null, -32700, 'Invalid JSON body'), { status: 400 })
  }

  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(body.map((entry) => handleJsonRpcRequest(entry, auth)))
    ).filter(Boolean)

    return responses.length > 0
      ? mcpJsonResponse(responses)
      : new NextResponse(null, { status: 204 })
  }

  const response = await handleJsonRpcRequest(body, auth)
  return response ? mcpJsonResponse(response) : new NextResponse(null, { status: 204 })
}
