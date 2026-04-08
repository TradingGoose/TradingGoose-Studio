import { Check, Loader2, Server, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { getEntityFields, setEntityField } from '@/lib/yjs/entity-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  createEntityDynamicText,
  createEntityToolExecutor,
  requireActiveEntitySession,
  type EntityToolArgs,
} from '@/lib/copilot/tools/client/workflow/entity-review-tool-utils'
import { ENTITY_KIND_MCP_SERVER } from '@/lib/copilot/review-sessions/types'

interface McpServerConfig {
  name?: string
  description?: string | null
  transport?: 'http' | 'sse' | 'streamable-http'
  url?: string
  headers?: Record<string, string>
  command?: string | null
  args?: string[]
  env?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
}

interface ManageMcpToolArgs extends EntityToolArgs {
  serverId?: string
  config?: McpServerConfig
}

const API_ENDPOINT = '/api/mcp/servers'

export class ManageMcpToolClientTool extends BaseClientTool {
  static readonly id = 'manage_mcp_tool'
  private currentArgs?: ManageMcpToolArgs

  private readonly orchestration = createEntityToolExecutor<ManageMcpToolArgs>({
    entityLabel: 'MCP tool',
    loggerName: 'ManageMcpToolClientTool',
    getLogDetails: (args) => ({
      serverId: args.serverId,
      serverName: args.config?.name,
    }),
    list: (workspaceId) => this.listMcpServers(workspaceId),
    add: (args) => this.addMcpServer(args),
    edit: (args) => this.editMcpServer(args),
  })

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
    getDynamicText: createEntityDynamicText({
      entityNoun: 'MCP tool',
      entityNounPlural: 'MCP servers',
      nameExtractor: (params) => params?.config?.name || params?.name || params?.serverName,
      addVerbs: { present: 'Add', past: 'Added', gerund: 'Adding' },
    }),
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    return this.orchestration.getInterruptDisplays(
      this.currentArgs,
      this.toolCallId,
      this.metadata
    )
  }

  async handleAccept(args?: ManageMcpToolArgs): Promise<void> {
    await this.orchestration.handleAccept(this, args, this.requireExecutionContext())
  }

  async execute(args?: ManageMcpToolArgs): Promise<void> {
    this.currentArgs = args
    if (args?.operation === 'list') {
      await this.handleAccept(args)
    }
  }

  private async listMcpServers(workspaceId: string): Promise<void> {
    const response = await fetch(`${API_ENDPOINT}?workspaceId=${encodeURIComponent(workspaceId)}`)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data?.error || `Failed to list MCP servers: ${response.status}`)
    }

    const servers = Array.isArray(data?.data?.servers) ? data.data.servers : []
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'list',
        servers,
        count: servers.length,
      },
    })
    await this.markToolComplete(200, 'Listed MCP servers', {
      success: true,
      operation: 'list',
      servers,
      count: servers.length,
      workspaceId,
    })
  }

  private async addMcpServer(args: ManageMcpToolArgs): Promise<void> {
    const config = args.config
    if (!config?.name) {
      throw new Error('Server name is required')
    }

    const session = requireActiveEntitySession(this.requireExecutionContext(), ENTITY_KIND_MCP_SERVER)
    session.doc.transact(() => {
      setEntityField(session.doc, 'name', config.name)
      setEntityField(session.doc, 'description', config.description ?? '')
      setEntityField(session.doc, 'transport', config.transport ?? 'streamable-http')
      setEntityField(session.doc, 'url', config.url ?? '')
      setEntityField(session.doc, 'headers', config.headers ?? {})
      setEntityField(session.doc, 'command', config.command ?? '')
      setEntityField(session.doc, 'args', config.args ?? [])
      setEntityField(session.doc, 'env', config.env ?? {})
      setEntityField(session.doc, 'timeout', config.timeout ?? 30000)
      setEntityField(session.doc, 'retries', config.retries ?? 3)
      setEntityField(session.doc, 'enabled', config.enabled ?? true)
    }, YJS_ORIGINS.COPILOT_TOOL)

    const nextFields = getEntityFields(session.doc, ENTITY_KIND_MCP_SERVER)
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'add',
        serverId: session.descriptor.entityId ?? undefined,
        name: nextFields.name,
        serverName: nextFields.name,
      },
    })
    await this.markToolComplete(200, `Updated MCP draft "${nextFields.name}"`, {
      success: true,
      operation: 'add',
      serverId: session.descriptor.entityId ?? undefined,
      name: nextFields.name,
      serverName: nextFields.name,
      reviewSessionId: session.descriptor.reviewSessionId,
      draftSessionId: session.descriptor.draftSessionId,
    })
  }

  private async editMcpServer(args: ManageMcpToolArgs): Promise<void> {
    const config = args.config
    if (!config) {
      throw new Error('Config is required for edit')
    }

    const session = requireActiveEntitySession(this.requireExecutionContext(), ENTITY_KIND_MCP_SERVER)
    session.doc.transact(() => {
      if (config.name !== undefined) setEntityField(session.doc, 'name', config.name)
      if (config.description !== undefined) {
        setEntityField(session.doc, 'description', config.description ?? '')
      }
      if (config.transport !== undefined) setEntityField(session.doc, 'transport', config.transport)
      if (config.url !== undefined) setEntityField(session.doc, 'url', config.url)
      if (config.headers !== undefined) setEntityField(session.doc, 'headers', config.headers)
      if (config.command !== undefined) setEntityField(session.doc, 'command', config.command ?? '')
      if (config.args !== undefined) setEntityField(session.doc, 'args', config.args)
      if (config.env !== undefined) setEntityField(session.doc, 'env', config.env)
      if (config.timeout !== undefined) setEntityField(session.doc, 'timeout', config.timeout)
      if (config.retries !== undefined) setEntityField(session.doc, 'retries', config.retries)
      if (config.enabled !== undefined) setEntityField(session.doc, 'enabled', config.enabled)
    }, YJS_ORIGINS.COPILOT_TOOL)

    const nextFields = getEntityFields(session.doc, ENTITY_KIND_MCP_SERVER)
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'edit',
        serverId: session.descriptor.entityId ?? undefined,
        name: nextFields.name,
        serverName: nextFields.name,
      },
    })
    await this.markToolComplete(200, `Updated MCP server "${nextFields.name}"`, {
      success: true,
      operation: 'edit',
      serverId: session.descriptor.entityId ?? undefined,
      name: nextFields.name,
      serverName: nextFields.name,
      reviewSessionId: session.descriptor.reviewSessionId,
      draftSessionId: session.descriptor.draftSessionId,
    })
  }
}
