import { readSavedEntityFieldsForExecution } from '@/lib/yjs/server/bootstrap-review-target'
import { createLogger } from '@/lib/logs/console/logger'
import type { SkillInput } from '@/executor/handlers/agent/types'
import type { SkillMetadata } from './skill-loader'

const logger = createLogger('SkillsResolver')

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

  const skills = await Promise.all(
    skillIds.map(async (skillId) => {
      try {
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
      } catch (error) {
        logger.warn('Failed to resolve skill metadata', { error, skillId, workspaceId })
        return null
      }
    })
  )

  return skills.filter((skill): skill is SkillMetadata => skill !== null)
}

export async function resolveSkillContent(
  skillId: string,
  workspaceId: string,
  isDeployedContext: boolean
): Promise<string | null> {
  if (!skillId || !workspaceId) {
    return null
  }

  try {
    const fields = await readSavedEntityFieldsForExecution(
      'skill',
      skillId,
      workspaceId,
      isDeployedContext
    )
    return String(fields.content ?? '')
  } catch (error) {
    logger.warn('Failed to resolve skill content', { error, skillId, workspaceId })
    return null
  }
}
