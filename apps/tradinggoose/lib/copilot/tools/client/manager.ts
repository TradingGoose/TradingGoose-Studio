const instances = new Map<string, any>()

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
