import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { McpServerConfigError, mcpService } from '@/lib/mcp/service'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { deleteSavedEntity } from '@/lib/yjs/server/entity-loaders'
import { CreateMcpServerSchema } from './schema'

const logger = createLogger('McpServersAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - List all registered MCP servers for the workspace
 */
export const GET = withMcpAuth('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      logger.info(`[${requestId}] Listing MCP servers for workspace ${workspaceId}`)

      const rows = await db
        .select({
          id: mcpServers.id,
          name: mcpServers.name,
          enabled: mcpServers.enabled,
          updatedAt: mcpServers.updatedAt,
          connectionStatus: mcpServers.connectionStatus,
          lastError: mcpServers.lastError,
          toolCount: mcpServers.toolCount,
          lastConnected: mcpServers.lastConnected,
          lastToolsRefresh: mcpServers.lastToolsRefresh,
        })
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
        .orderBy(asc(mcpServers.name), asc(mcpServers.id))

      const servers = rows.map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled !== false,
        workspaceId,
        updatedAt: server.updatedAt?.toISOString(),
        connectionStatus: server.connectionStatus,
        lastError: server.lastError,
        toolCount: server.toolCount,
        lastConnected: server.lastConnected?.toISOString(),
        lastToolsRefresh: server.lastToolsRefresh?.toISOString(),
      }))

      logger.info(
        `[${requestId}] Listed ${servers.length} MCP servers for workspace ${workspaceId}`
      )
      return createMcpSuccessResponse({ servers })
    } catch (error) {
      logger.error(`[${requestId}] Error listing MCP servers:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to list MCP servers'),
        'Failed to list MCP servers',
        500
      )
    }
  }
)

/**
 * POST - Register a new MCP server for the workspace (requires write permission)
 */
export const POST = withMcpAuth('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const rawBody = getParsedBody(request) || (await request.json())

      const parseResult = CreateMcpServerSchema.safeParse(rawBody)
      if (!parseResult.success) {
        return createMcpErrorResponse(
          new Error(`Invalid request body: ${parseResult.error.message}`),
          'Invalid request body',
          400
        )
      }

      const body = parseResult.data

      logger.info(`[${requestId}] Registering new MCP server:`, {
        name: body.name,
        transport: body.transport,
        workspaceId,
      })

      const created = await mcpService.createWorkspaceServer({
        userId,
        workspaceId,
        name: body.name,
        fields: {
          description: body.description,
          transport: body.transport,
          url: body.url,
          headers: body.headers,
          command: body.command,
          args: body.args,
          env: body.env,
          timeout: body.timeout,
          retries: body.retries,
          enabled: body.enabled,
        },
      })

      logger.info(`[${requestId}] Successfully registered MCP server: ${created.entityName}`)

      // Track MCP server registration
      try {
        const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
        trackPlatformEvent('platform.mcp.server_added', {
          'mcp.server_id': created.entityId,
          'mcp.server_name': created.entityName,
          'mcp.transport': String(created.fields.transport ?? ''),
          'workspace.id': workspaceId,
        })
      } catch (_e) {
        // Silently fail
      }

      return createMcpSuccessResponse({ serverId: created.entityId }, 201)
    } catch (error) {
      if (error instanceof McpServerConfigError) {
        return createMcpErrorResponse(error, error.message, error.status)
      }
      logger.error(`[${requestId}] Error registering MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to register MCP server'),
        'Failed to register MCP server',
        500
      )
    }
  }
)

export const DELETE = withMcpAuth('write')(
  async (request: NextRequest, { workspaceId, requestId }) => {
    try {
      const { searchParams } = new URL(request.url)
      const serverId = searchParams.get('serverId')

      if (!serverId) {
        return createMcpErrorResponse(
          new Error('serverId parameter is required'),
          'Missing required parameter',
          400
        )
      }

      logger.info(`[${requestId}] Deleting MCP server: ${serverId} from workspace: ${workspaceId}`)

      const deleted = await deleteSavedEntity('mcp_server', serverId, workspaceId)
      if (!deleted) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      logger.info(`[${requestId}] Successfully deleted MCP server: ${serverId}`)
      return createMcpSuccessResponse({
        message: `Server ${serverId} deleted successfully`,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to delete MCP server'),
        'Failed to delete MCP server',
        500
      )
    }
  }
)
