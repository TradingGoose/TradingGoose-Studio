import type { NextRequest } from 'next/server'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import { createLogger } from '@/lib/logs/console/logger'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { SavedEntityRealtimeRequiredError } from '@/lib/yjs/entity-state'
import {
  applySavedEntityState,
  SavedEntityPersistenceError,
} from '@/lib/yjs/server/apply-entity-state'
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'
import { RenameMcpServerSchema } from '../schema'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Rename an MCP server in the workspace (requires write permission).
 * Full config edits are saved through the MCP saved-entity Yjs session.
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
        updates: ['name'],
      })

      const access = await verifyReviewTargetAccess(
        userId,
        buildSavedEntityDescriptor('mcp_server', serverId, workspaceId),
        'write'
      )
      if (!access.hasAccess || access.workspaceId !== workspaceId) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      const currentFields = await readBootstrappedSavedEntityFields(
        'mcp_server',
        serverId,
        workspaceId
      )
      await applySavedEntityState('mcp_server', serverId, { ...currentFields, name: body.name })

      logger.info(`[${requestId}] Successfully updated MCP server: ${serverId}`)
      return createMcpSuccessResponse({
        server: {
          id: serverId,
          workspaceId,
          name: body.name,
        },
      })
    } catch (error) {
      if (error instanceof SavedEntityRealtimeRequiredError) {
        return createMcpErrorResponse(error, error.message, error.status)
      }

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
