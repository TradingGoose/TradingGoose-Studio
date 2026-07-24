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

  const namesByIdPromise = readEntityListMembersFromDb('skill', workspaceId).then(
    (members) => new Map(members.map(({ id, name }) => [id, name]))
  )

  const results = await Promise.allSettled(
    selectedSkills.map(async (skillInput) => {
      const [fields, namesById] = await Promise.all([
        readSavedEntityFieldsForExecution(
          'skill',
          skillInput.skillId,
          workspaceId,
          isDeployedContext
        ),
        namesByIdPromise,
      ])
      const name = namesById.get(skillInput.skillId)
      if (name === undefined) throw new Error('Canonical skill identity is missing')
      return {
        id: skillInput.skillId,
        name,
        description: String(fields.description ?? ''),
      }
    })
  )

  return results.flatMap((result, index) => {
    const skillInput = selectedSkills[index]
    if (result.status === 'fulfilled') return [result.value]
    logger.warn(`Skipping unavailable agent skill ${skillInput.skillId}:`, result.reason)
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
