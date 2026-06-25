import { ENTITY_KIND_SKILL } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { createSkills, listSkills } from '@/lib/skills/operations'
import { savedEntityRowToFields } from '@/lib/yjs/entity-state'
import {
  buildDocumentEnvelope,
  type EntityCreateResult,
  type EntityListEntry,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
  readSavedEntityDocumentFields,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

function toSkillListEntry(row: Awaited<ReturnType<typeof listSkills>>[number]): EntityListEntry {
  return {
    entityId: row.id,
    entityName: row.name,
    workspaceId: row.workspaceId,
    entityDescription: row.description ?? '',
  }
}

async function createSkillEntity(
  fields: Record<string, unknown>,
  context: Parameters<typeof verifyWorkspaceContext>[0]
): Promise<EntityCreateResult> {
  const { userId, workspaceId } = await verifyWorkspaceContext(context, 'write')
  const rows = await createSkills({
    userId,
    workspaceId,
    skills: [
      {
        name: String(fields.name ?? ''),
        description: String(fields.description ?? ''),
        content: String(fields.content ?? ''),
      },
    ],
  })
  const row = rows[0]
  if (!row) {
    throw new Error('Created skill was not returned')
  }

  return {
    entityId: row.id,
    fields: savedEntityRowToFields(ENTITY_KIND_SKILL, row),
  }
}

export const listSkillsServerTool: EntityServerTool<Record<string, never>> = {
  name: 'list_skills',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const rows = await listSkills({ workspaceId })
    const entities = rows.map(toSkillListEntry)

    return {
      entityKind: ENTITY_KIND_SKILL,
      entities,
      count: entities.length,
    }
  },
}

export const readSkillServerTool: EntityServerTool = {
  name: 'read_skill',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_skill')
    const { workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_SKILL,
      entityId,
      'read'
    )
    const fields = await readSavedEntityDocumentFields(ENTITY_KIND_SKILL, entityId, workspaceId)
    return buildDocumentEnvelope(ENTITY_KIND_SKILL, entityId, fields)
  },
}

export const createSkillServerTool: EntityServerTool = {
  name: 'create_skill',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(ENTITY_KIND_SKILL, args, context, createSkillEntity)
  },
}

export const editSkillServerTool: EntityServerTool = {
  name: 'edit_skill',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(ENTITY_KIND_SKILL, 'edit_skill', args, context)
  },
}

export const renameSkillServerTool: EntityServerTool = {
  name: 'rename_skill',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(ENTITY_KIND_SKILL, 'rename_skill', args, context)
  },
}
