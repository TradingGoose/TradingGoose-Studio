'use client'

const PREFIX = 'copilot-selection:'
const selectionKey = (channelId: string, workspaceId: string | null | undefined) =>
  `${PREFIX}${JSON.stringify([channelId, workspaceId ?? null])}`

export function rememberCopilotWorkspaceSelection(
  channelId: string,
  workspaceId?: string | null,
  threadId?: string | null
) {
  const key = selectionKey(channelId, workspaceId)
  if (threadId) sessionStorage.setItem(key, threadId)
  else sessionStorage.removeItem(key)
}

export function getCopilotWorkspaceSelection(
  channelId: string,
  workspaceId: string | null | undefined
) {
  return sessionStorage.getItem(selectionKey(channelId, workspaceId)) ?? undefined
}

export function resetCopilotWorkspaceSelectionState() {
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index)
    if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key)
  }
}
