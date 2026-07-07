import { ENTITY_KIND_DASHBOARD_LAYOUT } from '@/lib/copilot/review-sessions/types'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityServerTool,
  readSavedEntityDocumentFields,
  requireEntityId,
  requireUserId,
  verifySavedEntityContext,
} from './shared'

/**
 * list_layouts is list-specific: it takes `workspaceId` from tool ARGS (not the
 * execution context), validates it against the context workspace when one is
 * present, and checks workspace access. Dashboard layouts stay owner-scoped, so
 * the authenticated user is always the owner of the listed rows.
 */
async function verifyDashboardLayoutListScope(
  args: { workspaceId: string },
  context: ServerToolExecutionContext | undefined
): Promise<{ workspaceId: string; ownerUserId: string }> {
  const userId = requireUserId(context)
  const workspaceId = args.workspaceId.trim()
  if (!workspaceId) throw new Error('workspaceId is required')
  if (context?.workspaceId && context.workspaceId !== workspaceId) {
    throw new Error('workspaceId does not match execution context')
  }

  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error('Access denied: You do not have permission to use this dashboard layout')
  }

  return { workspaceId, ownerUserId: userId }
}

export const listLayoutsServerTool: EntityServerTool<{ workspaceId: string }> = {
  name: 'list_layouts',
  async execute(args, context) {
    const { workspaceId, ownerUserId } = await verifyDashboardLayoutListScope(args, context)
    const entities = await buildSavedEntityListInfo(
      ENTITY_KIND_DASHBOARD_LAYOUT,
      workspaceId,
      ownerUserId
    )

    return {
      entityKind: ENTITY_KIND_DASHBOARD_LAYOUT,
      entities,
      count: entities.length,
    }
  },
}

export const readLayoutServerTool: EntityServerTool<{ entityId: string }> = {
  name: 'read_layout',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_layout')
    const { workspaceId, ownerUserId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_DASHBOARD_LAYOUT,
      entityId,
      'read'
    )
    const fields = await readSavedEntityDocumentFields(
      ENTITY_KIND_DASHBOARD_LAYOUT,
      entityId,
      workspaceId,
      ownerUserId
    )
    const projection = await buildDashboardLayoutReadProjection(fields)

    return {
      ...buildDocumentEnvelope(ENTITY_KIND_DASHBOARD_LAYOUT, entityId, projection.canonicalFields),
      workspaceId,
      ownerUserId,
      effectiveLayout: projection.effectiveLayout,
    }
  },
}
