import { createLogger } from '@/lib/logs/console/logger'
import { listSkills } from '@/lib/skills/operations'
import type { SkillInput } from '@/executor/handlers/agent/types'
import type { SkillMetadata } from './skill-loader'

const logger = createLogger('SkillsResolver')

export async function resolveSkillMetadata(
  skillInputs: SkillInput[],
  workspaceId: string
): Promise<SkillMetadata[]> {
  const skillIds = skillInputs
    .map((skillInput) => skillInput.skillId)
    .filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0)

  if (skillIds.length === 0 || !workspaceId) {
    return []
  }

  try {
    const skills = await listSkills({ workspaceId })
    const selectedSkillIds = new Set(skillIds)
    return skills
      .filter((skill) => selectedSkillIds.has(skill.id))
      .map((skill) => ({ name: skill.name, description: skill.description }))
  } catch (error) {
    logger.error('Failed to resolve skill metadata', { error, skillIds, workspaceId })
    return []
  }
}

export async function resolveSkillContent(
  skillName: string,
  workspaceId: string
): Promise<string | null> {
  if (!skillName || !workspaceId) {
    return null
  }

  try {
    const rows = await listSkills({ workspaceId })
    const skill = rows.find((row) => row.name === skillName)

    if (!skill) {
      logger.warn('Skill not found', { skillName, workspaceId })
      return null
    }

    return skill.content
  } catch (error) {
    logger.error('Failed to resolve skill content', { error, skillName, workspaceId })
    return null
  }
}
