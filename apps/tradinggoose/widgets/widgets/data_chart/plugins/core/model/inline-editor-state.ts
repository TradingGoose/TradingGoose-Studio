const activeInlineEditorToolIds = new Set<string>()

export const setInlineEditorActiveForTool = (toolId: string, active: boolean): void => {
  if (!toolId) return

  if (active) {
    activeInlineEditorToolIds.add(toolId)
    return
  }

  activeInlineEditorToolIds.delete(toolId)
}

export const isInlineEditorActiveForTool = (toolId: string): boolean => {
  return activeInlineEditorToolIds.has(toolId)
}
