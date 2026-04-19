'use client'

const workspaceSelectionByScope = new Map<string, string | null>()

export function rememberCopilotWorkspaceSelection(
  workspaceId?: string | null,
  reviewSessionId?: string | null
) {
  workspaceSelectionByScope.set(workspaceId ?? 'global', reviewSessionId ?? null)
}

export function getCopilotWorkspaceSelection(workspaceId: string | null | undefined) {
  return workspaceSelectionByScope.get(workspaceId ?? 'global')
}

export function resetCopilotWorkspaceSelectionState() {
  workspaceSelectionByScope.clear()
}
