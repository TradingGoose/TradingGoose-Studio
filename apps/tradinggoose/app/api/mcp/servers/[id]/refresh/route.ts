import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { withMcpAuth } from '@/lib/mcp/middleware'
import { McpServerNotFoundError, mcpService } from '@/lib/mcp/service'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { toSavedEntityTransportError } from '@/lib/yjs/server/apply-entity-state'
import { lockSavedEntityList } from '@/lib/yjs/server/entity-loaders'
import { refreshEntityListSession } from '@/lib/yjs/server/snapshot-bridge'

const logger = createLogger('McpServerRefreshAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Refresh an MCP server connection (requires any workspace permission)
 */
export const POST = withMcpAuth('read')(
  async (
    request: NextRequest,
    { userId, workspaceId, requestId },
    { params }: { params: { id: string } }
  ) => {
    const serverId = params.id

    try {
      logger.info(
        `[${requestId}] Refreshing MCP server: ${serverId} in workspace: ${workspaceId}`,
        {
          userId,
        }
      )

      const [server] = await db
        .select({ lastConnected: mcpServers.lastConnected })
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      let connectionStatus: 'connected' | 'disconnected' | 'error' = 'error'
      let toolCount = 0
      let lastError: string | null = null

      try {
        const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId, false)
        connectionStatus = 'connected'
        toolCount = tools.length
        logger.info(
          `[${requestId}] Successfully connected to server ${serverId}, discovered ${toolCount} tools`
        )
      } catch (error) {
        if (error instanceof McpServerNotFoundError) throw error
        const transportError = toSavedEntityTransportError(error)
        if (transportError) throw transportError
        connectionStatus = 'error'
        lastError = error instanceof Error ? error.message : 'Connection test failed'
        logger.warn(`[${requestId}] Failed to connect to server ${serverId}:`, error)
      }

      const now = new Date()
      const lastConnected = connectionStatus === 'connected' ? now : server.lastConnected
      await db.transaction(async (tx) => {
        await lockSavedEntityList(tx, 'mcp_server', workspaceId)
        await tx
          .update(mcpServers)
          .set({
            lastToolsRefresh: now,
            connectionStatus,
            lastError,
            lastConnected,
            toolCount,
            updatedAt: now,
          })
          .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      })
      await refreshEntityListSession('mcp_server', workspaceId)

      logger.info(`[${requestId}] Successfully refreshed MCP server: ${serverId}`)
      return createMcpSuccessResponse({
        status: connectionStatus,
        toolCount,
        lastConnected: lastConnected?.toISOString() ?? null,
        lastToolsRefresh: now.toISOString(),
        error: lastError,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error refreshing MCP server:`, error)
      if (error instanceof McpServerNotFoundError) {
        return createMcpErrorResponse(error, 'Server not found', error.status)
      }
      const transportError = toSavedEntityTransportError(error)
      if (transportError)
        return createMcpErrorResponse(transportError, transportError.message, transportError.status)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to refresh MCP server'),
        'Failed to refresh MCP server',
        500
      )
    }
  }
)
