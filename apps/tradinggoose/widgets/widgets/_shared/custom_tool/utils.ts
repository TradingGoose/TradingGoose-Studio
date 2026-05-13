import { readEntitySelectionState, resolveEntityId } from '@/widgets/utils/entity-selection'

export { readEntitySelectionState }

export const CUSTOM_TOOL_LIST_WIDGET_KEY = 'list_custom_tool'
export const CUSTOM_TOOL_EDITOR_WIDGET_KEY = 'editor_custom_tool'

export const getCustomToolIdFromParams = (params?: Record<string, unknown> | null) =>
  resolveEntityId('customToolId', { params })

export const resolveCustomToolId = ({
  params,
  pairContext,
}: {
  params?: Record<string, unknown> | null
  pairContext?: { customToolId?: string | null } | null
}) => resolveEntityId('customToolId', { params, pairContext })
