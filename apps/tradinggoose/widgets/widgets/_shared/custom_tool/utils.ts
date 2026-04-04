export const CUSTOM_TOOL_LIST_WIDGET_KEY = 'list_custom_tool'
export const CUSTOM_TOOL_EDITOR_WIDGET_KEY = 'editor_custom_tool'

export const getCustomToolIdFromParams = (params?: Record<string, unknown> | null) => {
  if (!params || typeof params !== 'object') return null
  const value = params.customToolId
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export const resolveCustomToolId = ({
  params,
  pairContext,
}: {
  params?: Record<string, unknown> | null
  pairContext?: { customToolId?: string | null } | null
}) => {
  if (pairContext && Object.hasOwn(pairContext, 'customToolId')) {
    const value = pairContext.customToolId
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }

  return getCustomToolIdFromParams(params)
}
