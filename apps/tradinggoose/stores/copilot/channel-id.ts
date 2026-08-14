const COPILOT_WORKSPACE_CHANNEL_PREFIX = 'copilot:user:'
const COPILOT_WORKSPACE_CHANNEL_SEPARATOR = ':workspace:'

interface CopilotWorkspaceChannelIdentity {
  authenticatedUserId: string
  workspaceId: string
}

export function buildCopilotWorkspaceChannelId({
  authenticatedUserId,
  workspaceId,
}: CopilotWorkspaceChannelIdentity) {
  if (!authenticatedUserId || !workspaceId) {
    throw new Error('Copilot workspace channels require authenticated user and workspace IDs')
  }

  return `${COPILOT_WORKSPACE_CHANNEL_PREFIX}${encodeURIComponent(authenticatedUserId)}${COPILOT_WORKSPACE_CHANNEL_SEPARATOR}${encodeURIComponent(workspaceId)}`
}

export function parseCopilotWorkspaceChannelId(
  channelId: string
): CopilotWorkspaceChannelIdentity | null {
  if (!channelId.startsWith(COPILOT_WORKSPACE_CHANNEL_PREFIX)) {
    return null
  }

  const encodedIdentity = channelId.slice(COPILOT_WORKSPACE_CHANNEL_PREFIX.length)
  const separatorIndex = encodedIdentity.indexOf(COPILOT_WORKSPACE_CHANNEL_SEPARATOR)
  if (separatorIndex <= 0) {
    return null
  }

  const encodedUserId = encodedIdentity.slice(0, separatorIndex)
  const encodedWorkspaceId = encodedIdentity.slice(
    separatorIndex + COPILOT_WORKSPACE_CHANNEL_SEPARATOR.length
  )
  if (!encodedWorkspaceId) {
    return null
  }

  try {
    const authenticatedUserId = decodeURIComponent(encodedUserId)
    const workspaceId = decodeURIComponent(encodedWorkspaceId)
    return authenticatedUserId && workspaceId ? { authenticatedUserId, workspaceId } : null
  } catch {
    return null
  }
}
