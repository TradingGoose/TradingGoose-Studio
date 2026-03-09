export type ToolbarAddBlockRequest = {
  type: string
  enableTriggerMode?: boolean
  clientX?: number
  clientY?: number
}

type ToolbarAddBlockHandler = (request: ToolbarAddBlockRequest) => void

const handlersByScope = new Map<string, ToolbarAddBlockHandler>()

const resolveScopeKey = (scopeId?: string) => {
  const trimmed = scopeId?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

export const registerToolbarAddBlockHandler = (
  scopeId: string | undefined,
  handler: ToolbarAddBlockHandler
) => {
  const scopeKey = resolveScopeKey(scopeId)
  if (!scopeKey) {
    return () => {}
  }

  handlersByScope.set(scopeKey, handler)

  return () => {
    if (handlersByScope.get(scopeKey) === handler) {
      handlersByScope.delete(scopeKey)
    }
  }
}

export const dispatchToolbarAddBlock = (
  request: ToolbarAddBlockRequest,
  scopeId?: string
): boolean => {
  const scopeKey = resolveScopeKey(scopeId)
  if (!scopeKey) return false

  const handler = handlersByScope.get(scopeKey)
  if (!handler) return false

  handler(request)
  return true
}
