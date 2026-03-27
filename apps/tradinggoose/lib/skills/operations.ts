import { db } from '@tradinggoose/db'
import { skill } from '@tradinggoose/db/schema'
import { and, desc, eq, ne } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('SkillsOperations')

interface UpsertSkillsParams {
  skills: Array<{
    id?: string
    name: string
    description: string
    content: string
  }>
  workspaceId: string
  userId: string
  requestId?: string
}

export async function listSkills(params: { workspaceId: string }) {
  return db
    .select()
    .from(skill)
    .where(eq(skill.workspaceId, params.workspaceId))
    .orderBy(desc(skill.createdAt))
}

export async function deleteSkill(params: {
  skillId: string
  workspaceId: string
}): Promise<boolean> {
  const existingSkill = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, params.workspaceId)))
    .limit(1)

  if (existingSkill.length === 0) {
    return false
  }

  await db
    .delete(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, params.workspaceId)))

  logger.info(`Deleted skill ${params.skillId}`)
  return true
}

export async function upsertSkills({
  skills,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: UpsertSkillsParams) {
  return await db.transaction(async (tx) => {
    for (const currentSkill of skills) {
      const nowTime = new Date()

      if (currentSkill.id) {
        const existingSkill = await tx
          .select()
          .from(skill)
          .where(and(eq(skill.id, currentSkill.id), eq(skill.workspaceId, workspaceId)))
          .limit(1)

        if (existingSkill.length > 0) {
          if (currentSkill.name !== existingSkill[0].name) {
            const nameConflict = await tx
              .select({ id: skill.id })
              .from(skill)
              .where(
                and(
                  eq(skill.workspaceId, workspaceId),
                  eq(skill.name, currentSkill.name),
                  ne(skill.id, currentSkill.id)
                )
              )
              .limit(1)

            if (nameConflict.length > 0) {
              throw new Error(
                `A skill with the name "${currentSkill.name}" already exists in this workspace`
              )
            }
          }

          await tx
            .update(skill)
            .set({
              name: currentSkill.name,
              description: currentSkill.description,
              content: currentSkill.content,
              updatedAt: nowTime,
            })
            .where(and(eq(skill.id, currentSkill.id), eq(skill.workspaceId, workspaceId)))

          logger.info(`[${requestId}] Updated skill ${currentSkill.id}`)
          continue
        }
      }

      const duplicateName = await tx
        .select({ id: skill.id })
        .from(skill)
        .where(and(eq(skill.workspaceId, workspaceId), eq(skill.name, currentSkill.name)))
        .limit(1)

      if (duplicateName.length > 0) {
        throw new Error(
          `A skill with the name "${currentSkill.name}" already exists in this workspace`
        )
      }

      await tx.insert(skill).values({
        id: currentSkill.id || nanoid(),
        workspaceId,
        userId,
        name: currentSkill.name,
        description: currentSkill.description,
        content: currentSkill.content,
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      logger.info(`[${requestId}] Created skill "${currentSkill.name}"`)
    }

    return await tx
      .select()
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .orderBy(desc(skill.createdAt))
  })
}
