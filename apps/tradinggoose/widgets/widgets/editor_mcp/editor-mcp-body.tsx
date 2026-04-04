'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { cn } from '@/lib/utils'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useMcpEditorActions } from '@/widgets/utils/mcp-editor-actions'
import { emitMcpSelectionChange, useMcpSelectionPersistence } from '@/widgets/utils/mcp-selection'
import { McpServerForm } from '@/widgets/widgets/_shared/mcp/components/mcp-server-form'
import {
  createDefaultMcpServerFormData,
  type McpServerFormData,
  resolveMcpServerId,
} from '@/widgets/widgets/_shared/mcp/utils'

type EditorMcpWidgetBodyProps = WidgetComponentProps

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const sanitizeHeaders = (headers?: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(headers || {}).filter(([key, value]) => key.trim() !== '' && value.trim() !== '')
  )

const getServerName = (server?: Pick<McpServerWithStatus, 'name'> | null) =>
  server?.name?.trim() || 'Unnamed server'

const formatRelativeTime = (dateString?: string) => {
  if (!dateString) return null
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return 'just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 604800)}w ago`
  if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}mo ago`
  return `${Math.floor(diffInSeconds / 31536000)}y ago`
}

const getStatusClassName = (status?: McpServerWithStatus['connectionStatus']) => {
  if (status === 'connected') {
    return 'border-green-700 bg-green-500/10 text-green-700'
  }

  if (status === 'error') {
    return 'border-red-200 bg-red-500/10 text-red-700'
  }

  return 'border-border bg-muted text-muted-foreground'
}

const getStatusLabel = (status?: McpServerWithStatus['connectionStatus']) => {
  if (status === 'connected') return 'Connected'
  if (status === 'error') return 'Error'
  return 'Disconnected'
}

const createFormDataFromServer = (server: McpServerWithStatus): McpServerFormData => ({
  transport: server.transport || 'streamable-http',
  url: server.url || '',
  timeout: server.timeout ?? 30000,
  headers: { ...(server.headers || {}) },
})

const refreshServerApi = async (serverId: string, workspaceId: string) => {
  const response = await fetch(
    `/api/mcp/servers/${encodeURIComponent(serverId)}/refresh?workspaceId=${encodeURIComponent(
      workspaceId
    )}`,
    { method: 'POST' }
  )

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.error || `Failed to refresh server ${serverId}`)
  }

  return data
}

export function EditorMcpWidgetBody({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: EditorMcpWidgetBodyProps) {
  const workspaceId = context?.workspaceId ?? null
  const { servers, isLoading, error, fetchServers, updateServer, refreshServer } =
    useMcpServersStore((state) => ({
      servers: state.servers,
      isLoading: state.isLoading,
      error: state.error,
      fetchServers: state.fetchServers,
      updateServer: state.updateServer,
      refreshServer: state.refreshServer,
    }))
  const { refreshTools, getToolsByServer } = useMcpTools(workspaceId ?? '')
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const [formData, setFormData] = useState<McpServerFormData>(() =>
    createDefaultMcpServerFormData()
  )
  const [hasRequestedLoad, setHasRequestedLoad] = useState(false)
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  const requestedServerId = resolveMcpServerId({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
  })
  const normalizedRequestedServerId = requestedServerId?.trim() ?? ''

  const workspaceServers = useMemo(
    () =>
      workspaceId
        ? servers
          .filter((server) => server.workspaceId === workspaceId && !server.deletedAt)
          .sort((a, b) => {
            const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '')
            const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '')
            return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
          })
        : [],
    [servers, workspaceId]
  )

  const hasRequestedServer =
    normalizedRequestedServerId.length > 0 &&
    workspaceServers.some((server) => server.id === normalizedRequestedServerId)
  const selectedServerId = hasRequestedServer
    ? normalizedRequestedServerId
    : (workspaceServers[0]?.id ?? null)
  const selectedServer = selectedServerId
    ? (workspaceServers.find((server) => server.id === selectedServerId) ?? null)
    : null
  const selectedServerTools = selectedServerId ? getToolsByServer(selectedServerId) : []

  useEffect(() => {
    if (!workspaceId || workspaceServers.length > 0) {
      return
    }

    setHasRequestedLoad(true)
    fetchServers(workspaceId).catch((fetchError) => {
      console.error('Failed to load MCP servers for editor widget', fetchError)
    })
  }, [fetchServers, workspaceId, workspaceServers.length])

  useEffect(() => {
    setHasRequestedLoad(false)
  }, [workspaceId])

  const syncSelection = useCallback(
    (serverId: string | null) => {
      if (isLinkedToColorPair) {
        if (pairContext?.mcpServerId === serverId) return
        setPairContext(resolvedPairColor, { mcpServerId: serverId })
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange?.({
        ...currentParams,
        mcpServerId: serverId,
      })

      emitMcpSelectionChange({
        serverId,
        panelId,
        widgetKey: widget?.key ?? 'editor_mcp',
      })
    },
    [
      isLinkedToColorPair,
      onWidgetParamsChange,
      pairContext?.mcpServerId,
      panelId,
      params,
      resolvedPairColor,
      setPairContext,
      widget?.key,
    ]
  )

  useMcpSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    scopeKey: 'editor_mcp',
    onServerSelect: (serverId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.mcpServerId === serverId) return
      setPairContext(resolvedPairColor, { mcpServerId: serverId })
    },
  })

  useEffect(() => {
    if (!selectedServerId) {
      return
    }

    if (isLinkedToColorPair) {
      if (pairContext?.mcpServerId === selectedServerId) {
        return
      }

      setPairContext(resolvedPairColor, { mcpServerId: selectedServerId })
      return
    }

    if (!onWidgetParamsChange || normalizedRequestedServerId === selectedServerId) {
      return
    }

    onWidgetParamsChange({
      ...(params ?? {}),
      mcpServerId: selectedServerId,
    })
  }, [
    isLinkedToColorPair,
    normalizedRequestedServerId,
    onWidgetParamsChange,
    pairContext?.mcpServerId,
    params,
    resolvedPairColor,
    selectedServerId,
    setPairContext,
  ])

  useEffect(() => {
    if (!selectedServer) {
      setFormData(createDefaultMcpServerFormData())
      clearTestResult()
      return
    }

    setFormData(createFormDataFromServer(selectedServer))
    clearTestResult()
  }, [clearTestResult, selectedServer?.id])

  const handleResetForm = useCallback(() => {
    if (!selectedServer) {
      setFormData(createDefaultMcpServerFormData())
      clearTestResult()
      return
    }

    setFormData(createFormDataFromServer(selectedServer))
    clearTestResult()
  }, [clearTestResult, selectedServer])

  const handleTestConnection = useCallback(async () => {
    if (!workspaceId || !selectedServer || !formData.url?.trim()) return

    await testConnection({
      name: getServerName(selectedServer),
      transport: formData.transport,
      url: formData.url,
      headers: sanitizeHeaders(formData.headers),
      timeout: formData.timeout,
      workspaceId,
    })
  }, [formData, selectedServer, testConnection, workspaceId])

  const handleRefreshTools = useCallback(async () => {
    if (!workspaceId || !selectedServerId) return

    try {
      await refreshServerApi(selectedServerId, workspaceId)
      await refreshServer(workspaceId, selectedServerId)
      await refreshTools(true)
    } catch (refreshError) {
      console.error('Failed to refresh MCP server tools', refreshError)
    }
  }, [refreshServer, refreshTools, selectedServerId, workspaceId])

  const handleUpdateServer = useCallback(async () => {
    if (!workspaceId || !selectedServerId || !selectedServer) return

    try {
      if (!testResult) {
        await testConnection({
          name: getServerName(selectedServer),
          transport: formData.transport,
          url: formData.url,
          headers: sanitizeHeaders(formData.headers),
          timeout: formData.timeout,
          workspaceId,
        })
      }

      await updateServer(workspaceId, selectedServerId, {
        name: getServerName(selectedServer),
        transport: formData.transport,
        url: formData.url,
        timeout: formData.timeout || 30000,
        headers: sanitizeHeaders(formData.headers),
      })

      await handleRefreshTools()
    } catch (saveError) {
      console.error('Failed to update MCP server', saveError)
    }
  }, [
    formData,
    handleRefreshTools,
    selectedServer,
    selectedServerId,
    testConnection,
    testResult,
    updateServer,
    workspaceId,
  ])

  useMcpEditorActions({
    panelId,
    widget,
    onSave: handleUpdateServer,
    onRefresh: handleRefreshTools,
    onClose: () => syncSelection(null),
    onReset: handleResetForm,
    onTest: handleTestConnection,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to edit MCP servers.' />
  }

  if (error && workspaceServers.length === 0) {
    return <WidgetStateMessage message={error || 'Failed to load MCP servers.'} />
  }

  if ((isLoading || !hasRequestedLoad) && workspaceServers.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!selectedServerId) {
    return <WidgetStateMessage message='Select an MCP server to edit.' />
  }

  if (!selectedServer) {
    return <WidgetStateMessage message='MCP server not found.' />
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <div className='flex-1 space-y-5 overflow-auto p-5'>
        <div className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-medium text-foreground text-sm'>{getServerName(selectedServer)}</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-[10px]',
                getStatusClassName(selectedServer.connectionStatus)
              )}
            >
              <span className='h-1.5 w-1.5 rounded-full bg-current opacity-70' />
              {getStatusLabel(selectedServer.connectionStatus)}
            </span>
            <span className='rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground'>
              {selectedServer.transport?.toUpperCase() || 'HTTP'}
            </span>
          </div>
          <div className='flex flex-wrap items-center gap-2 text-muted-foreground text-xs'>
            {selectedServer.updatedAt ? (
              <span>Updated {formatRelativeTime(selectedServer.updatedAt)}</span>
            ) : null}
            {selectedServer.lastToolsRefresh ? (
              <span>Tools refreshed {formatRelativeTime(selectedServer.lastToolsRefresh)}</span>
            ) : null}
            {selectedServer.lastConnected ? (
              <span>Last connected {formatRelativeTime(selectedServer.lastConnected)}</span>
            ) : null}
          </div>
        </div>

        <McpServerForm
          formData={formData}
          setFormData={setFormData}
          testResult={testResult}
          isTestingConnection={isTestingConnection}
          workspaceId={workspaceId}
          clearTestResult={clearTestResult}
          className='p-5'
        />

        <div className='space-y-3 rounded-md'>
          <div className='flex items-center justify-between'>
            <p className='text-muted-foreground text-xs uppercase tracking-wide'>Tools</p>
            <span className='text-muted-foreground text-xs'>
              {selectedServerTools.length} total
            </span>
          </div>

          {selectedServerTools.length > 0 ? (
            <div className='space-y-2'>
              {selectedServerTools.map((tool) => (
                <div key={tool.id} className='rounded-md border bg-secondary/30 p-3'>
                  <p className='font-medium text-foreground text-sm'>{tool.name}</p>
                  {tool.description ? (
                    <p className='mt-1 text-muted-foreground text-xs leading-relaxed'>
                      {tool.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className='rounded-md border border-dashed px-3 py-4 text-muted-foreground text-sm'>
              No tools discovered yet.
            </div>
          )}
        </div>

        {
          selectedServer.lastError ? (
            <div className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
              <p className='font-medium'>Last error</p>
              <p className='text-destructive/80 text-xs'>{selectedServer.lastError}</p>
            </div>
          ) : null
        }
      </div >
    </div >
  )
}
