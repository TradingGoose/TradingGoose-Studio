/**
 * Hook for discovering and managing MCP tools
 *
 * This hook provides a unified interface for accessing MCP tools
 * alongside regular platform tools in the tool-input component
 */

import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { WrenchIcon } from 'lucide-react'
import { createLogger } from '@/lib/logs/console/logger'
import type { McpTool } from '@/lib/mcp/types'
import { createMcpToolId, MCP_TOOLS_CHANGED_EVENT } from '@/lib/mcp/utils'
import { useEntityList } from '@/lib/yjs/use-entity-fields'

const logger = createLogger('useMcpTools')
const DISCOVERY_CACHE_MS = 5 * 60 * 1000

export interface McpToolForUI {
  id: string
  name: string
  description?: string
  serverId: string
  serverName: string
  type: 'mcp'
  inputSchema: any
  bgColor: string
  icon: React.ComponentType<any>
}

export interface UseMcpToolsResult {
  mcpTools: McpToolForUI[]
  isLoading: boolean
  error: string | null
  refreshTools: () => Promise<void>
  getToolsByServer: (serverId: string) => McpToolForUI[]
}

const discoveryCache = new Map<string, { expiresAt: number; tools: McpToolForUI[] }>()
const discoveryRequests = new Map<string, Promise<McpToolForUI[]>>()

async function discoverMcpTools(workspaceId: string, serversFingerprint: string, force: boolean) {
  const cacheKey = `${workspaceId}:${serversFingerprint}`
  if (force) {
    discoveryCache.delete(cacheKey)
  } else {
    const pending = discoveryRequests.get(cacheKey)
    if (pending) return pending
  }

  const cached = discoveryCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tools
  }

  const request = fetch(
    `/api/mcp/tools/discover?workspaceId=${encodeURIComponent(workspaceId)}&isDeployedContext=false`
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to discover MCP tools: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      if (!data.success) {
        throw new Error(data.error || 'Failed to discover MCP tools')
      }

      const tools = (data.data.tools || []).map((tool: McpTool) => ({
        id: createMcpToolId(tool.serverId, tool.name),
        name: tool.name,
        description: tool.description,
        serverId: tool.serverId,
        serverName: tool.serverName,
        type: 'mcp' as const,
        inputSchema: tool.inputSchema,
        bgColor: '#6366F1',
        icon: WrenchIcon,
      }))

      if (discoveryRequests.get(cacheKey) === request) {
        discoveryCache.set(cacheKey, { expiresAt: Date.now() + DISCOVERY_CACHE_MS, tools })
      }
      logger.info(`Discovered ${tools.length} MCP tools`)
      return tools
    })
    .finally(() => {
      if (discoveryRequests.get(cacheKey) === request) {
        discoveryRequests.delete(cacheKey)
      }
    })

  discoveryRequests.set(cacheKey, request)
  return request
}

export function useMcpTools(workspaceId: string): UseMcpToolsResult {
  const [mcpTools, setMcpTools] = useState<McpToolForUI[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const normalizedWorkspaceId = workspaceId.trim()

  const {
    members: serverMembers,
    isLoading: isServerListLoading,
    error: serverListError,
  } = useEntityList('mcp_server', normalizedWorkspaceId || null)

  const serversFingerprint = useMemo(() => {
    return serverMembers
      .filter((member) => member.enabled !== false)
      .map((member) => `${member.entityId}:${member.entityName}:${member.updatedAt ?? ''}`)
      .sort()
      .join('|')
  }, [serverMembers])

  const hasEnabledServers = useMemo(
    () => serverMembers.some((member) => member.enabled !== false),
    [serverMembers]
  )

  const loadTools = useCallback(
    async (force = false) => {
      if (!normalizedWorkspaceId) {
        setMcpTools([])
        setError(null)
        setIsLoading(false)
        return
      }

      if (serverListError) {
        setMcpTools([])
        setError(serverListError)
        setIsLoading(false)
        return
      }

      if (isServerListLoading) {
        setMcpTools([])
        setError(null)
        setIsLoading(true)
        return
      }

      if (!hasEnabledServers) {
        setMcpTools([])
        setError(null)
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        logger.info('Discovering MCP tools', { workspaceId: normalizedWorkspaceId })
        setMcpTools(await discoverMcpTools(normalizedWorkspaceId, serversFingerprint, force))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to discover MCP tools'
        logger.error('Error discovering MCP tools:', err)
        setError(errorMessage)
        setMcpTools([])
      } finally {
        setIsLoading(false)
      }
    },
    [
      hasEnabledServers,
      isServerListLoading,
      normalizedWorkspaceId,
      serverListError,
      serversFingerprint,
    ]
  )

  const refreshTools = useCallback(() => loadTools(true), [loadTools])

  const getToolsByServer = useCallback(
    (serverId: string): McpToolForUI[] => {
      return mcpTools.filter((tool) => tool.serverId === serverId)
    },
    [mcpTools]
  )

  useEffect(() => {
    if (!normalizedWorkspaceId) {
      setMcpTools([])
      setError(null)
      setIsLoading(false)
      return
    }

    void loadTools()
  }, [loadTools, normalizedWorkspaceId])

  useEffect(() => {
    if (!normalizedWorkspaceId) return

    const handleToolsChanged = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      if (!workspaceId || workspaceId === normalizedWorkspaceId) {
        void refreshTools()
      }
    }

    window.addEventListener(MCP_TOOLS_CHANGED_EVENT, handleToolsChanged)
    return () => window.removeEventListener(MCP_TOOLS_CHANGED_EVENT, handleToolsChanged)
  }, [normalizedWorkspaceId, refreshTools])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(
      () => {
        if (!isLoading && normalizedWorkspaceId) {
          void loadTools(Boolean(serverListError))
        }
      },
      5 * 60 * 1000
    )

    return () => clearInterval(interval)
  }, [isLoading, loadTools, normalizedWorkspaceId, serverListError])

  return {
    mcpTools,
    isLoading,
    error,
    refreshTools,
    getToolsByServer,
  }
}
