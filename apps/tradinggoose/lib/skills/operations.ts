import { db } from '@tradinggoose/db'
import { skill } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type ImportedSkillTransferRecord,
  resolveImportedSkillName,
  type SkillTransferRecord,
} from '@/lib/skills/import-export'
import { generateRequestId } from '@/lib/utils'
import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'
import { readBootstrappedSavedEntityListFields } from '@/lib/yjs/server/bootstrap-review-target'
import {
  deleteYjsSessionInSocketServer,
  notifyEntityListMemberRemoved,
  notifyEntityListMembersAdded,
} from '@/lib/yjs/server/snapshot-bridge'

const logger = createLogger('SkillsOperations')

interface CreateSkillsParams {
  skills: Array<{
    name: string
    description: string
    content: string
  }>
  workspaceId: string
  userId: string
  requestId?: string
}

interface SaveSkillParams {
  skill: {
    id: string
    name: string
    description: string
    content: string
  }
  workspaceId: string
  requestId?: string
}

interface ImportSkillsParams {
  skills: SkillTransferRecord[]
  workspaceId: string
  userId: string
  requestId?: string
}

export async function listSkills(params: { workspaceId: string }) {
  const entries = await readBootstrappedSavedEntityListFields('skill', params.workspaceId)
  return entries.map(({ entityId, fields }) => ({
    id: entityId,
    workspaceId: params.workspaceId,
    userId: null,
    name: String(fields.name ?? ''),
    description: String(fields.description ?? ''),
    content: String(fields.content ?? ''),
    createdAt: new Date(0),
    updatedAt: undefined,
  }))
}

export async function deleteSkill(params: {
  skillId: string
  workspaceId: string
}): Promise<boolean> {
  const [existingSkill] = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, params.workspaceId)))
    .limit(1)

  if (!existingSkill) {
    return false
  }

  await db
    .delete(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, params.workspaceId)))
  await deleteYjsSessionInSocketServer(params.skillId).catch(() => undefined)
  await notifyEntityListMemberRemoved('skill', params.workspaceId, params.skillId)

  logger.info(`Deleted skill ${params.skillId}`)
  return true
}

export async function createSkills({
  skills,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: CreateSkillsParams) {
  if (skills.length === 0) {
    return []
  }

  const created = await db.transaction(async (tx) => {
    const existingSkills = await tx
      .select({
        id: skill.id,
        name: skill.name,
      })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))

    const plannedNames = new Map(
      existingSkills.map((currentSkill) => [currentSkill.name, currentSkill.id])
    )
    const nowTime = new Date()
    const insertValues = []

    for (const currentSkill of skills) {
      const conflictingSkillId = plannedNames.get(currentSkill.name)

      if (conflictingSkillId) {
        throw new Error(
          `A skill with the name "${currentSkill.name}" already exists in this workspace`
        )
      }

      const skillId = nanoid()
      plannedNames.set(currentSkill.name, skillId)
      insertValues.push({
        id: skillId,
        workspaceId,
        userId,
        name: currentSkill.name,
        description: currentSkill.description,
        content: currentSkill.content,
        createdAt: nowTime,
        updatedAt: nowTime,
      })
    }

    const createdSkills = await tx.insert(skill).values(insertValues).returning()
    logger.info(`[${requestId}] Created ${createdSkills.length} skill(s)`)
    return createdSkills
  })

  await notifyEntityListMembersAdded(
    'skill',
    workspaceId,
    created.map((createdSkill) => ({ id: createdSkill.id, name: createdSkill.name }))
  )
  return created
}

export async function saveSkill({
  skill: currentSkill,
  workspaceId,
  requestId = generateRequestId(),
}: SaveSkillParams) {
  const [existingSkill] = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.id, currentSkill.id), eq(skill.workspaceId, workspaceId)))
    .limit(1)
  if (!existingSkill) {
    throw new Error(`Skill ${currentSkill.id} was not found`)
  }

  await applySavedEntityState('skill', currentSkill.id, {
    name: currentSkill.name,
    description: currentSkill.description,
    content: currentSkill.content,
  })
  logger.info(`[${requestId}] Saved skill ${currentSkill.id}`)
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

  await notifyEntityListMembersAdded(
    'skill',
    workspaceId,
    result.skills.map((importedSkill) => ({ id: importedSkill.id, name: importedSkill.name }))
  )
  return result
}
