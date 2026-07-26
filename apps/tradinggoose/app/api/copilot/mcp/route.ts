import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { type NextRequest, NextResponse } from 'next/server'
import {
  checkApiEndpointRateLimit,
  checkPublicApiEndpointRateLimit,
  type RateLimitResult,
} from '@/lib/api/rate-limit'
import {
  type ApiKeyType,
  authenticateApiKeyFromHeader,
  updateApiKeyLastUsed,
} from '@/lib/api-key/service'
import { ToolArgSchemas } from '@/lib/copilot/registry'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'
import { getMcpServerToolIds, routeExecution } from '@/lib/copilot/tools/server/router'
import { createDefaultWorkspaceForUser, getUserWorkspaces } from '@/lib/workspaces/service'

export const dynamic = 'force-dynamic'

const SERVER_NAME = 'TradingGoose'
const SERVER_VERSION = '0.1.0'
const MAX_JSON_RPC_BATCH_SIZE = 10

type AuthenticatedMcpUser = {
  userId: string
  apiKeyType: ApiKeyType
}

function jsonRpcError(code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id: null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  }
}

function mcpJsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, init)
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

  return mcpJsonResponse(jsonRpcError(-32029, message), { status, headers })
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
  if (!auth.success || !auth.userId || auth.keyType !== 'personal') {
    return { error: 'Invalid TradingGoose MCP token' }
  }

  if (auth.keyId) {
    await updateApiKeyLastUsed(auth.keyId)
  }

  return { userId: auth.userId, apiKeyType: auth.keyType }
}

async function buildInstructions(userId: string) {
  const existingWorkspaces = await getUserWorkspaces({ userId })
  const workspaces =
    existingWorkspaces.length > 0
      ? existingWorkspaces
      : [await createDefaultWorkspaceForUser(userId)]
  const workspaceLines = workspaces.map(
    (workspace) =>
      `- ${workspace.name}: workspaceId=${workspace.id}, permissions=${workspace.permissions}`
  )

  return [
    'TradingGoose Copilot MCP exposes server-side Copilot tools for trusted personal coding agents, including direct mutation tools.',
    'Local MCP config stores only this user auth token. Do not store workspaceId, entityId, or entity targets in the local MCP config.',
    'Use tools/list as the source of truth for each tool input schema; target identifiers are tool-specific and come from list/read tool results. Mutating tools execute directly for the authenticated MCP key; Studio review tokens are not part of the external MCP protocol. Credential, OAuth, and environment reads require scope="personal" for the authenticated user or scope="workspace" with workspaceId. Workspace-scoped tools, including list/create, Google Drive, and workspace account reads, require workspaceId. Environment writes use the same personal/workspace scope rule.',
    'MCP server documents redact header/env values as `[redacted]`. Preserve an existing same-key value with that placeholder, submit a concrete value to replace it, and omit only keys that should be deleted.',
    'Accessible workspaces for the authenticated user:',
    ...workspaceLines,
  ].join('\n')
}

async function createMcpServer(auth: AuthenticatedMcpUser) {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: await buildInstructions(auth.userId),
    }
  )

  for (const toolName of getMcpServerToolIds()) {
    server.registerTool(
      toolName,
      {
        description: TOOL_PROMPT_METADATA[toolName].description,
        inputSchema: ToolArgSchemas[toolName],
      },
      // Typed as unknown because the registry's schemas differ per tool;
      // routeExecution re-validates against the tool's own schema.
      async (args: unknown) => {
        try {
          const result = await routeExecution(toolName, args, {
            userId: auth.userId,
            apiKeyType: auth.apiKeyType,
            accessLevel: 'full',
          })
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          }
        } catch (error) {
          const structuredError = buildCopilotServerToolErrorResponse(toolName, error)
          return {
            isError: true,
            content: [
              { type: 'text' as const, text: JSON.stringify(structuredError.body, null, 2) },
            ],
            structuredContent: structuredError.body,
          }
        }
      }
    )
  }

  server.server.registerCapabilities({ prompts: {}, resources: {} })
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }))
  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }))
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [],
  }))

  return server
}

export async function POST(request: NextRequest) {
  const publicRateLimit = await checkPublicApiEndpointRateLimit(request, 'copilot-mcp-public')
  if (!publicRateLimit.allowed) {
    return mcpRateLimitResponse(publicRateLimit)
  }

  const auth = await authenticateCopilotMcpRequest(request)
  if ('error' in auth) {
    return mcpJsonResponse(jsonRpcError(-32001, auth.error), { status: 401 })
  }

  const rateLimit = await checkApiEndpointRateLimit(auth.userId, 'copilot-mcp')
  if (!rateLimit.allowed) {
    return mcpRateLimitResponse(rateLimit)
  }

  const parsedBody = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (Array.isArray(parsedBody) && parsedBody.length > MAX_JSON_RPC_BATCH_SIZE) {
    return mcpJsonResponse(
      jsonRpcError(-32600, `JSON-RPC batch size cannot exceed ${MAX_JSON_RPC_BATCH_SIZE}`)
    )
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  })
  let server: McpServer | undefined

  try {
    server = await createMcpServer(auth)
    await server.connect(transport)
    return await transport.handleRequest(request, { parsedBody })
  } catch (error) {
    const structuredError = buildCopilotServerToolErrorResponse(undefined, error)
    return mcpJsonResponse(jsonRpcError(-32603, structuredError.body.error, structuredError.body), {
      status: 500,
    })
  } finally {
    await server?.close()
  }
}

export async function GET() {
  return new NextResponse(null, {
    status: 405,
    headers: {
      Allow: 'POST',
    },
  })
}
