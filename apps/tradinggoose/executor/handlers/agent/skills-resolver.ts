import { db } from '@tradinggoose/db'
import { skill } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
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
    return await db
      .select({ name: skill.name, description: skill.description })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, skillIds)))
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
    const rows = await db
      .select({ content: skill.content })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), eq(skill.name, skillName)))
      .limit(1)

    if (rows.length === 0) {
      logger.warn('Skill not found', { skillName, workspaceId })
      return null
    }

    return rows[0].content
  } catch (error) {
    logger.error('Failed to resolve skill content', { error, skillName, workspaceId })
    return null
  }
}
