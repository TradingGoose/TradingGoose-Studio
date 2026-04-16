import { BarChart3, BookOpen, Check, Code2, FileJson, Loader2, Server, X, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  getEntityDocumentFormat,
  getEntityDocumentName,
  parseEntityDocument,
  serializeEntityDocument,
  type EntityDocumentKind,
} from '@/lib/copilot/entity-documents'
import {
  ENTITY_KIND_CUSTOM_TOOL,
  ENTITY_KIND_INDICATOR,
  ENTITY_KIND_MCP_SERVER,
  ENTITY_KIND_SKILL,
} from '@/lib/copilot/review-sessions/types'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  applyEntityFieldsToSession,
  getActiveEntitySession,
  listCanonicalEntityEntries,
  readEntityFieldsFromContext,
  resolveWorkspaceIdFromExecutionContext,
} from '@/lib/copilot/tools/client/entities/entity-document-tool-utils'
import { getEntityFields } from '@/lib/yjs/entity-session'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'

type EntityToolConfig = {
  kind: EntityDocumentKind
  singularLabel: string
  pluralLabel: string
  icon: LucideIcon
}

type ReadEntityDocumentArgs = {
  entityId?: string
}

type EditEntityDocumentArgs = ReadEntityDocumentArgs & {
  entityDocument: string
  documentFormat?: string
}

function readStoredToolArgs<TArgs>(toolCallId: string): TArgs | undefined {
  try {
    const { toolCallsById } = getCopilotStoreForToolCall(toolCallId).getState()
    return toolCallsById[toolCallId]?.params as TArgs | undefined
  } catch {
    return undefined
  }
}

function createListMetadata(config: EntityToolConfig): BaseClientToolMetadata {
  return {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: `Listing ${config.pluralLabel}`,
        icon: Loader2,
      },
      [ClientToolCallState.pending]: {
        text: `List ${config.pluralLabel}`,
        icon: config.icon,
      },
      [ClientToolCallState.executing]: {
        text: `Listing ${config.pluralLabel}`,
        icon: Loader2,
      },
      [ClientToolCallState.success]: {
        text: `Listed ${config.pluralLabel}`,
        icon: config.icon,
      },
      [ClientToolCallState.error]: {
        text: `Failed to list ${config.pluralLabel}`,
        icon: X,
      },
      [ClientToolCallState.aborted]: {
        text: `Aborted listing ${config.pluralLabel}`,
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: `Skipped listing ${config.pluralLabel}`,
        icon: XCircle,
      },
    },
  }
}

function createReadMetadata(config: EntityToolConfig): BaseClientToolMetadata {
  return {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: `Reading ${config.singularLabel} document`,
        icon: Loader2,
      },
      [ClientToolCallState.pending]: {
        text: `Read ${config.singularLabel} document`,
        icon: FileJson,
      },
      [ClientToolCallState.executing]: {
        text: `Reading ${config.singularLabel} document`,
        icon: Loader2,
      },
      [ClientToolCallState.success]: {
        text: `Read ${config.singularLabel} document`,
        icon: FileJson,
      },
      [ClientToolCallState.error]: {
        text: `Failed to read ${config.singularLabel} document`,
        icon: X,
      },
      [ClientToolCallState.aborted]: {
        text: `Aborted reading ${config.singularLabel} document`,
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: `Skipped reading ${config.singularLabel} document`,
        icon: XCircle,
      },
    },
  }
}

function createEditMetadata(config: EntityToolConfig): BaseClientToolMetadata {
  return {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: `Editing ${config.singularLabel} document`,
        icon: Loader2,
      },
      [ClientToolCallState.pending]: {
        text: `Edit ${config.singularLabel} document?`,
        icon: config.icon,
      },
      [ClientToolCallState.executing]: {
        text: `Editing ${config.singularLabel} document`,
        icon: Loader2,
      },
      [ClientToolCallState.success]: {
        text: `Edited ${config.singularLabel} document`,
        icon: Check,
      },
      [ClientToolCallState.error]: {
        text: `Failed to edit ${config.singularLabel} document`,
        icon: X,
      },
      [ClientToolCallState.aborted]: {
        text: `Aborted editing ${config.singularLabel} document`,
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: `Skipped editing ${config.singularLabel} document`,
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
  }
}

function createListEntityTool(toolId: string, config: EntityToolConfig) {
  return class ListEntityClientTool extends BaseClientTool {
    static readonly id = toolId
    static readonly metadata = createListMetadata(config)

    constructor(toolCallId: string) {
      super(toolCallId, toolId, ListEntityClientTool.metadata)
    }

    async execute(): Promise<void> {
      try {
        this.setState(ClientToolCallState.executing)
        const executionContext = this.requireExecutionContext()
        const workspaceId = resolveWorkspaceIdFromExecutionContext(executionContext)
        const entities = await listCanonicalEntityEntries(config.kind, workspaceId)

        await this.markToolComplete(200, `Listed ${config.pluralLabel}`, {
          entityKind: config.kind,
          entities,
          count: entities.length,
        })
        this.setState(ClientToolCallState.success)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.markToolComplete(500, message)
        this.setState(ClientToolCallState.error)
      }
    }
  }
}

function createGetEntityDocumentTool(toolId: string, config: EntityToolConfig) {
  return class GetEntityDocumentClientTool extends BaseClientTool {
    static readonly id = toolId
    static readonly metadata = createReadMetadata(config)

    constructor(toolCallId: string) {
      super(toolCallId, toolId, GetEntityDocumentClientTool.metadata)
    }

    async execute(args?: ReadEntityDocumentArgs): Promise<void> {
      try {
        this.setState(ClientToolCallState.executing)
        const executionContext = this.requireExecutionContext()

        const { entityId, entityName, fields } = await readEntityFieldsFromContext(
          executionContext,
          config.kind,
          args?.entityId
        )

        await this.markToolComplete(200, `${config.singularLabel} document ready`, {
          entityKind: config.kind,
          entityId,
          entityName,
          documentFormat: getEntityDocumentFormat(config.kind),
          entityDocument: serializeEntityDocument(config.kind, fields),
        })
        this.setState(ClientToolCallState.success)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.markToolComplete(500, message)
        this.setState(ClientToolCallState.error)
      }
    }
  }
}

function createEditEntityDocumentTool(toolId: string, config: EntityToolConfig) {
  return class EditEntityDocumentClientTool extends BaseClientTool {
    static readonly id = toolId
    static readonly metadata = createEditMetadata(config)
    private currentArgs?: EditEntityDocumentArgs

    constructor(toolCallId: string) {
      super(toolCallId, toolId, EditEntityDocumentClientTool.metadata)
    }

    getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
      const args = this.currentArgs || readStoredToolArgs<EditEntityDocumentArgs>(this.toolCallId)
      return args?.entityDocument ? this.metadata.interrupt : undefined
    }

    async execute(args?: EditEntityDocumentArgs): Promise<void> {
      this.currentArgs = args
    }

    async handleAccept(args?: EditEntityDocumentArgs): Promise<void> {
      try {
        this.setState(ClientToolCallState.executing)

        const resolvedArgs =
          args || this.currentArgs || readStoredToolArgs<EditEntityDocumentArgs>(this.toolCallId)

        if (!resolvedArgs?.entityDocument?.trim()) {
          throw new Error('entityDocument is required')
        }

        if (
          resolvedArgs.documentFormat &&
          resolvedArgs.documentFormat !== getEntityDocumentFormat(config.kind)
        ) {
          throw new Error(
            `Unsupported documentFormat "${resolvedArgs.documentFormat}". Expected ${getEntityDocumentFormat(config.kind)}`
          )
        }

        const executionContext = this.requireExecutionContext()
        const entityId = resolvedArgs.entityId?.trim()
        const session = getActiveEntitySession(executionContext, config.kind, entityId)

        if (!session) {
          if (!entityId) {
            throw new Error(
              `entityId is required to edit a saved ${config.singularLabel}; unsaved drafts require an active review session`
            )
          }

          throw new Error(
            `No active ${config.singularLabel} review session found for ${entityId}. Open the ${config.singularLabel} review before editing.`
          )
        }

        const nextFields = parseEntityDocument(config.kind, resolvedArgs.entityDocument)
        applyEntityFieldsToSession(session, config.kind, nextFields)
        const persistedFields = getEntityFields(session.doc, config.kind)
        const entityName = getEntityDocumentName(config.kind, persistedFields)

        await this.markToolComplete(200, `${config.singularLabel} document updated`, {
          success: true,
          entityKind: config.kind,
          ...(session.descriptor.entityId ?? entityId
            ? { entityId: session.descriptor.entityId ?? entityId }
            : {}),
          entityName,
          documentFormat: getEntityDocumentFormat(config.kind),
          entityDocument: serializeEntityDocument(config.kind, persistedFields),
          reviewSessionId: session.descriptor.reviewSessionId,
          draftSessionId: session.descriptor.draftSessionId,
        })
        this.setState(ClientToolCallState.success)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.markToolComplete(500, message)
        this.setState(ClientToolCallState.error)
      }
    }
  }
}

const skillToolConfig: EntityToolConfig = {
  kind: ENTITY_KIND_SKILL,
  singularLabel: 'skill',
  pluralLabel: 'skills',
  icon: BookOpen,
}

const customToolConfig: EntityToolConfig = {
  kind: ENTITY_KIND_CUSTOM_TOOL,
  singularLabel: 'custom tool',
  pluralLabel: 'custom tools',
  icon: Code2,
}

const indicatorToolConfig: EntityToolConfig = {
  kind: ENTITY_KIND_INDICATOR,
  singularLabel: 'indicator',
  pluralLabel: 'indicators',
  icon: BarChart3,
}

const mcpServerToolConfig: EntityToolConfig = {
  kind: ENTITY_KIND_MCP_SERVER,
  singularLabel: 'MCP server',
  pluralLabel: 'MCP servers',
  icon: Server,
}

export const ListSkillsClientTool = createListEntityTool('list_skills', skillToolConfig)
export const GetSkillClientTool = createGetEntityDocumentTool(
  'get_skill',
  skillToolConfig
)
export const EditSkillClientTool = createEditEntityDocumentTool(
  'edit_skill',
  skillToolConfig
)

export const ListCustomToolsClientTool = createListEntityTool(
  'list_custom_tools',
  customToolConfig
)
export const GetCustomToolClientTool = createGetEntityDocumentTool(
  'get_custom_tool',
  customToolConfig
)
export const EditCustomToolClientTool = createEditEntityDocumentTool(
  'edit_custom_tool',
  customToolConfig
)

export const ListIndicatorsClientTool = createListEntityTool(
  'list_indicators',
  indicatorToolConfig
)
export const GetIndicatorClientTool = createGetEntityDocumentTool(
  'get_indicator',
  indicatorToolConfig
)
export const EditIndicatorClientTool = createEditEntityDocumentTool(
  'edit_indicator',
  indicatorToolConfig
)

export const ListMcpServersClientTool = createListEntityTool(
  'list_mcp_servers',
  mcpServerToolConfig
)
export const GetMcpServerClientTool = createGetEntityDocumentTool(
  'get_mcp_server',
  mcpServerToolConfig
)
export const EditMcpServerClientTool = createEditEntityDocumentTool(
  'edit_mcp_server',
  mcpServerToolConfig
)
