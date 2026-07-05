import { ENTITY_KIND_WATCHLIST } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { createWatchlistDocument } from '@/lib/watchlists/operations'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityCreateResult,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
  readSavedEntityDocumentFields,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

async function createWatchlistEntity(
  fields: Record<string, unknown>,
  context: Parameters<typeof verifyWorkspaceContext>[0]
): Promise<EntityCreateResult> {
  const { workspaceId } = await verifyWorkspaceContext(context, 'write')
  const watchlist = await createWatchlistDocument(workspaceId, fields)

  return {
    entityId: watchlist.id,
    fields: {
      name: watchlist.name,
      settings: watchlist.settings,
      items: watchlist.items,
    },
  }
}

export const listWatchlistsServerTool: EntityServerTool<{ workspaceId?: string }> = {
  name: 'list_watchlists',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const entities = await buildSavedEntityListInfo(ENTITY_KIND_WATCHLIST, workspaceId)

    return {
      entityKind: ENTITY_KIND_WATCHLIST,
      entities,
      count: entities.length,
    }
  },
}

export const readWatchlistServerTool: EntityServerTool = {
  name: 'read_watchlist',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_watchlist')
    const { workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_WATCHLIST,
      entityId,
      'read'
    )
    const fields = await readSavedEntityDocumentFields(ENTITY_KIND_WATCHLIST, entityId, workspaceId)
    return buildDocumentEnvelope(ENTITY_KIND_WATCHLIST, entityId, fields)
  },
}

export const createWatchlistServerTool: EntityServerTool = {
  name: 'create_watchlist',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(
      ENTITY_KIND_WATCHLIST,
      args,
      context,
      createWatchlistEntity
    )
  },
}

export const editWatchlistServerTool: EntityServerTool = {
  name: 'edit_watchlist',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_WATCHLIST,
      'edit_watchlist',
      args,
      context
    )
  },
}

export const renameWatchlistServerTool: EntityServerTool = {
  name: 'rename_watchlist',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_WATCHLIST,
      'rename_watchlist',
      args,
      context
    )
  },
}
