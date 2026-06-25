import { createLogger } from '@/lib/logs/console/logger'
import {
  resolveImportedWorkflowName,
  type WorkflowTransferRecord,
} from '@/lib/workflows/import-export'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'

const logger = createLogger('WorkflowImport')
const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')
type ImportedWorkflowState = WorkflowTransferRecord['state']

type ImportedWorkflowSkill = {
  skillId: string
  name: string
}

type CreateWorkflowParams = {
  name: string
  description: string
  workspaceId: string
  initialWorkflowState: ImportedWorkflowState
}

type ImportWorkflowFromJsonContentParams = {
  content: string
  workspaceId: string
  existingWorkflowNames: Iterable<string>
  importedSkillsBySourceName?: Map<string, ImportedWorkflowSkill>
  createWorkflow: (params: CreateWorkflowParams) => Promise<string>
}

function relinkWorkflowSkillValues(
  state: ImportedWorkflowState,
  importedSkillsBySourceName: Map<string, ImportedWorkflowSkill>
): ImportedWorkflowState {
  const clonedState = JSON.parse(JSON.stringify(state)) as ImportedWorkflowState

  Object.entries(clonedState.blocks).forEach(([blockId, block]) => {
    const skillSubBlock = block.subBlocks?.skills

    if (
      !skillSubBlock ||
      skillSubBlock.value === null ||
      typeof skillSubBlock.value === 'undefined'
    ) {
      return
    }

    if (!Array.isArray(skillSubBlock.value)) {
      throw new Error(`Invalid skill values in block ${blockId}: expected an array`)
    }

    const skillEntries = skillSubBlock.value as unknown[]
    const workflowSkillSubBlock = skillSubBlock as any

    workflowSkillSubBlock.value = skillEntries.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(
          `Invalid skill value at index ${index} in block ${blockId}: must be an object`
        )
      }

      const skillEntry = entry as { name?: unknown }
      const sourceName =
        typeof skillEntry.name === 'string' ? normalizeInlineWhitespace(skillEntry.name) : ''

      if (!sourceName) {
        throw new Error(
          `Invalid skill value at index ${index} in block ${blockId}: missing skill name`
        )
      }

      const importedSkill = importedSkillsBySourceName.get(sourceName)

      if (!importedSkill) {
        throw new Error(
          `Unable to resolve imported skill "${sourceName}" referenced by block ${blockId}`
        )
      }

      return {
        skillId: importedSkill.skillId,
        name: importedSkill.name,
      }
    })
  })

  return clonedState
}

export async function importWorkflowFromJsonContent({
  content,
  workspaceId,
  existingWorkflowNames,
  importedSkillsBySourceName,
  createWorkflow,
}: ImportWorkflowFromJsonContentParams): Promise<string> {
  if (!workspaceId) {
    throw new Error('Workspace ID is required to import workflows')
  }

  const { data: parsedWorkflowData, errors } = parseWorkflowJson(content, true)

  if (!parsedWorkflowData || errors.length > 0) {
    const message = errors[0] ?? 'Failed to parse workflow import file'
    throw new Error(message)
  }

  let workflowData: WorkflowTransferRecord = parsedWorkflowData

  if (workflowData.skills.length > 0) {
    if (!importedSkillsBySourceName || importedSkillsBySourceName.size === 0) {
      throw new Error('Workflow import includes skills but no imported skills were provided')
    }

    workflowData = {
      ...workflowData,
      state: relinkWorkflowSkillValues(workflowData.state, importedSkillsBySourceName),
    }
  }

  const resolvedName = resolveImportedWorkflowName(workflowData.name, existingWorkflowNames)
  const workflowId = await createWorkflow({
    name: resolvedName,
    description: workflowData.description,
    workspaceId,
    initialWorkflowState: workflowData.state,
  })

  logger.info('Created workflow row for imported workflow', {
    workflowId,
    workflowName: resolvedName,
  })

  return workflowId
}
