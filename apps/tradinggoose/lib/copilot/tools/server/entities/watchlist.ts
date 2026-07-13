import { ENTITY_KIND_WATCHLIST } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { createWatchlistFromDocument } from '@/lib/watchlists/operations'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
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

export const listWatchlistsServerTool: EntityServerTool<{ workspaceId?: string }> = {
  name: 'list_watchlist',
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
    const document = await readSavedEntityDocument(ENTITY_KIND_WATCHLIST, entityId, workspaceId)
    return buildDocumentEnvelope(
      ENTITY_KIND_WATCHLIST,
      entityId,
      document.entityName,
      document.fields
    )
  },
}

export const createWatchlistServerTool: EntityServerTool = {
  name: 'create_watchlist',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(
      ENTITY_KIND_WATCHLIST,
      args,
      context,
      async (name, fields, { workspaceId, beforeInsert }) => {
        const created = await createWatchlistFromDocument(
          { workspaceId },
          { name, ...fields },
          { beforeInsert }
        )
        const { name: entityName, ...content } = created.fields
        return { entityId: created.id, entityName, fields: content }
      }
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

export const renameWatchlistServerTool: EntityServerTool<RenameEntityArgs> = {
  name: 'rename_watchlist',
  execute(args, context) {
    return executeRenameEntityMutation(ENTITY_KIND_WATCHLIST, 'rename_watchlist', args, context)
  },
}
