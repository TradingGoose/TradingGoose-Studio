import { ENTITY_KIND_SKILL } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { createSkills } from '@/lib/skills/operations'
import { savedEntityRowToContent } from '@/lib/yjs/entity-state'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityCreateContext,
  type EntityCreateResult,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeRenameEntityMutation,
  executeUpdateEntityDocumentMutation,
  type RenameEntityArgs,
  readSavedEntityDocument,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

async function createSkillEntity(
  name: string,
  fields: Record<string, unknown>,
  { userId, workspaceId }: EntityCreateContext
): Promise<EntityCreateResult> {
  const rows = await createSkills({
    userId,
    workspaceId,
    skills: [
      {
        name,
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
    entityName: row.name,
    fields: savedEntityRowToContent(ENTITY_KIND_SKILL, row),
  }
}

export const listSkillsServerTool: EntityServerTool<Record<string, never>> = {
  name: 'list_skills',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const entities = await buildSavedEntityListInfo(ENTITY_KIND_SKILL, workspaceId)

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
    const document = await readSavedEntityDocument(ENTITY_KIND_SKILL, entityId, workspaceId)
    return buildDocumentEnvelope(ENTITY_KIND_SKILL, entityId, document.entityName, document.fields)
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

export const renameSkillServerTool: EntityServerTool<RenameEntityArgs> = {
  name: 'rename_skill',
  execute(args, context) {
    return executeRenameEntityMutation(ENTITY_KIND_SKILL, 'rename_skill', args, context)
  },
}
