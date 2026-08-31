import { createLogger } from '@/lib/logs/console/logger'
import {
  resolveImportedWorkflowName,
  type WorkflowTransferRecord,
} from '@/lib/workflows/import-export'

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

type ImportParsedWorkflowParams = {
  workflowData: WorkflowTransferRecord
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

export async function importParsedWorkflow({
  workflowData,
  workspaceId,
  existingWorkflowNames,
  importedSkillsBySourceName,
  createWorkflow,
}: ImportParsedWorkflowParams): Promise<string> {
  if (!workspaceId) {
    throw new Error('Workspace ID is required to import workflows')
  }

  let resolvedWorkflowData = workflowData

  if (resolvedWorkflowData.skills.length > 0) {
    if (!importedSkillsBySourceName || importedSkillsBySourceName.size === 0) {
      throw new Error('Workflow import includes skills but no imported skills were provided')
    }

    resolvedWorkflowData = {
      ...resolvedWorkflowData,
      state: relinkWorkflowSkillValues(resolvedWorkflowData.state, importedSkillsBySourceName),
    }
  }

  const resolvedName = resolveImportedWorkflowName(resolvedWorkflowData.name, existingWorkflowNames)
  const workflowId = await createWorkflow({
    name: resolvedName,
    description: resolvedWorkflowData.description,
    workspaceId,
    initialWorkflowState: resolvedWorkflowData.state,
  })

  logger.info('Created workflow row for imported workflow', {
    workflowId,
    workflowName: resolvedName,
  })

  return workflowId
}
