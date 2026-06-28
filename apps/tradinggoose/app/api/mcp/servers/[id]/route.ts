import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { savedEntityRowToFields } from '@/lib/yjs/entity-state'
import {
  applySavedEntityState,
  SavedEntityPersistenceError,
} from '@/lib/yjs/server/apply-entity-state'
import { UpdateMcpServerSchema } from '../schema'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Update an MCP server in the workspace (requires write permission)
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

      const parseResult = UpdateMcpServerSchema.safeParse(rawBody)
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

      const [server] = await db
        .select()
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

      const { workspaceId: _bodyWorkspaceId, ...updates } = body
      const fields = savedEntityRowToFields('mcp_server', server)
      const nextFields = { ...fields, ...updates }
      await applySavedEntityState('mcp_server', serverId, nextFields)

      logger.info(`[${requestId}] Successfully updated MCP server: ${serverId}`)
      return createMcpSuccessResponse({
        server: {
          id: serverId,
          workspaceId,
          name: String(nextFields.name ?? ''),
          enabled: nextFields.enabled !== false,
        },
      })
    } catch (error) {
      if (error instanceof SavedEntityPersistenceError) {
        return createMcpErrorResponse(error, error.message, error.status)
      }

      logger.error(`[${requestId}] Error updating MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to update MCP server'),
        'Failed to update MCP server',
        500
      )
    }
  }
)
