import { db } from '@tradinggoose/db'
import { skill } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type { SkillInput } from '@/executor/handlers/agent/types'
import type { SkillMetadata } from './skill-loader'

const logger = createLogger('SkillsResolver')

export async function resolvePersistedSkillMetadata(
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
    const rows = await db
      .select({ id: skill.id, name: skill.name, description: skill.description })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, skillIds)))
    const metadataById = new Map(rows.map((row) => [row.id, row]))
    return skillIds.flatMap((skillId) => {
      const row = metadataById.get(skillId)
      return row ? [{ id: row.id, name: row.name, description: row.description }] : []
    })
  } catch (error) {
    logger.error('Failed to resolve skill metadata', { error, skillIds, workspaceId })
    return []
  }
}

export async function resolvePersistedSkillContent(
  skillId: string,
  workspaceId: string
): Promise<string | null> {
  if (!skillId || !workspaceId) {
    return null
  }

  try {
    const [row] = await db
      .select({ content: skill.content })
      .from(skill)
      .where(and(eq(skill.id, skillId), eq(skill.workspaceId, workspaceId)))
      .limit(1)

    if (!row) {
      logger.warn('Skill not found', { skillId, workspaceId })
      return null
    }

    return row.content
  } catch (error) {
    logger.error('Failed to resolve skill content', { error, skillId, workspaceId })
    return null
  }
}
