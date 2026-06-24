import { db } from '@tradinggoose/db'
import { skill } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type ImportedSkillTransferRecord,
  resolveImportedSkillName,
  type SkillTransferRecord,
} from '@/lib/skills/import-export'
import { generateRequestId } from '@/lib/utils'
import { applySavedEntityPersistedState } from '@/lib/yjs/server/apply-entity-state'

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
  const deletedSkill = await db
    .delete(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, params.workspaceId)))
    .returning({ id: skill.id })

  if (deletedSkill.length === 0) {
    return false
  }

  logger.info(`Deleted skill ${params.skillId}`)
  return true
}

export async function upsertSkills({
  skills,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: UpsertSkillsParams) {
  const updates: Array<{
    id: string
    fields: Record<string, unknown>
  }> = []

  await db.transaction(async (tx) => {
    const existingSkills = await tx
      .select({
        id: skill.id,
        name: skill.name,
      })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))

    const existingById = new Map(
      existingSkills.map((currentSkill) => [
        currentSkill.id,
        { id: currentSkill.id, name: currentSkill.name },
      ])
    )
    const plannedNames = new Map(
      existingSkills.map((currentSkill) => [currentSkill.name, currentSkill.id])
    )

    for (const currentSkill of skills) {
      const nowTime = new Date()
      const existingSkill = currentSkill.id ? existingById.get(currentSkill.id) : null
      const conflictingSkillId = plannedNames.get(currentSkill.name)

      if (conflictingSkillId && conflictingSkillId !== currentSkill.id) {
        throw new Error(
          `A skill with the name "${currentSkill.name}" already exists in this workspace`
        )
      }

      if (existingSkill && currentSkill.id) {
        if (existingSkill.name !== currentSkill.name) {
          plannedNames.delete(existingSkill.name)
          plannedNames.set(currentSkill.name, currentSkill.id)
          existingSkill.name = currentSkill.name
        }

        updates.push({
          id: currentSkill.id,
          fields: {
            name: currentSkill.name,
            description: currentSkill.description,
            content: currentSkill.content,
          },
        })
        logger.info(`[${requestId}] Updated skill ${currentSkill.id}`)
        continue
      }

      const skillId = currentSkill.id || nanoid()
      plannedNames.set(currentSkill.name, skillId)
      existingById.set(skillId, { id: skillId, name: currentSkill.name })
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
    }
  })

  await Promise.all(
    updates.map(({ id, fields }) =>
      applySavedEntityPersistedState('skill', id, workspaceId, fields)
    )
  )

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

  return result
}
