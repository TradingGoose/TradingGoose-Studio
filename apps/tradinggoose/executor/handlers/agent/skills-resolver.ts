import { readSavedEntityFieldsForExecution } from '@/lib/yjs/server/bootstrap-review-target'
import type { SkillInput } from '@/executor/handlers/agent/types'
import type { SkillMetadata } from './skill-loader'

export async function resolveSkillMetadata(
  skillInputs: SkillInput[],
  workspaceId: string,
  isDeployedContext: boolean
): Promise<SkillMetadata[]> {
  const skillIds = skillInputs
    .map((skillInput) => skillInput.skillId)
    .filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0)

  if (skillIds.length === 0 || !workspaceId) {
    return []
  }

  return Promise.all(
    skillIds.map(async (skillId) => {
      const fields = await readSavedEntityFieldsForExecution(
        'skill',
        skillId,
        workspaceId,
        isDeployedContext
      )
      return {
        id: skillId,
        name: String(fields.name ?? ''),
        description: String(fields.description ?? ''),
      }
    })
  )
}

export async function resolveSkillContent(
  skillId: string,
  workspaceId: string,
  isDeployedContext: boolean
): Promise<string> {
  const fields = await readSavedEntityFieldsForExecution(
    'skill',
    skillId,
    workspaceId,
    isDeployedContext
  )
  return String(fields.content ?? '')
}
