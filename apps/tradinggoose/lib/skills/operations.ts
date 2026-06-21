import { db } from '@tradinggoose/db'
import { skill } from '@tradinggoose/db/schema'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type ImportedSkillTransferRecord,
  resolveImportedSkillName,
  type SkillTransferRecord,
} from '@/lib/skills/import-export'
import { generateRequestId } from '@/lib/utils'
import { applySavedEntityRows } from '@/lib/yjs/entity-state'
import { deleteYjsSessionInSocketServer } from '@/lib/yjs/server/snapshot-bridge'

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

interface ImportSkillsParams {
  skills: SkillTransferRecord[]
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

  await deleteYjsSessionInSocketServer(params.skillId)
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
  const createdRows: Array<typeof skill.$inferSelect> = []
  const updatedRows: Array<typeof skill.$inferSelect> = []
  const createdIds: string[] = []
  await db.transaction(async (tx) => {
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

          logger.info(`[${requestId}] Updated skill ${currentSkill.id}`)
          updatedRows.push({
            ...existingSkill[0],
            name: currentSkill.name,
            description: currentSkill.description,
            content: currentSkill.content,
            updatedAt: nowTime,
          })
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

      const skillId = currentSkill.id || nanoid()
      const newSkill = {
        id: skillId,
        workspaceId,
        userId,
        name: currentSkill.name,
        description: currentSkill.description,
        content: currentSkill.content,
        createdAt: nowTime,
        updatedAt: nowTime,
      }
      await tx.insert(skill).values(newSkill)

      logger.info(`[${requestId}] Created skill "${currentSkill.name}"`)
      createdRows.push(newSkill)
      createdIds.push(skillId)
    }
  })

  await applySavedEntityRows('skill', createdRows, {
    rollbackRows: async () => {
      if (createdIds.length > 0) {
        await db.delete(skill).where(inArray(skill.id, createdIds))
      }
    },
  })
  await applySavedEntityRows('skill', updatedRows)

  return listSkills({ workspaceId })
}

export async function importSkills({
  skills,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: ImportSkillsParams) {
  const result = await db.transaction(async (tx) => {
    const existingNames = await tx
      .select({ name: skill.name })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))

    const usedNames = new Set(existingNames.map((currentSkill) => currentSkill.name))
    const nowTime = new Date()
    let renamedCount = 0
    const importedSkills: ImportedSkillTransferRecord[] = []

    const insertValues = skills.map((currentSkill) => {
      const sourceName = currentSkill.name
      const resolvedName = resolveImportedSkillName(sourceName, usedNames)
      const skillId = nanoid()

      if (resolvedName !== sourceName) {
        renamedCount += 1
      }

      usedNames.add(resolvedName)
      importedSkills.push({
        sourceName,
        skillId,
        name: resolvedName,
      })

      return {
        id: skillId,
        workspaceId,
        userId,
        name: resolvedName,
        description: currentSkill.description,
        content: currentSkill.content,
        createdAt: nowTime,
        updatedAt: nowTime,
      }
    })

    const persistedSkills = await tx.insert(skill).values(insertValues).returning()

    logger.info(`[${requestId}] Imported ${persistedSkills.length} skill(s)`, {
      workspaceId,
      renamedCount,
    })

    return {
      skills: persistedSkills,
      importedSkills,
      importedCount: persistedSkills.length,
      renamedCount,
    }
  })

  await applySavedEntityRows('skill', result.skills, {
    rollbackRows: async () => {
      if (result.skills.length > 0) {
        await db.delete(skill).where(
          inArray(
            skill.id,
            result.skills.map((row) => row.id)
          )
        )
      }
    },
  })

  return result
}
