'use client'

import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('mcp-refresh-server')

export async function refreshServerApi(serverId: string, workspaceId: string) {
  try {
    const res = await fetch(`/api/mcp/servers/${encodeURIComponent(serverId)}/refresh?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'POST',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.error || `Failed to refresh server ${serverId}`)
    }
    return data
  } catch (error) {
    logger.error('Failed to refresh server via API', error)
    throw error
  }
}
