import { BookOpen, Check, Loader2, X, XCircle } from 'lucide-react'
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
import { ENTITY_KIND_SKILL } from '@/lib/copilot/review-sessions/types'

interface ManageSkillArgs extends EntityToolArgs {
  skillId?: string
  name?: string
  description?: string
  content?: string
}

const API_ENDPOINT = '/api/skills'

export class ManageSkillClientTool extends BaseClientTool {
  static readonly id = 'manage_skill'
  private currentArgs?: ManageSkillArgs

  private readonly orchestration = createEntityToolExecutor<ManageSkillArgs>({
    entityLabel: 'skill',
    loggerName: 'ManageSkillClientTool',
    getLogDetails: (args) => ({
      skillId: args.skillId,
      name: args.name,
    }),
    list: (workspaceId) => this.listSkills(workspaceId),
    add: (args) => this.addSkill(args),
    edit: (args) => this.editSkill(args),
  })

  constructor(toolCallId: string) {
    super(toolCallId, ManageSkillClientTool.id, ManageSkillClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Managing skill',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Manage skill?', icon: BookOpen },
      [ClientToolCallState.executing]: { text: 'Managing skill', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed skill', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to manage skill', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted managing skill',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped managing skill',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: createEntityDynamicText({
      entityNoun: 'skill',
      entityNounPlural: 'skills',
      nameExtractor: (params) => params?.name,
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

  async handleAccept(args?: ManageSkillArgs): Promise<void> {
    await this.orchestration.handleAccept(this, args, this.requireExecutionContext())
  }

  async execute(args?: ManageSkillArgs): Promise<void> {
    this.currentArgs = args
    if (args?.operation === 'list') {
      await this.handleAccept(args)
    }
  }

  private async addSkill(args: ManageSkillArgs): Promise<void> {
    if (!args.name) {
      throw new Error('Name is required for adding a skill')
    }
    if (!args.description) {
      throw new Error('Description is required for adding a skill')
    }
    if (!args.content) {
      throw new Error('Content is required for adding a skill')
    }

    const executionContext = this.requireExecutionContext()
    const session = requireActiveEntitySession(executionContext, ENTITY_KIND_SKILL)
    session.doc.transact(() => {
      setEntityField(session.doc, 'name', args.name)
      setEntityField(session.doc, 'description', args.description)
      setEntityField(session.doc, 'content', args.content)
    }, YJS_ORIGINS.COPILOT_TOOL)

    const nextFields = getEntityFields(session.doc, ENTITY_KIND_SKILL)
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'add',
        skillId: session.descriptor.entityId ?? undefined,
        name: nextFields.name,
      },
    })
    await this.markToolComplete(200, `Updated skill draft "${nextFields.name}"`, {
      success: true,
      operation: 'add',
      skillId: session.descriptor.entityId ?? undefined,
      name: nextFields.name,
      reviewSessionId: session.descriptor.reviewSessionId,
      draftSessionId: session.descriptor.draftSessionId,
    })
  }

  private async editSkill(args: ManageSkillArgs): Promise<void> {
    const executionContext = this.requireExecutionContext()
    const session = requireActiveEntitySession(executionContext, ENTITY_KIND_SKILL)

    session.doc.transact(() => {
      if (args.name !== undefined) {
        setEntityField(session.doc, 'name', args.name)
      }
      if (args.description !== undefined) {
        setEntityField(session.doc, 'description', args.description)
      }
      if (args.content !== undefined) {
        setEntityField(session.doc, 'content', args.content)
      }
    }, YJS_ORIGINS.COPILOT_TOOL)

    const nextFields = getEntityFields(session.doc, ENTITY_KIND_SKILL)
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'edit',
        skillId: session.descriptor.entityId ?? undefined,
        name: nextFields.name,
      },
    })
    await this.markToolComplete(200, `Updated skill "${nextFields.name}"`, {
      success: true,
      operation: 'edit',
      skillId: session.descriptor.entityId ?? undefined,
      name: nextFields.name,
      reviewSessionId: session.descriptor.reviewSessionId,
      draftSessionId: session.descriptor.draftSessionId,
    })
  }

  private async listSkills(workspaceId: string): Promise<void> {
    const response = await fetch(`${API_ENDPOINT}?workspaceId=${encodeURIComponent(workspaceId)}`)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data?.error || `Failed to list skills: ${response.status}`)
    }

    const skills = Array.isArray(data?.data) ? data.data : []
    this.setState(ClientToolCallState.success, {
      result: {
        success: true,
        operation: 'list',
        skills,
        count: skills.length,
      },
    })
    await this.markToolComplete(200, 'Listed skills', {
      success: true,
      operation: 'list',
      skills,
      count: skills.length,
      workspaceId,
    })
  }
}
