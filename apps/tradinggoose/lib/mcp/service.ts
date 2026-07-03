import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { McpClient } from '@/lib/mcp/client'
import type {
  McpServerConfig,
  McpTool,
  McpToolCall,
  McpToolResult,
  McpTransport,
} from '@/lib/mcp/types'
import { generateRequestId } from '@/lib/utils'
import { savedEntityRowToFields } from '@/lib/yjs/entity-state'
import {
  readSavedEntityFieldsForExecution,
  readSavedEntityListFieldsForExecution,
} from '@/lib/yjs/server/bootstrap-review-target'
import { refreshEntityListSession } from '@/lib/yjs/server/snapshot-bridge'

const logger = createLogger('McpService')

export class McpServerNotFoundError extends Error {
  readonly status = 404

  constructor(serverId: string) {
    super(`Server ${serverId} not found or not accessible`)
    this.name = 'McpServerNotFoundError'
  }
}

export class McpServerConfigError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'McpServerConfigError'
  }
}

class McpService {
  /**
   * Resolve environment variables in strings
   */
  private resolveEnvVars(value: string, envVars: Record<string, string>): string {
    const envMatches = value.match(/\{\{([^}]+)\}\}/g)
    if (!envMatches) return value

    let resolvedValue = value
    const missingVars: string[] = []

    for (const match of envMatches) {
      const envKey = match.slice(2, -2).trim()
      const envValue = envVars[envKey]

      if (envValue === undefined) {
        missingVars.push(envKey)
        continue
      }

      resolvedValue = resolvedValue.replace(match, envValue)
    }

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variable${missingVars.length > 1 ? 's' : ''}: ${missingVars.join(', ')}. ` +
          `Please set ${missingVars.length > 1 ? 'these variables' : 'this variable'} in your workspace or personal environment settings.`
      )
    }

    return resolvedValue
  }

  /**
   * Resolve environment variables in server config
   */
  private async resolveConfigEnvVars(
    config: McpServerConfig,
    userId: string,
    workspaceId?: string
  ): Promise<McpServerConfig> {
    try {
      const envVars = await getEffectiveDecryptedEnv(userId, workspaceId)

      const resolvedConfig = { ...config }

      if (resolvedConfig.url) {
        resolvedConfig.url = this.resolveEnvVars(resolvedConfig.url, envVars)
      }

      if (resolvedConfig.headers) {
        const resolvedHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(resolvedConfig.headers)) {
          resolvedHeaders[key] = this.resolveEnvVars(value, envVars)
        }
        resolvedConfig.headers = resolvedHeaders
      }

      return resolvedConfig
    } catch (error) {
      logger.error('Failed to resolve environment variables for MCP server config:', error)
      return config
    }
  }

  private toServerConfig(serverId: string, fields: Record<string, unknown>): McpServerConfig {
    return {
      id: serverId,
      name: String(fields.name ?? ''),
      description: String(fields.description ?? '') || undefined,
      transport: fields.transport as McpTransport,
      url: String(fields.url ?? '') || undefined,
      headers: fields.headers as Record<string, string>,
      timeout: Number(fields.timeout ?? 30000),
      retries: Number(fields.retries ?? 3),
      enabled: fields.enabled !== false,
    }
  }

  async createWorkspaceServer(input: {
    userId: string
    workspaceId: string
    fields: Record<string, unknown>
  }): Promise<{ entityId: string; fields: Record<string, unknown> }> {
    let normalized: Record<string, unknown>
    try {
      normalized = normalizeEntityFields('mcp_server', input.fields)
    } catch (error) {
      throw new McpServerConfigError(error instanceof Error ? error.message : 'Invalid MCP server')
    }

    const entityId = crypto.randomUUID()
    const [row] = await db
      .insert(mcpServers)
      .values({
        id: entityId,
        workspaceId: input.workspaceId,
        createdBy: input.userId,
        name: String(normalized.name ?? ''),
        description: String(normalized.description ?? '') || null,
        transport: normalized.transport as McpTransport,
        url: String(normalized.url ?? '') || null,
        headers: normalized.headers,
        command: String(normalized.command ?? '') || null,
        args: Array.isArray(normalized.args) ? normalized.args.map(String) : [],
        env: normalized.env,
        timeout: Number(normalized.timeout ?? 30000),
        retries: Number(normalized.retries ?? 3),
        enabled: normalized.enabled !== false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    if (!row) {
      throw new Error('Created MCP server was not returned from canonical insert')
    }

    await refreshEntityListSession('mcp_server', input.workspaceId)

    return { entityId, fields: savedEntityRowToFields('mcp_server', row) }
  }

  private async getServerConfig(
    serverId: string,
    workspaceId: string,
    isDeployedContext = true
  ): Promise<McpServerConfig | null> {
    try {
      const fields = normalizeEntityFields(
        'mcp_server',
        await readSavedEntityFieldsForExecution(
          'mcp_server',
          serverId,
          workspaceId,
          isDeployedContext
        )
      )
      return fields.enabled === false ? null : this.toServerConfig(serverId, fields)
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { status?: number }).status === 404
      ) {
        return null
      }
      throw error
    }
  }

  private async getWorkspaceServers(
    workspaceId: string,
    isDeployedContext = true
  ): Promise<McpServerConfig[]> {
    const servers = await readSavedEntityListFieldsForExecution(
      'mcp_server',
      workspaceId,
      isDeployedContext
    )

    return servers.flatMap(({ entityId, fields: rawFields }) => {
      try {
        const fields = normalizeEntityFields('mcp_server', rawFields)
        return fields.enabled === false ? [] : [this.toServerConfig(entityId, fields)]
      } catch (error) {
        logger.warn(`Skipping invalid MCP server ${entityId} during workspace discovery:`, error)
        return []
      }
    })
  }

  /**
   * Create and connect to an MCP client with security policy
   */
  private async createClient(config: McpServerConfig): Promise<McpClient> {
    const securityPolicy = {
      requireConsent: true,
      auditLevel: 'basic' as const,
      maxToolExecutionsPerHour: 1000,
      allowedOrigins: config.url ? [new URL(config.url).origin] : undefined,
    }

    const client = new McpClient(config, securityPolicy)
    await client.connect()
    return client
  }

  /**
   * Execute a tool on a specific server
   */
  async executeTool(
    userId: string,
    serverId: string,
    toolCall: McpToolCall,
    workspaceId: string,
    isDeployedContext = true
  ): Promise<McpToolResult> {
    const requestId = generateRequestId()

    try {
      logger.info(
        `[${requestId}] Executing MCP tool ${toolCall.name} on server ${serverId} for user ${userId}`
      )

      const config = await this.getServerConfig(serverId, workspaceId, isDeployedContext)
      if (!config) {
        throw new McpServerNotFoundError(serverId)
      }

      const resolvedConfig = await this.resolveConfigEnvVars(config, userId, workspaceId)

      const client = await this.createClient(resolvedConfig)

      try {
        const result = await client.callTool(toolCall)
        logger.info(`[${requestId}] Successfully executed tool ${toolCall.name}`)
        return result
      } finally {
        await client.disconnect()
      }
    } catch (error) {
      logger.error(
        `[${requestId}] Failed to execute tool ${toolCall.name} on server ${serverId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Discover tools from all workspace servers
   */
  async discoverTools(
    userId: string,
    workspaceId: string,
    isDeployedContext = true
  ): Promise<McpTool[]> {
    const requestId = generateRequestId()

    try {
      logger.info(`[${requestId}] Discovering MCP tools for workspace ${workspaceId}`)

      const servers = await this.getWorkspaceServers(workspaceId, isDeployedContext)

      if (servers.length === 0) {
        logger.info(`[${requestId}] No servers found for workspace ${workspaceId}`)
        return []
      }

      const allTools: McpTool[] = []
      const results = await Promise.allSettled(
        servers.map(async (config) => {
          const resolvedConfig = await this.resolveConfigEnvVars(config, userId, workspaceId)
          const client = await this.createClient(resolvedConfig)
          try {
            const tools = await client.listTools()
            logger.debug(
              `[${requestId}] Discovered ${tools.length} tools from server ${config.name}`
            )
            return tools
          } finally {
            await client.disconnect()
          }
        })
      )

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          allTools.push(...result.value)
        } else {
          logger.warn(
            `[${requestId}] Failed to discover tools from server ${servers[index].name}:`,
            result.reason
          )
        }
      })

      logger.info(
        `[${requestId}] Discovered ${allTools.length} tools from ${servers.length} servers`
      )
      return allTools
    } catch (error) {
      logger.error(`[${requestId}] Failed to discover MCP tools for user ${userId}:`, error)
      throw error
    }
  }

  /**
   * Discover tools from a specific server
   */
  async discoverServerTools(
    userId: string,
    serverId: string,
    workspaceId: string,
    isDeployedContext = true
  ): Promise<McpTool[]> {
    const requestId = generateRequestId()

    try {
      logger.info(`[${requestId}] Discovering tools from server ${serverId} for user ${userId}`)

      const config = await this.getServerConfig(serverId, workspaceId, isDeployedContext)
      if (!config) {
        throw new McpServerNotFoundError(serverId)
      }

      const resolvedConfig = await this.resolveConfigEnvVars(config, userId, workspaceId)

      const client = await this.createClient(resolvedConfig)

      try {
        const tools = await client.listTools()
        logger.info(`[${requestId}] Discovered ${tools.length} tools from server ${config.name}`)
        return tools
      } finally {
        await client.disconnect()
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to discover tools from server ${serverId}:`, error)
      throw error
    }
  }
}

export const mcpService = new McpService()
