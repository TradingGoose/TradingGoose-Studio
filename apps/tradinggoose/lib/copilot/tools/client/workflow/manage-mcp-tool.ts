import { Check, Loader2, Server, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface McpServerConfig {
  name: string
  transport: 'streamable-http'
  url?: string
  headers?: Record<string, string>
  timeout?: number
  enabled?: boolean
}

interface ManageMcpToolArgs {
  operation: 'add' | 'edit' | 'delete' | 'list'
  serverId?: string
  config?: McpServerConfig
}

const API_ENDPOINT = '/api/mcp/servers'

/**
 * Client tool for creating, editing, and deleting MCP tool servers via the copilot.
 */
export class ManageMcpToolClientTool extends BaseClientTool {
  static readonly id = 'manage_mcp_tool'
  private currentArgs?: ManageMcpToolArgs

  constructor(toolCallId: string) {
    super(toolCallId, ManageMcpToolClientTool.id, ManageMcpToolClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Managing MCP tool',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Manage MCP tool?', icon: Server },
      [ClientToolCallState.executing]: { text: 'Managing MCP tool', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed MCP tool', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to manage MCP tool', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted managing MCP tool',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped managing MCP tool',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const operation = params?.operation as 'add' | 'edit' | 'delete' | 'list' | undefined

      if (!operation) return undefined

      const serverName = params?.config?.name || params?.name || params?.serverName

      const getActionText = (verb: 'present' | 'past' | 'gerund') => {
        switch (operation) {
          case 'add':
            return verb === 'present' ? 'Add' : verb === 'past' ? 'Added' : 'Adding'
          case 'edit':
            return verb === 'present' ? 'Edit' : verb === 'past' ? 'Edited' : 'Editing'
          case 'delete':
            return verb === 'present' ? 'Delete' : verb === 'past' ? 'Deleted' : 'Deleting'
          case 'list':
            return verb === 'present' ? 'List' : verb === 'past' ? 'Listed' : 'Listing'
        }
      }

      const shouldShowServerName = (currentState: ClientToolCallState) => {
        if (operation === 'list') {
          return false
        }
        if (operation === 'add') {
          return currentState === ClientToolCallState.success
        }
        return true
      }

      const nameText =
        operation === 'list'
          ? ' MCP servers'
          : shouldShowServerName(state) && serverName
            ? ` ${serverName}`
            : ' MCP tool'

      switch (state) {
        case ClientToolCallState.success:
          return `${getActionText('past')}${nameText}`
        case ClientToolCallState.executing:
          return `${getActionText('gerund')}${nameText}`
        case ClientToolCallState.generating:
          return `${getActionText('gerund')}${nameText}`
        case ClientToolCallState.pending:
          return `${getActionText('present')}${nameText}?`
        case ClientToolCallState.error:
          return `Failed to ${getActionText('present')?.toLowerCase()}${nameText}`
        case ClientToolCallState.aborted:
          return `Aborted ${getActionText('gerund')?.toLowerCase()}${nameText}`
        case ClientToolCallState.rejected:
          return `Skipped ${getActionText('gerund')?.toLowerCase()}${nameText}`
      }
      return undefined
    },
  }

  /**
   * Gets the tool call args from the copilot store (needed before execute() is called)
   */
  private getArgsFromStore(): ManageMcpToolArgs | undefined {
    try {
      const { toolCallsById } = getCopilotStoreForToolCall(this.toolCallId).getState()
      const toolCall = toolCallsById[this.toolCallId]
      return (toolCall as any)?.params as ManageMcpToolArgs | undefined
    } catch {
      return undefined
    }
  }

  /**
   * Require confirmation for any mutating operation.
   */
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const args = this.currentArgs || this.getArgsFromStore()
    const operation = args?.operation
    if (operation && operation !== 'list') {
      return this.metadata.interrupt
    }
    return undefined
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: ManageMcpToolArgs): Promise<void> {
    const logger = createLogger('ManageMcpToolClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      await this.executeOperation(args, logger)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to manage MCP tool')
    }
  }

  async execute(args?: ManageMcpToolArgs): Promise<void> {
    this.currentArgs = args
    if (args?.operation === 'list') {
      await this.handleAccept(args)
    }
  }

  /**
   * Executes the MCP tool operation (add, edit, or delete)
   */
  private async executeOperation(
    args: ManageMcpToolArgs | undefined,
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    if (!args?.operation) {
      throw new Error('Operation is required')
    }

    const { operation, serverId, config } = args

    const { workflowId: activeWorkflowId } = this.requireExecutionContext()
    const registryState = useWorkflowRegistry.getState()
    const workspaceId = registryState.workflows[activeWorkflowId]?.workspaceId
    if (!workspaceId) {
      throw new Error('No active workspace found')
    }

    logger.info(`Executing MCP tool operation: ${operation}`, {
      operation,
      serverId,
      serverName: config?.name,
      workspaceId,
    })

    switch (operation) {
      case 'list':
        await this.listMcpServers(workspaceId, logger)
        break
      case 'add':
        await this.addMcpServer({ config, workspaceId }, logger)
        break
      case 'edit':
        await this.editMcpServer({ serverId, config, workspaceId }, logger)
        break
      case 'delete':
        await this.deleteMcpServer({ serverId, workspaceId }, logger)
        break
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  /**
   * Creates a new MCP server
   */
  private async addMcpServer(
    params: {
      config?: McpServerConfig
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { config, workspaceId } = params

    if (!config) {
      throw new Error('Config is required for adding an MCP server')
    }
    if (!config.name) {
      throw new Error('Server name is required')
    }
    if (!config.url) {
      throw new Error('Server URL is required for streamable-http transport')
    }

    const serverData = {
      ...config,
      workspaceId,
      transport: config.transport || 'streamable-http',
      timeout: config.timeout || 30000,
      enabled: config.enabled !== false,
    }

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverData),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create MCP tool')
    }

    const serverId = data.data?.serverId
    logger.info(`Created MCP tool: ${config.name}`, { serverId })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Created MCP tool "${config.name}"`, {
      success: true,
      operation: 'add',
      serverId,
      name: config.name,
      serverName: config.name,
    })
  }

  /**
   * Updates an existing MCP server
   */
  private async editMcpServer(
    params: {
      serverId?: string
      config?: McpServerConfig
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { serverId, config, workspaceId } = params

    if (!serverId) {
      throw new Error('Server ID is required for editing an MCP server')
    }

    if (!config) {
      throw new Error('Config is required for editing an MCP server')
    }

    const updateData = {
      ...config,
      workspaceId,
    }

    const response = await fetch(`${API_ENDPOINT}/${serverId}?workspaceId=${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update MCP tool')
    }

    const serverName = config.name || data.data?.server?.name || serverId
    logger.info(`Updated MCP tool: ${serverName}`, { serverId })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Updated MCP tool "${serverName}"`, {
      success: true,
      operation: 'edit',
      serverId,
      name: serverName,
      serverName,
    })
  }

  /**
   * Deletes an MCP server
   */
  private async deleteMcpServer(
    params: {
      serverId?: string
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { serverId, workspaceId } = params

    if (!serverId) {
      throw new Error('Server ID is required for deleting an MCP server')
    }

    const url = `${API_ENDPOINT}?serverId=${serverId}&workspaceId=${workspaceId}`
    const response = await fetch(url, {
      method: 'DELETE',
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete MCP tool')
    }

    logger.info(`Deleted MCP tool: ${serverId}`)

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Deleted MCP tool`, {
      success: true,
      operation: 'delete',
      serverId,
    })
  }

  private async listMcpServers(
    workspaceId: string,
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch MCP servers')
    }

    const servers = Array.isArray(data.data?.servers) ? data.data.servers : []

    logger.info(`Listed MCP servers for workspace ${workspaceId}`, { count: servers.length })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Found ${servers.length} MCP server(s)`, {
      success: true,
      operation: 'list',
      servers,
      count: servers.length,
    })
  }
}
