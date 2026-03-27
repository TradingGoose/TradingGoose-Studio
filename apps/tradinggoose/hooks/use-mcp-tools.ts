/**
 * Hook for discovering and managing MCP tools
 *
 * This hook provides a unified interface for accessing MCP tools
 * alongside regular platform tools in the tool-input component
 */

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WrenchIcon } from 'lucide-react'
import { createLogger } from '@/lib/logs/console/logger'
import type { McpTool } from '@/lib/mcp/types'
import { createMcpToolId } from '@/lib/mcp/utils'
import { useMcpServersStore } from '@/stores/mcp-servers/store'

const logger = createLogger('useMcpTools')

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
  refreshTools: (forceRefresh?: boolean) => Promise<void>
  getToolsByServer: (serverId: string) => McpToolForUI[]
}

export function useMcpTools(workspaceId: string): UseMcpToolsResult {
  const [mcpTools, setMcpTools] = useState<McpToolForUI[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const normalizedWorkspaceId = workspaceId.trim()

  const servers = useMcpServersStore((state) => state.servers)

  // Track the last fingerprint
  const lastProcessedFingerprintRef = useRef<string>('')

  // Create a stable server fingerprint
  const serversFingerprint = useMemo(() => {
    return servers
      .filter((s) => s.enabled && !s.deletedAt)
      .map((s) => `${s.id}-${s.enabled}-${s.updatedAt}`)
      .sort()
      .join('|')
  }, [servers])

  const refreshTools = useCallback(
    async (forceRefresh = false) => {
      if (!normalizedWorkspaceId) {
        setMcpTools([])
        setError(null)
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        logger.info('Discovering MCP tools', { forceRefresh, workspaceId: normalizedWorkspaceId })

        const response = await fetch(
          `/api/mcp/tools/discover?workspaceId=${encodeURIComponent(
            normalizedWorkspaceId
          )}&refresh=${forceRefresh}`
        )

        if (!response.ok) {
          throw new Error(`Failed to discover MCP tools: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()

        if (!data.success) {
          throw new Error(data.error || 'Failed to discover MCP tools')
        }

        const tools = data.data.tools || []
        const transformedTools = tools.map((tool: McpTool) => ({
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

        setMcpTools(transformedTools)

        logger.info(
          `Discovered ${transformedTools.length} MCP tools from ${data.data.byServer ? Object.keys(data.data.byServer).length : 0} servers`
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to discover MCP tools'
        logger.error('Error discovering MCP tools:', err)
        setError(errorMessage)
        setMcpTools([])
      } finally {
        setIsLoading(false)
      }
    },
    [normalizedWorkspaceId, workspaceId]
  )

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

    refreshTools()
  }, [normalizedWorkspaceId, refreshTools])

  // Refresh tools when servers change
  useEffect(() => {
    if (
      !normalizedWorkspaceId ||
      !serversFingerprint ||
      serversFingerprint === lastProcessedFingerprintRef.current
    ) {
      return
    }

    logger.info('Active servers changed, refreshing MCP tools', {
      serverCount: servers.filter((s) => s.enabled && !s.deletedAt).length,
      fingerprint: serversFingerprint,
    })

    lastProcessedFingerprintRef.current = serversFingerprint
    refreshTools()
  }, [normalizedWorkspaceId, serversFingerprint, refreshTools, servers])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(
      () => {
        if (!isLoading && normalizedWorkspaceId) {
          refreshTools()
        }
      },
      5 * 60 * 1000
    )

    return () => clearInterval(interval)
  }, [isLoading, normalizedWorkspaceId, refreshTools])

  return {
    mcpTools,
    isLoading,
    error,
    refreshTools,
    getToolsByServer,
  }
}
