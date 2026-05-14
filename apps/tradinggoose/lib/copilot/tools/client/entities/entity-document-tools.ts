import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpen,
  Check,
  Code2,
  FileJson,
  Loader2,
  Server,
  X,
  XCircle,
} from 'lucide-react'
import {
  type EntityDocumentKind,
  getEntityDocumentFormat,
  getEntityDocumentName,
  parseEntityDocument,
  serializeEntityDocument,
} from '@/lib/copilot/entity-documents'
import { CopilotTool } from '@/lib/copilot/registry'
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
  type EntityReadTarget,
  createCanonicalEntityFromFields,
  listCanonicalEntityEntries,
  listCopilotIndicators,
  readEntityFieldsFromContext,
  resolveCopilotEntityYjsSessionLease,
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

type ReadEntityDocumentArgs = EntityReadTarget

type EditEntityDocumentArgs = ReadEntityDocumentArgs & {
  entityDocument: string
  documentFormat?: string
}

type EntityMutationAction = 'create' | 'edit' | 'rename'

function readStoredToolArgs<TArgs>(toolCallId: string): TArgs | undefined {
  try {
    const { toolCallsById } = getCopilotStoreForToolCall(toolCallId).getState()
    return toolCallsById[toolCallId]?.params as TArgs | undefined
  } catch {
    return undefined
  }
}

function buildEntityDocumentDiff(
  kind: EntityDocumentKind,
  currentFields: Record<string, unknown>,
  nextFields: Record<string, unknown>
): { before: string; after: string } {
  return {
    before: serializeEntityDocument(kind, currentFields),
    after: serializeEntityDocument(kind, nextFields),
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

function createMutationMetadata(
  config: EntityToolConfig,
  action: EntityMutationAction
): BaseClientToolMetadata {
  const actionLabels =
    action === 'create'
      ? {
          gerund: 'Creating',
          prompt: 'Create',
          past: 'Created',
          error: 'create',
          aborted: 'creating',
        }
      : action === 'rename'
        ? {
            gerund: 'Renaming',
            prompt: 'Rename',
            past: 'Renamed',
            error: 'rename',
            aborted: 'renaming',
          }
        : {
            gerund: 'Editing',
            prompt: 'Edit',
            past: 'Edited',
            error: 'edit',
            aborted: 'editing',
          }

  return {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: `${actionLabels.gerund} ${config.singularLabel} document`,
        icon: Loader2,
      },
      [ClientToolCallState.pending]: {
        text: `${actionLabels.prompt} ${config.singularLabel} document?`,
        icon: config.icon,
      },
      [ClientToolCallState.executing]: {
        text: `${actionLabels.gerund} ${config.singularLabel} document`,
        icon: Loader2,
      },
      [ClientToolCallState.review]: {
        text: `Review your ${config.singularLabel} changes`,
        icon: config.icon,
      },
      [ClientToolCallState.success]: {
        text: `${actionLabels.past} ${config.singularLabel} document`,
        icon: Check,
      },
      [ClientToolCallState.error]: {
        text: `Failed to ${actionLabels.error} ${config.singularLabel} document`,
        icon: X,
      },
      [ClientToolCallState.aborted]: {
        text: `Aborted ${actionLabels.aborted} ${config.singularLabel} document`,
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: `Skipped ${actionLabels.aborted} ${config.singularLabel} document`,
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Accept changes', icon: Check },
      reject: { text: 'Reject changes', icon: XCircle },
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

function createReadEntityDocumentTool(toolId: string, config: EntityToolConfig) {
  return class ReadEntityDocumentClientTool extends BaseClientTool {
    static readonly id = toolId
    static readonly metadata = createReadMetadata(config)

    constructor(toolCallId: string) {
      super(toolCallId, toolId, ReadEntityDocumentClientTool.metadata)
    }

    async execute(args?: ReadEntityDocumentArgs): Promise<void> {
      try {
        this.setState(ClientToolCallState.executing)
        const executionContext = this.requireExecutionContext()

        const { entityId, entityName, fields } = await readEntityFieldsFromContext(
          executionContext,
          config.kind,
          args
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

function createEntityDocumentMutationTool(
  toolId: string,
  config: EntityToolConfig,
  action: EntityMutationAction
) {
  return class EditEntityDocumentClientTool extends BaseClientTool {
    static readonly id = toolId
    static readonly metadata = createMutationMetadata(config, action)
    private currentArgs?: EditEntityDocumentArgs
    private lastResult?: Record<string, any>

    constructor(toolCallId: string) {
      super(toolCallId, toolId, EditEntityDocumentClientTool.metadata)
    }

    getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
      return this.getState() === ClientToolCallState.review ? this.metadata.interrupt : undefined
    }

    async execute(args?: EditEntityDocumentArgs): Promise<void> {
      try {
        this.currentArgs = args
        this.setState(ClientToolCallState.executing)
        const executionContext = this.requireExecutionContext()
        const resolvedArgs = args || readStoredToolArgs<EditEntityDocumentArgs>(this.toolCallId)

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

        const entityId = resolvedArgs.entityId?.trim()
        if (action === 'create' && entityId) {
          throw new Error(`${toolId} does not accept entityId`)
        }
        const nextFields = parseEntityDocument(config.kind, resolvedArgs.entityDocument)
        let currentFields: Record<string, unknown> = {}
        let reviewSessionId: string | null | undefined
        let resolvedEntityId: string | null | undefined = entityId

        if (action !== 'create') {
          const lease = await resolveCopilotEntityYjsSessionLease(
            executionContext,
            config.kind,
            entityId
          )
          try {
            currentFields = getEntityFields(lease.session.doc, config.kind)
            reviewSessionId = lease.session.descriptor.reviewSessionId
            resolvedEntityId = lease.session.descriptor.entityId ?? entityId
          } finally {
            lease.release()
          }
        }

        this.lastResult = {
          success: false,
          entityKind: config.kind,
          ...(resolvedEntityId ? { entityId: resolvedEntityId } : {}),
          entityName: getEntityDocumentName(config.kind, nextFields),
          documentFormat: getEntityDocumentFormat(config.kind),
          entityDocument: serializeEntityDocument(config.kind, nextFields),
          ...(reviewSessionId ? { reviewSessionId } : {}),
          preview: {
            documentDiff: buildEntityDocumentDiff(config.kind, currentFields, nextFields),
          },
        }
        this.setState(ClientToolCallState.review, { result: this.lastResult })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.markToolComplete(500, message)
        this.setState(ClientToolCallState.error)
      }
    }

    protected async prepareReviewAccept(args?: Record<string, any>): Promise<boolean> {
      const stagedResult = this.lastResult ?? this.resolvePersistedResult()
      if (stagedResult?.entityDocument) {
        return true
      }

      await this.execute(args as EditEntityDocumentArgs | undefined)
      return this.resolveUserActionState() === ClientToolCallState.review
    }

    async handleAccept(args?: EditEntityDocumentArgs): Promise<void> {
      try {
        this.setState(ClientToolCallState.executing)

        let stagedResult = this.lastResult ?? this.resolvePersistedResult<Record<string, any>>()
        if (!stagedResult?.entityDocument) {
          await this.execute(args)
          stagedResult = this.lastResult ?? this.resolvePersistedResult<Record<string, any>>()
        }

        if (!stagedResult?.entityDocument?.trim()) {
          throw new Error('entityDocument is required')
        }

        const executionContext = this.requireExecutionContext()
        const entityId =
          (typeof stagedResult.entityId === 'string' ? stagedResult.entityId.trim() : '') ||
          args?.entityId?.trim() ||
          this.currentArgs?.entityId?.trim()
        const nextFields = parseEntityDocument(config.kind, stagedResult.entityDocument)

        if (action === 'create') {
          if (entityId) {
            throw new Error(`${toolId} does not accept entityId`)
          }

          const workspaceId = resolveWorkspaceIdFromExecutionContext(executionContext)
          const created = await createCanonicalEntityFromFields(
            config.kind,
            workspaceId,
            nextFields
          )

          await this.markToolComplete(200, `${config.singularLabel} document created`, {
            success: true,
            entityKind: config.kind,
            entityId: created.entityId,
            entityName: created.entityName,
            documentFormat: getEntityDocumentFormat(config.kind),
            entityDocument: serializeEntityDocument(config.kind, created.fields),
            preview: stagedResult.preview,
          })
          this.setState(ClientToolCallState.success)
          return
        }

        const lease = await resolveCopilotEntityYjsSessionLease(
          executionContext,
          config.kind,
          entityId
        )
        try {
          applyEntityFieldsToSession(lease.session, config.kind, nextFields)
          const persistedFields = getEntityFields(lease.session.doc, config.kind)
          const entityName = getEntityDocumentName(config.kind, persistedFields)
          const descriptor = lease.session.descriptor

          await this.markToolComplete(200, `${config.singularLabel} document updated`, {
            success: true,
            entityKind: config.kind,
            ...((descriptor.entityId ?? entityId)
              ? { entityId: descriptor.entityId ?? entityId }
              : {}),
            entityName,
            documentFormat: getEntityDocumentFormat(config.kind),
            entityDocument: serializeEntityDocument(config.kind, persistedFields),
            reviewSessionId: descriptor.reviewSessionId,
            preview: stagedResult.preview,
          })
        } finally {
          lease.release()
        }
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
export const ReadSkillClientTool = createReadEntityDocumentTool(
  CopilotTool.read_skill,
  skillToolConfig
)
export const CreateSkillClientTool = createEntityDocumentMutationTool(
  'create_skill',
  skillToolConfig,
  'create'
)
export const EditSkillClientTool = createEntityDocumentMutationTool(
  'edit_skill',
  skillToolConfig,
  'edit'
)
export const RenameSkillClientTool = createEntityDocumentMutationTool(
  'rename_skill',
  skillToolConfig,
  'rename'
)

export const ListCustomToolsClientTool = createListEntityTool('list_custom_tools', customToolConfig)
export const ReadCustomToolClientTool = createReadEntityDocumentTool(
  CopilotTool.read_custom_tool,
  customToolConfig
)
export const CreateCustomToolClientTool = createEntityDocumentMutationTool(
  'create_custom_tool',
  customToolConfig,
  'create'
)
export const EditCustomToolClientTool = createEntityDocumentMutationTool(
  'edit_custom_tool',
  customToolConfig,
  'edit'
)
export const RenameCustomToolClientTool = createEntityDocumentMutationTool(
  'rename_custom_tool',
  customToolConfig,
  'rename'
)

export class ListIndicatorsClientTool extends BaseClientTool {
  static readonly id = CopilotTool.list_indicators
  static readonly metadata = createListMetadata(indicatorToolConfig)

  constructor(toolCallId: string) {
    super(toolCallId, ListIndicatorsClientTool.id, ListIndicatorsClientTool.metadata)
  }

  async execute(): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()
      const workspaceId = resolveWorkspaceIdFromExecutionContext(executionContext)
      const indicators = await listCopilotIndicators(workspaceId)

      await this.markToolComplete(200, 'Listed indicators', {
        entityKind: 'indicator',
        indicators,
        count: indicators.length,
      })
      this.setState(ClientToolCallState.success)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
export const ReadIndicatorClientTool = createReadEntityDocumentTool(
  CopilotTool.read_indicator,
  indicatorToolConfig
)
export const CreateIndicatorClientTool = createEntityDocumentMutationTool(
  'create_indicator',
  indicatorToolConfig,
  'create'
)
export const EditIndicatorClientTool = createEntityDocumentMutationTool(
  'edit_indicator',
  indicatorToolConfig,
  'edit'
)
export const RenameIndicatorClientTool = createEntityDocumentMutationTool(
  'rename_indicator',
  indicatorToolConfig,
  'rename'
)

export const ListMcpServersClientTool = createListEntityTool(
  'list_mcp_servers',
  mcpServerToolConfig
)
export const ReadMcpServerClientTool = createReadEntityDocumentTool(
  CopilotTool.read_mcp_server,
  mcpServerToolConfig
)
export const CreateMcpServerClientTool = createEntityDocumentMutationTool(
  'create_mcp_server',
  mcpServerToolConfig,
  'create'
)
export const EditMcpServerClientTool = createEntityDocumentMutationTool(
  'edit_mcp_server',
  mcpServerToolConfig,
  'edit'
)
export const RenameMcpServerClientTool = createEntityDocumentMutationTool(
  'rename_mcp_server',
  mcpServerToolConfig,
  'rename'
)
