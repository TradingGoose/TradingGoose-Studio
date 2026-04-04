import { BarChart3, Check, Loader2, X, XCircle } from 'lucide-react'
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
import { ENTITY_KIND_INDICATOR } from '@/lib/copilot/review-sessions/types'

interface ManageIndicatorArgs extends EntityToolArgs {
  indicatorId?: string
  name?: string
  color?: string
  pineCode?: string
  inputMeta?: Record<string, unknown>
}

const API_ENDPOINT = '/api/indicators/custom'

export class ManageIndicatorClientTool extends BaseClientTool {
  static readonly id = 'manage_indicator'
  private currentArgs?: ManageIndicatorArgs

  private readonly orchestration = createEntityToolExecutor<ManageIndicatorArgs>({
    entityLabel: 'indicator',
    loggerName: 'ManageIndicatorClientTool',
    getLogDetails: (args) => ({
      indicatorId: args.indicatorId,
      name: args.name,
    }),
    list: (workspaceId) => this.listIndicators(workspaceId),
    add: (args) => this.addIndicator(args),
    edit: (args) => this.editIndicator(args),
  })

  constructor(toolCallId: string) {
    super(toolCallId, ManageIndicatorClientTool.id, ManageIndicatorClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Managing indicator',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Manage indicator?', icon: BarChart3 },
      [ClientToolCallState.executing]: { text: 'Managing indicator', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed indicator', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to manage indicator', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted managing indicator',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped managing indicator',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: createEntityDynamicText({
      entityNoun: 'indicator',
      entityNounPlural: 'indicators',
      nameExtractor: (params) => params?.name,
      addVerbs: { present: 'Add', past: 'Added', gerund: 'Adding' },
    }),
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: ManageIndicatorArgs): Promise<void> {
    const resolvedArgs = args ?? this.currentArgs
    await this.orchestration.handleAccept(this, resolvedArgs, this.requireExecutionContext())
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    return this.orchestration.getInterruptDisplays(
      this.currentArgs,
      this.toolCallId,
      this.metadata
    )
  }

  async execute(args?: ManageIndicatorArgs): Promise<void> {
    this.currentArgs = args
    if (args?.operation === 'list') {
      await this.handleAccept(args)
    }
  }

  private async listIndicators(workspaceId: string): Promise<void> {
    const response = await fetch(`${API_ENDPOINT}?workspaceId=${encodeURIComponent(workspaceId)}`)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data?.error || `Failed to list indicators: ${response.status}`)
    }

    const indicators = Array.isArray(data?.data) ? data.data : []
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'list',
        indicators,
        count: indicators.length,
      },
    })
    await this.markToolComplete(200, 'Listed indicators', {
      success: true,
      operation: 'list',
      indicators,
      count: indicators.length,
      workspaceId,
    })
  }

  private async addIndicator(args: ManageIndicatorArgs): Promise<void> {
    const pineCode = args.pineCode
    if (!args.name) {
      throw new Error('Indicator name is required')
    }
    if (!pineCode) {
      throw new Error('Indicator code is required')
    }

    const session = requireActiveEntitySession(this.requireExecutionContext(), ENTITY_KIND_INDICATOR)
    session.doc.transact(() => {
      setEntityField(session.doc, 'name', args.name)
      if (args.color !== undefined) {
        setEntityField(session.doc, 'color', args.color)
      }
      replaceEntityTextField(session.doc, 'pineCode', pineCode)
      if (args.inputMeta !== undefined) {
        setEntityField(session.doc, 'inputMeta', args.inputMeta)
      }
    }, YJS_ORIGINS.COPILOT_TOOL)

    const nextFields = getEntityFields(session.doc, ENTITY_KIND_INDICATOR)
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'add',
        indicatorId: session.descriptor.entityId ?? undefined,
        name: nextFields.name,
      },
    })
    await this.markToolComplete(200, `Updated indicator draft "${nextFields.name}"`, {
      success: true,
      operation: 'add',
      indicatorId: session.descriptor.entityId ?? undefined,
      name: nextFields.name,
      reviewSessionId: session.descriptor.reviewSessionId,
      draftSessionId: session.descriptor.draftSessionId,
    })
  }

  private async editIndicator(args: ManageIndicatorArgs): Promise<void> {
    const session = requireActiveEntitySession(this.requireExecutionContext(), ENTITY_KIND_INDICATOR)
    session.doc.transact(() => {
      if (args.name !== undefined) {
        setEntityField(session.doc, 'name', args.name)
      }
      if (args.color !== undefined) {
        setEntityField(session.doc, 'color', args.color)
      }
      if (args.pineCode !== undefined) {
        replaceEntityTextField(session.doc, 'pineCode', args.pineCode)
      }
      if (args.inputMeta !== undefined) {
        setEntityField(session.doc, 'inputMeta', args.inputMeta)
      }
    }, YJS_ORIGINS.COPILOT_TOOL)

    const nextFields = getEntityFields(session.doc, ENTITY_KIND_INDICATOR)
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'edit',
        indicatorId: session.descriptor.entityId ?? undefined,
        name: nextFields.name,
      },
    })
    await this.markToolComplete(200, `Updated indicator "${nextFields.name}"`, {
      success: true,
      operation: 'edit',
      indicatorId: session.descriptor.entityId ?? undefined,
      name: nextFields.name,
      reviewSessionId: session.descriptor.reviewSessionId,
      draftSessionId: session.descriptor.draftSessionId,
    })
  }
}
