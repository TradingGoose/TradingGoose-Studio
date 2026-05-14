'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useMcpEditorActions } from '@/widgets/utils/mcp-editor-actions'
import { useMcpSelectionPersistence } from '@/widgets/utils/mcp-selection'
import { McpServerForm } from '@/widgets/widgets/_shared/mcp/components/mcp-server-form'
import {
  createDefaultMcpServerFormData,
  createFormDataFromServer,
  createMcpSavePayload,
  type McpServerFormData,
  resolveMcpServerId,
} from '@/widgets/widgets/_shared/mcp/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'

type EditorMcpWidgetBodyProps = WidgetComponentProps

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
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const [formDataState, setFormDataState] = useState<McpServerFormData>(() =>
    createDefaultMcpServerFormData()
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const initialFormDataRef = useRef<McpServerFormData>(createDefaultMcpServerFormData())
  const initializedServerIdRef = useRef<string | null>(null)
  const {
    servers,
    isLoading: isServersLoading,
    error: serverError,
    fetchServers,
    refreshServer,
    updateServer,
  } = useMcpServersStore((state) => ({
    servers: state.servers,
    isLoading: state.isLoading,
    error: state.error,
    fetchServers: state.fetchServers,
    refreshServer: state.refreshServer,
    updateServer: state.updateServer,
  }))
  const { refreshTools, getToolsByServer } = useMcpTools(workspaceId ?? '')
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  const selectedServerId = resolveMcpServerId({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
  })

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
  const selectedServer = selectedServerId
    ? (workspaceServers.find((server) => server.id === selectedServerId) ?? null)
    : null
  const selectedServerTools = selectedServerId ? getToolsByServer(selectedServerId) : []

  useEffect(() => {
    if (!workspaceId) return

    fetchServers(workspaceId).catch((fetchError) => {
      console.error('Failed to load MCP servers for editor widget', fetchError)
    })
  }, [fetchServers, workspaceId])

  useEffect(() => {
    if (!selectedServer) {
      initializedServerIdRef.current = null
      const emptyForm = createDefaultMcpServerFormData()
      initialFormDataRef.current = emptyForm
      setFormDataState(emptyForm)
      clearTestResult()
      setSaveError(null)
      return
    }

    if (initializedServerIdRef.current === selectedServer.id) {
      return
    }

    const nextForm = createFormDataFromServer(selectedServer)
    initializedServerIdRef.current = selectedServer.id
    initialFormDataRef.current = nextForm
    setFormDataState(nextForm)
    clearTestResult()
    setSaveError(null)
  }, [clearTestResult, selectedServer])

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

  const handleClose = useCallback(() => {
    if (isLinkedToColorPair) {
      setPairContext(resolvedPairColor, { mcpServerId: null })
      return
    }

    onWidgetParamsChange?.(null)
  }, [isLinkedToColorPair, onWidgetParamsChange, resolvedPairColor, setPairContext])

  const handleResetForm = useCallback(() => {
    setFormDataState(initialFormDataRef.current)
    clearTestResult()
    setSaveError(null)
  }, [clearTestResult])

  const handleTestConnection = useCallback(async () => {
    if (!workspaceId || !selectedServerId || !formDataState.url?.trim()) return

    await testConnection({
      name: formDataState.name.trim() || getServerName(selectedServer),
      transport: formDataState.transport,
      url: formDataState.url,
      headers: createMcpSavePayload(formDataState).headers,
      timeout: formDataState.timeout,
      workspaceId,
    })
  }, [formDataState, selectedServer, selectedServerId, testConnection, workspaceId])

  const handleRefreshTools = useCallback(async () => {
    if (!workspaceId || !selectedServerId) return

    try {
      await refreshServerApi(selectedServerId, workspaceId)
      await refreshServer(workspaceId, selectedServerId)
      await refreshTools(true)
      await fetchServers(workspaceId)
    } catch (refreshError) {
      console.error('Failed to refresh MCP server tools', refreshError)
      setSaveError(
        refreshError instanceof Error ? refreshError.message : 'Failed to refresh MCP server.'
      )
    }
  }, [fetchServers, refreshServer, refreshTools, selectedServerId, workspaceId])

  const handleSave = useCallback(async () => {
    if (!workspaceId || !selectedServerId) return

    const payload = createMcpSavePayload(formDataState)
    if (!payload.name) {
      setSaveError('Server name is required.')
      return
    }

    setSaveError(null)

    try {
      await updateServer(workspaceId, selectedServerId, payload)
      initialFormDataRef.current = formDataState
      await fetchServers(workspaceId)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save MCP server.')
    }
  }, [fetchServers, formDataState, selectedServerId, updateServer, workspaceId])

  useMcpEditorActions({
    panelId,
    widget,
    save: handleSave,
    refresh: handleRefreshTools,
    reset: handleResetForm,
    test: handleTestConnection,
    close: handleClose,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to edit MCP servers.' />
  }

  if (serverError && workspaceServers.length === 0 && !isServersLoading) {
    return <WidgetStateMessage message={serverError || 'Failed to load MCP servers.'} />
  }

  if (isServersLoading && workspaceServers.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!selectedServerId) {
    return (
      <WidgetStateMessage
        message={
          isLinkedToColorPair
            ? 'This color has no shared MCP server selected yet.'
            : 'Select an MCP server to edit.'
        }
      />
    )
  }

  if (!selectedServer) {
    return <WidgetStateMessage message='MCP server not found.' />
  }

  const displayStatus = selectedServer.connectionStatus ?? 'disconnected'

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <div className='flex-1 space-y-5 overflow-auto p-5'>
        <div className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-medium text-foreground text-sm'>{getServerName(selectedServer)}</h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-[10px] ${getStatusClassName(displayStatus)}`}
            >
              <span className='h-1.5 w-1.5 rounded-full bg-current opacity-70' />
              {getStatusLabel(displayStatus)}
            </span>
            <span className='rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground'>
              {formDataState.transport.toUpperCase()}
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
          formData={formDataState}
          setFormData={setFormDataState}
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

        {selectedServer.lastError ? (
          <div className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
            <p className='font-medium'>Last error</p>
            <p className='text-destructive/80 text-xs'>{selectedServer.lastError}</p>
          </div>
        ) : null}

        {saveError ? (
          <div className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
            {saveError}
          </div>
        ) : null}
      </div>
    </div>
  )
}
