import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { savedEntityRowToFields } from '@/lib/yjs/entity-state'
import { applySavedEntityPersistedState } from '@/lib/yjs/server/apply-entity-state'
import { UpdateMcpServerSchema } from '../schema'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Update an MCP server in the workspace (requires write or admin permission)
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

      // Validate URL if being updated
      if (
        body.url &&
        (body.transport === 'http' ||
          body.transport === 'sse' ||
          body.transport === 'streamable-http')
      ) {
        const urlValidation = validateMcpServerUrl(body.url)
        if (!urlValidation.isValid) {
          return createMcpErrorResponse(
            new Error(`Invalid MCP server URL: ${urlValidation.error}`),
            'Invalid server URL',
            400
          )
        }
        body.url = urlValidation.normalizedUrl
      }

      const [existingServer] = await db
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

      if (!existingServer) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      const { workspaceId: _, ...updateData } = body
      const nextServer = {
        ...existingServer,
        ...updateData,
        updatedAt: new Date(),
      }

      await applySavedEntityPersistedState(
        'mcp_server',
        nextServer.id,
        savedEntityRowToFields('mcp_server', nextServer)
      )

      // Clear MCP service cache after update
      mcpService.clearCache(workspaceId)

      logger.info(`[${requestId}] Successfully updated MCP server: ${serverId}`)
      return createMcpSuccessResponse({ server: nextServer })
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
