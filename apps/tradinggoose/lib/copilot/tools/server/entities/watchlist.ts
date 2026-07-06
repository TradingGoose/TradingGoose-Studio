import { ENTITY_KIND_WATCHLIST } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityServerTool,
  executeUpdateEntityDocumentMutation,
  readSavedEntityDocumentFields,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

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
