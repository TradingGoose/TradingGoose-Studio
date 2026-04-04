import { Check, Loader2, Plus, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { getEntityFields, replaceEntityTextField, setEntityField } from '@/lib/yjs/entity-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  createEntityDynamicText,
  createEntityToolExecutor,
  requireActiveEntitySession,
  type EntityToolArgs,
} from '@/lib/copilot/tools/client/workflow/entity-review-tool-utils'
import { ENTITY_KIND_CUSTOM_TOOL } from '@/lib/copilot/review-sessions/types'

interface CustomToolSchema {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

interface ManageCustomToolArgs extends EntityToolArgs {
  toolId?: string
  title?: string
  schema?: CustomToolSchema
  code?: string
}

const API_ENDPOINT = '/api/tools/custom'

function formatSchema(schema: CustomToolSchema): string {
  return JSON.stringify(schema, null, 2)
}

function renameSchemaFunction(schemaText: string, title: string): string {
  try {
    const parsed = JSON.parse(schemaText) as CustomToolSchema
    parsed.function.name = title
    return formatSchema(parsed)
  } catch {
    return schemaText
  }
}

export class ManageCustomToolClientTool extends BaseClientTool {
  static readonly id = 'manage_custom_tool'
  private currentArgs?: ManageCustomToolArgs

  private readonly orchestration = createEntityToolExecutor<ManageCustomToolArgs>({
    entityLabel: 'custom tool',
    loggerName: 'ManageCustomToolClientTool',
    getLogDetails: (args) => ({
      toolId: args.toolId,
      title: args.title,
    }),
    list: (workspaceId) => this.listCustomTools(workspaceId),
    add: (args) => this.addCustomTool(args),
    edit: (args) => this.editCustomTool(args),
  })

  constructor(toolCallId: string) {
    super(toolCallId, ManageCustomToolClientTool.id, ManageCustomToolClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Managing custom tool',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Manage custom tool?', icon: Plus },
      [ClientToolCallState.executing]: { text: 'Managing custom tool', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed custom tool', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to manage custom tool', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted managing custom tool',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped managing custom tool',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: createEntityDynamicText({
      entityNoun: 'custom tool',
      entityNounPlural: 'custom tools',
      nameExtractor: (params) => params?.title || params?.schema?.function?.name,
    }),
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    return this.orchestration.getInterruptDisplays(
      this.currentArgs,
      this.toolCallId,
      this.metadata
    )
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: ManageCustomToolArgs): Promise<void> {
    await this.orchestration.handleAccept(this, args, this.requireExecutionContext())
  }

  async execute(args?: ManageCustomToolArgs): Promise<void> {
    this.currentArgs = args
    if (args?.operation === 'list') {
      await this.handleAccept(args)
    }
  }

  private async addCustomTool(args: ManageCustomToolArgs): Promise<void> {
    const schema = args.schema
    if (!schema) {
      throw new Error('Schema is required for adding a custom tool')
    }
    if (!args.code) {
      throw new Error('Code is required for adding a custom tool')
    }

    const session = requireActiveEntitySession(this.requireExecutionContext(), ENTITY_KIND_CUSTOM_TOOL)
    const nextTitle = args.title ?? schema.function.name
    session.doc.transact(() => {
      setEntityField(session.doc, 'title', nextTitle)
      replaceEntityTextField(session.doc, 'schemaText', formatSchema(schema))
      replaceEntityTextField(session.doc, 'codeText', args.code ?? '')
    }, YJS_ORIGINS.COPILOT_TOOL)

    const nextFields = getEntityFields(session.doc, ENTITY_KIND_CUSTOM_TOOL)
    const functionName = schema.function.name
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'add',
        toolId: session.descriptor.entityId ?? undefined,
        title: nextFields.title,
        functionName,
      },
    })
    await this.markToolComplete(200, `Updated custom tool draft "${nextFields.title}"`, {
      success: true,
      operation: 'add',
      toolId: session.descriptor.entityId ?? undefined,
      title: nextFields.title,
      functionName,
      reviewSessionId: session.descriptor.reviewSessionId,
      draftSessionId: session.descriptor.draftSessionId,
    })
  }

  private async editCustomTool(args: ManageCustomToolArgs): Promise<void> {
    const session = requireActiveEntitySession(this.requireExecutionContext(), ENTITY_KIND_CUSTOM_TOOL)
    const currentFields = getEntityFields(session.doc, ENTITY_KIND_CUSTOM_TOOL)
    const nextTitle = args.title ?? args.schema?.function.name ?? currentFields.title ?? ''
    const nextSchemaText = args.schema
      ? formatSchema(args.schema)
      : args.title
        ? renameSchemaFunction(currentFields.schemaText ?? '', args.title)
        : currentFields.schemaText

    session.doc.transact(() => {
      if (args.title !== undefined || args.schema !== undefined) {
        setEntityField(session.doc, 'title', nextTitle)
      }
      if (args.schema !== undefined || args.title !== undefined) {
        replaceEntityTextField(session.doc, 'schemaText', nextSchemaText ?? '')
      }
      if (args.code !== undefined) {
        replaceEntityTextField(session.doc, 'codeText', args.code)
      }
    }, YJS_ORIGINS.COPILOT_TOOL)

    const nextFields = getEntityFields(session.doc, ENTITY_KIND_CUSTOM_TOOL)
    let functionName = nextTitle
    try {
      functionName = (JSON.parse(nextFields.schemaText) as CustomToolSchema).function.name
    } catch {}

    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'edit',
        toolId: session.descriptor.entityId ?? undefined,
        title: nextFields.title,
        functionName,
      },
    })
    await this.markToolComplete(200, `Updated custom tool "${nextFields.title}"`, {
      success: true,
      operation: 'edit',
      toolId: session.descriptor.entityId ?? undefined,
      title: nextFields.title,
      functionName,
      reviewSessionId: session.descriptor.reviewSessionId,
      draftSessionId: session.descriptor.draftSessionId,
    })
  }

  private async listCustomTools(workspaceId: string): Promise<void> {
    const response = await fetch(`${API_ENDPOINT}?workspaceId=${encodeURIComponent(workspaceId)}`)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data?.error || `Failed to list custom tools: ${response.status}`)
    }

    const tools = Array.isArray(data?.data) ? data.data : []
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'list',
        tools,
        count: tools.length,
      },
    })
    await this.markToolComplete(200, 'Listed custom tools', {
      success: true,
      operation: 'list',
      tools,
      count: tools.length,
      workspaceId,
    })
  }
}
