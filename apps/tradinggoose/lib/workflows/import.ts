import { createLogger } from '@/lib/logs/console/logger'
import { resolveImportedWorkflowName } from '@/lib/workflows/import-export'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowImport')
const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')

type ImportedWorkflowSkill = {
  skillId: string
  name: string
}

const deriveFallbackWorkflowName = (filename?: string) => {
  if (typeof filename === 'string') {
    const nameWithoutExtension = filename.replace(/\.json$/i, '').trim()
    if (nameWithoutExtension.length > 0) {
      return nameWithoutExtension
    }
  }

  return `Imported Workflow - ${new Date().toLocaleString()}`
}

type CreateWorkflowParams = {
  name: string
  description: string
  workspaceId: string
  color?: string
}

type ImportWorkflowFromJsonContentParams = {
  content: string
  filename?: string
  workspaceId: string
  existingWorkflowNames: Iterable<string>
  importedSkillsBySourceName?: Map<string, ImportedWorkflowSkill>
  createWorkflow: (params: CreateWorkflowParams) => Promise<string>
  persistWorkflowState: (workflowId: string, state: WorkflowState) => Promise<void>
}

function relinkWorkflowSkillValues(
  state: WorkflowState,
  importedSkillsBySourceName: Map<string, ImportedWorkflowSkill>
): WorkflowState {
  const clonedState = JSON.parse(JSON.stringify(state)) as WorkflowState

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
  filename,
  workspaceId,
  existingWorkflowNames,
  importedSkillsBySourceName,
  createWorkflow,
  persistWorkflowState,
}: ImportWorkflowFromJsonContentParams): Promise<string> {
  if (!workspaceId) {
    throw new Error('Workspace ID is required to import workflows')
  }

  const fallbackName = deriveFallbackWorkflowName(filename)
  const { data: parsedWorkflowData, errors } = parseWorkflowJson(content, true, {
    fallbackName,
  })
  let workflowData = parsedWorkflowData

  if (!workflowData || errors.length > 0) {
    const message = errors[0] ?? 'Failed to parse workflow import file'
    throw new Error(message)
  }

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
    color: workflowData.color.length > 0 ? workflowData.color : undefined,
    workspaceId,
  })

  logger.info('Created workflow row for imported workflow', {
    workflowId,
    workflowName: resolvedName,
  })

  await persistWorkflowState(workflowId, workflowData.state)

  logger.info('Persisted imported workflow state', {
    workflowId,
  })

  return workflowId
}
