import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import { createLogger } from '@/lib/logs/console/logger'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import {
  deleteYjsSessionInSocketServer,
  notifyEntityListMemberRemoved,
  notifyEntityListMembersAdded,
} from '@/lib/yjs/server/snapshot-bridge'
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

      const servers = await mcpService.listWorkspaceServers(workspaceId)

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

      let fields: Record<string, unknown>
      try {
        fields = normalizeEntityFields('mcp_server', body)
      } catch (error) {
        return createMcpErrorResponse(
          error instanceof Error ? error : new Error('Invalid MCP server fields'),
          'Invalid MCP server fields',
          400
        )
      }

      const serverId = crypto.randomUUID()

      await db.insert(mcpServers).values({
        id: serverId,
        workspaceId,
        createdBy: userId,
        name: String(fields.name ?? ''),
        description: String(fields.description ?? '') || null,
        transport: String(fields.transport ?? ''),
        url: String(fields.url ?? '') || null,
        headers: fields.headers,
        command: String(fields.command ?? '') || null,
        args: Array.isArray(fields.args) ? fields.args.map(String) : [],
        env: fields.env,
        timeout: Number(fields.timeout ?? 30000),
        retries: Number(fields.retries ?? 3),
        enabled: fields.enabled !== false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      mcpService.clearCache(workspaceId)
      await notifyEntityListMembersAdded('mcp_server', workspaceId, [
        { id: serverId, name: String(fields.name ?? ''), enabled: fields.enabled !== false },
      ])

      logger.info(`[${requestId}] Successfully registered MCP server: ${fields.name}`)

      // Track MCP server registration
      try {
        const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
        trackPlatformEvent('platform.mcp.server_added', {
          'mcp.server_id': serverId,
          'mcp.server_name': String(fields.name ?? ''),
          'mcp.transport': String(fields.transport ?? ''),
          'workspace.id': workspaceId,
        })
      } catch (_e) {
        // Silently fail
      }

      return createMcpSuccessResponse({ serverId }, 201)
    } catch (error) {
      logger.error(`[${requestId}] Error registering MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to register MCP server'),
        'Failed to register MCP server',
        500
      )
    }
  }
)

/**
 * DELETE - Delete an MCP server from the workspace (requires write permission)
 */
export const DELETE = withMcpAuth('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
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

      const [server] = await db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      await db
        .delete(mcpServers)
        .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      await deleteYjsSessionInSocketServer(serverId).catch(() => undefined)
      await notifyEntityListMemberRemoved('mcp_server', workspaceId, serverId)

      mcpService.clearCache(workspaceId)

      logger.info(`[${requestId}] Successfully deleted MCP server: ${serverId}`)
      return createMcpSuccessResponse({ message: `Server ${serverId} deleted successfully` })
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
