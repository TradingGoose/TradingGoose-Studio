import { devtools } from 'zustand/middleware'
import { createWithEqualityFn as create } from 'zustand/traditional'
import { createLogger } from '@/lib/logs/console/logger'
import { initialState, type McpServersActions, type McpServersState } from './types'

const logger = createLogger('McpServersStore')

export const MCP_TOOLS_CHANGED_EVENT = 'tradinggoose:mcp-tools-changed'

export const useMcpServersStore = create<McpServersState & McpServersActions>()(
  devtools(
    (set) => ({
      ...initialState,

      fetchServers: async (workspaceId: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(`/api/mcp/servers?workspaceId=${workspaceId}`)
          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch servers')
          }

          const listedServers: McpServersState['servers'] = Array.isArray(data.data?.servers)
            ? data.data.servers
            : []
          set({ servers: listedServers, isLoading: false })
          logger.info(
            `Fetched ${data.data?.servers?.length || 0} MCP servers for workspace ${workspaceId}`
          )
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch servers'
          logger.error('Failed to fetch MCP servers:', error)
          set({ error: errorMessage, isLoading: false })
        }
      },

      createServer: async (workspaceId: string, config) => {
        set({ isLoading: true, error: null })

        try {
          const requestBody = {
            ...config,
            workspaceId,
          }

          const response = await fetch('/api/mcp/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to create server')
          }

          const serverId =
            data?.data && typeof data.data.serverId === 'string' ? data.data.serverId : null

          if (!serverId) {
            throw new Error('Failed to create server: missing server id')
          }

          const newServer = {
            ...requestBody,
            id: serverId,
            description: requestBody.description ?? undefined,
            url: requestBody.url ?? undefined,
            command: requestBody.command ?? undefined,
            args: requestBody.args ?? [],
            env: requestBody.env ?? {},
            timeout: requestBody.timeout ?? 30000,
            retries: requestBody.retries ?? 3,
            enabled: requestBody.enabled ?? true,
          }
          set((state) => ({
            servers: [...state.servers, newServer],
            isLoading: false,
          }))

          logger.info(`Created MCP server: ${config.name} in workspace: ${workspaceId}`)
          return newServer
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create server'
          logger.error('Failed to create MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      renameServer: async (workspaceId: string, id: string, name: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(`/api/mcp/servers/${id}?workspaceId=${workspaceId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to rename server')
          }

          const updatedServer = data.data?.server || null
          const nextName = typeof updatedServer?.name === 'string' ? updatedServer.name : name

          set((state) => ({
            servers: state.servers.map((server) =>
              server.id === id && server.workspaceId === workspaceId && nextName
                ? { ...server, name: nextName }
                : server
            ),
            isLoading: false,
          }))

          logger.info(`Renamed MCP server: ${id} in workspace: ${workspaceId}`)
          return updatedServer
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to rename server'
          logger.error('Failed to rename MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      deleteServer: async (workspaceId: string, id: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(
            `/api/mcp/servers?serverId=${id}&workspaceId=${workspaceId}`,
            {
              method: 'DELETE',
            }
          )

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to delete server')
          }

          set((state) => ({
            servers: state.servers.filter((server) => server.id !== id),
            isLoading: false,
          }))

          logger.info(`Deleted MCP server: ${id} from workspace: ${workspaceId}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete server'
          logger.error('Failed to delete MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      refreshServer: async (workspaceId: string, id: string, result) => {
        const refreshedAt = result?.lastToolsRefresh ?? new Date().toISOString()

        set((state) => ({
          servers: state.servers.map((server) =>
            server.id === id && server.workspaceId === workspaceId
              ? {
                  ...server,
                  lastToolsRefresh: refreshedAt,
                  ...(result?.status ? { connectionStatus: result.status } : {}),
                  ...(typeof result?.toolCount === 'number' ? { toolCount: result.toolCount } : {}),
                  ...(result?.lastConnected ? { lastConnected: result.lastConnected } : {}),
                  ...(result ? { lastError: result.error || undefined } : {}),
                }
              : server
          ),
        }))

        logger.info(`Refreshed MCP server: ${id} in workspace: ${workspaceId}`)
      },
    }),
    {
      name: 'mcp-servers-store',
    }
  )
)

export const useEnabledServers = () => {
  return useMcpServersStore((state) =>
    state.servers.filter((server) => !server.deletedAt && server.enabled !== false)
  )
}
