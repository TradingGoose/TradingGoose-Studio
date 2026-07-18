import { createLogger } from '@/lib/logs/console/logger'
import { readSavedEntityFieldsForExecution } from '@/lib/yjs/server/bootstrap-review-target'
import { readEntityListMembersFromDb } from '@/lib/yjs/server/entity-loaders'
import type { SkillInput } from '@/executor/handlers/agent/types'
import type { SkillMetadata } from './skill-loader'

const logger = createLogger('AgentSkillsResolver')

export async function resolveSkillMetadata(
  skillInputs: SkillInput[],
  workspaceId: string,
  isDeployedContext: boolean
): Promise<SkillMetadata[]> {
  const selectedSkills = skillInputs.filter(
    (skillInput) => typeof skillInput.skillId === 'string' && skillInput.skillId.length > 0
  )

  if (selectedSkills.length === 0 || !workspaceId) {
    return []
  }

  const namesById = new Map(
    (await readEntityListMembersFromDb('skill', workspaceId)).map(({ id, name }) => [id, name])
  )

  const results = await Promise.allSettled(
    selectedSkills.map((skillInput) =>
      readSavedEntityFieldsForExecution('skill', skillInput.skillId, workspaceId, isDeployedContext)
    )
  )

  return results.flatMap((result, index) => {
    const skillInput = selectedSkills[index]
    const name = namesById.get(skillInput.skillId)
    if (result.status === 'fulfilled' && name !== undefined) {
      return [
        {
          id: skillInput.skillId,
          name,
          description: String(result.value.description ?? ''),
        },
      ]
    }
    logger.warn(
      `Skipping unavailable agent skill ${skillInput.skillId}:`,
      result.status === 'rejected' ? result.reason : 'canonical identity is missing'
    )
    return []
  })
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
