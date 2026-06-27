import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { notifyEntityListMembersUpserted } from '@/lib/yjs/server/snapshot-bridge'
import { RenameMcpServerSchema } from '../schema'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Rename an MCP server in the workspace (requires write permission)
 */
export const PATCH = withMcpAuth('write')(
  async (
    request: NextRequest,
    { userId, workspaceId, requestId },
    { params }: { params: { id: string } }
  ) => {
    const serverId = params.id

    try {
      const rawBody = getParsedBody(request) || (await request.json())

      const parseResult = RenameMcpServerSchema.safeParse(rawBody)
      if (!parseResult.success) {
        return createMcpErrorResponse(
          new Error(`Invalid request body: ${parseResult.error.message}`),
          'Invalid request body',
          400
        )
      }

      const body = parseResult.data

      logger.info(`[${requestId}] Updating MCP server: ${serverId} in workspace: ${workspaceId}`, {
        userId,
        updates: Object.keys(body).filter((k) => k !== 'workspaceId'),
      })

      const [updatedServer] = await db
        .update(mcpServers)
        .set({
          name: body.name.trim(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .returning({ id: mcpServers.id, name: mcpServers.name, enabled: mcpServers.enabled })

      if (!updatedServer) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      try {
        await notifyEntityListMembersUpserted('mcp_server', workspaceId, [
          {
            id: serverId,
            name: updatedServer.name,
            enabled: updatedServer.enabled !== false,
          },
        ])
      } catch (error) {
        logger.warn(`[${requestId}] Updated MCP server but failed list projection update`, {
          error,
          serverId,
        })
      }

      // Clear MCP service cache after update
      mcpService.clearCache(workspaceId)

      logger.info(`[${requestId}] Successfully updated MCP server: ${serverId}`)
      return createMcpSuccessResponse({
        server: {
          id: serverId,
          workspaceId,
          name: updatedServer.name,
          enabled: updatedServer.enabled !== false,
        },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error updating MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to update MCP server'),
        'Failed to update MCP server',
        500
      )
    }
  }
)
