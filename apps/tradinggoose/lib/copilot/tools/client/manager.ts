const instances = new Map<string, any>()

let syncStateFn: ((toolCallId: string, nextState: any, options?: { result?: any }) => void) | null =
  null

export function registerClientTool(toolCallId: string, instance: any) {
  if (instances.get(toolCallId) === instance) return
  if (instances.has(toolCallId)) {
    unregisterClientTool(toolCallId)
  }
  instances.set(toolCallId, instance)
}

export function getClientTool(toolCallId: string): any | undefined {
  return instances.get(toolCallId)
}

export function unregisterClientTool(toolCallId: string) {
  const instance = instances.get(toolCallId)
  instances.delete(toolCallId)

  try {
    instance?.dispose?.()
  } catch {}
}

export function disposeClientToolsExcept(retainedToolCallIds: ReadonlySet<string>) {
  for (const toolCallId of instances.keys()) {
    if (!retainedToolCallIds.has(toolCallId)) {
      unregisterClientTool(toolCallId)
    }
  }
}

export function disposeAllClientTools() {
  disposeClientToolsExcept(new Set())
}

export function registerToolStateSync(
  fn: (toolCallId: string, nextState: any, options?: { result?: any }) => void
) {
  syncStateFn = fn
}

export function syncToolState(toolCallId: string, nextState: any, options?: { result?: any }) {
  syncStateFn?.(toolCallId, nextState, options)
}
