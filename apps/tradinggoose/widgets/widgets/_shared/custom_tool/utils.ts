import { resolveEntityId } from '@/widgets/widget-contracts'

export const CUSTOM_TOOL_LIST_WIDGET_KEY = 'list_custom_tool'
export const CUSTOM_TOOL_EDITOR_WIDGET_KEY = 'editor_custom_tool'

export const getCustomToolIdFromParams = (params?: Record<string, unknown> | null) =>
  resolveEntityId('customToolId', { params })

export const resolveCustomToolId = ({ params }: { params?: Record<string, unknown> | null }) =>
  resolveEntityId('customToolId', { params })
