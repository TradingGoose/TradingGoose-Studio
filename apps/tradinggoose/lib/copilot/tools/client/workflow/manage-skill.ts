import { BookOpen, Check, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store'
import { useSkillsStore } from '@/stores/skills/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface ManageSkillArgs {
  operation: 'add' | 'edit' | 'delete' | 'list'
  skillId?: string
  name?: string
  description?: string
  content?: string
}

const API_ENDPOINT = '/api/skills'

export class ManageSkillClientTool extends BaseClientTool {
  static readonly id = 'manage_skill'
  private currentArgs?: ManageSkillArgs

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
    getDynamicText: (params, state) => {
      const operation = params?.operation as 'add' | 'edit' | 'delete' | 'list' | undefined
      if (!operation) return undefined

      let skillName = params?.name
      if (!skillName && params?.skillId) {
        try {
          const skill = useSkillsStore.getState().getSkill(params.skillId)
          skillName = skill?.name
        } catch {
          // Ignore store lookup failures for display-only metadata
        }
      }

      const getActionText = (verb: 'present' | 'past' | 'gerund') => {
        switch (operation) {
          case 'add':
            return verb === 'present' ? 'Create' : verb === 'past' ? 'Created' : 'Creating'
          case 'edit':
            return verb === 'present' ? 'Edit' : verb === 'past' ? 'Edited' : 'Editing'
          case 'delete':
            return verb === 'present' ? 'Delete' : verb === 'past' ? 'Deleted' : 'Deleting'
          case 'list':
            return verb === 'present' ? 'List' : verb === 'past' ? 'Listed' : 'Listing'
        }
      }

      const shouldShowSkillName = (currentState: ClientToolCallState) => {
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
          ? ' skills'
          : shouldShowSkillName(state) && skillName
            ? ` ${skillName}`
            : ' skill'

      switch (state) {
        case ClientToolCallState.success:
          return `${getActionText('past')}${nameText}`
        case ClientToolCallState.executing:
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

  private getArgsFromStore(): ManageSkillArgs | undefined {
    try {
      const { toolCallsById } = getCopilotStoreForToolCall(this.toolCallId).getState()
      const toolCall = toolCallsById[this.toolCallId]
      return (toolCall as any)?.params as ManageSkillArgs | undefined
    } catch {
      return undefined
    }
  }

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

  async handleAccept(args?: ManageSkillArgs): Promise<void> {
    const logger = createLogger('ManageSkillClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      await this.executeOperation(args, logger)
    } catch (error: any) {
      logger.error('execute failed', { message: error?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, error?.message || 'Failed to manage skill')
    }
  }

  async execute(args?: ManageSkillArgs): Promise<void> {
    this.currentArgs = args
    if (args?.operation === 'list') {
      await this.handleAccept(args)
    }
  }

  private async executeOperation(
    args: ManageSkillArgs | undefined,
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    if (!args?.operation) {
      throw new Error('Operation is required')
    }

    const { operation, skillId, name, description, content } = args

    const { workflowId: activeWorkflowId } = this.requireExecutionContext()
    const registryState = useWorkflowRegistry.getState()
    const workspaceId = registryState.workflows[activeWorkflowId]?.workspaceId
    if (!workspaceId) {
      throw new Error('No active workspace found')
    }

    logger.info(`Executing skill operation: ${operation}`, {
      operation,
      skillId,
      name,
      workspaceId,
    })

    switch (operation) {
      case 'list':
        await this.listSkills(workspaceId, logger)
        break
      case 'add':
        await this.addSkill({ name, description, content, workspaceId }, logger)
        break
      case 'edit':
        await this.editSkill({ skillId, name, description, content, workspaceId }, logger)
        break
      case 'delete':
        await this.deleteSkill({ skillId, workspaceId }, logger)
        break
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  private async addSkill(
    params: {
      name?: string
      description?: string
      content?: string
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { name, description, content, workspaceId } = params

    if (!name) {
      throw new Error('Name is required for adding a skill')
    }
    if (!description) {
      throw new Error('Description is required for adding a skill')
    }
    if (!content) {
      throw new Error('Content is required for adding a skill')
    }

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skills: [{ name, description, content }],
        workspaceId,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create skill')
    }

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('Invalid API response: missing skill data')
    }

    const createdSkill = data.data[0]
    logger.info(`Created skill: ${name}`, { skillId: createdSkill.id })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Created skill "${name}"`, {
      success: true,
      operation: 'add',
      skillId: createdSkill.id,
      name,
    })
  }

  private async editSkill(
    params: {
      skillId?: string
      name?: string
      description?: string
      content?: string
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { skillId, name, description, content, workspaceId } = params

    if (!skillId) {
      throw new Error('Skill ID is required for editing a skill')
    }

    if (!name && !description && !content) {
      throw new Error('At least one of name, description, or content must be provided for editing')
    }

    const existingResponse = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)
    const existingData = await existingResponse.json()

    if (!existingResponse.ok) {
      throw new Error(existingData.error || 'Failed to fetch existing skills')
    }

    const existingSkill = existingData.data?.find((skill: any) => skill.id === skillId)
    if (!existingSkill) {
      throw new Error(`Skill with ID ${skillId} not found`)
    }

    const updatedSkill = {
      id: skillId,
      name: name ?? existingSkill.name,
      description: description ?? existingSkill.description,
      content: content ?? existingSkill.content,
    }

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skills: [updatedSkill],
        workspaceId,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update skill')
    }

    logger.info(`Updated skill: ${updatedSkill.name}`, { skillId })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Updated skill "${updatedSkill.name}"`, {
      success: true,
      operation: 'edit',
      skillId,
      name: updatedSkill.name,
    })
  }

  private async deleteSkill(
    params: {
      skillId?: string
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { skillId, workspaceId } = params

    if (!skillId) {
      throw new Error('Skill ID is required for deleting a skill')
    }

    const skill = useSkillsStore.getState().getSkill(skillId, workspaceId)
    const skillName = skill?.name

    const response = await fetch(`${API_ENDPOINT}?id=${skillId}&workspaceId=${workspaceId}`, {
      method: 'DELETE',
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete skill')
    }

    logger.info(`Deleted skill: ${skillName || skillId}`, { skillId })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Deleted skill "${skillName || skillId}"`, {
      success: true,
      operation: 'delete',
      skillId,
      name: skillName,
    })
  }

  private async listSkills(
    workspaceId: string,
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch skills')
    }

    const skills = Array.isArray(data.data) ? data.data : []

    logger.info(`Listed skills for workspace ${workspaceId}`, { count: skills.length })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Found ${skills.length} skill(s)`, {
      success: true,
      operation: 'list',
      skills,
      count: skills.length,
    })
  }
}
