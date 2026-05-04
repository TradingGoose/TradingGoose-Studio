'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useLocale } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ENTITY_KIND_MCP_SERVER, type ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import {
  useEntitySession,
} from '@/lib/copilot/review-sessions/entity-session-host'
import { useYjsBooleanField, useYjsField, useYjsNumberField, useYjsStringField } from '@/lib/yjs/use-entity-fields'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import type { WidgetComponentProps } from '@/widgets/types'
import { useMcpEditorActions } from '@/widgets/utils/mcp-editor-actions'
import { useMcpSelectionPersistence } from '@/widgets/utils/mcp-selection'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { McpServerForm } from '@/widgets/widgets/_shared/mcp/components/mcp-server-form'
import {
  buildPersistedPairContext,
  buildPersistedReviewParams,
  createMcpSavePayload,
  type McpServerFormData,
  readEntitySelectionState,
} from '@/widgets/widgets/_shared/mcp/utils'
import {
  EntityEditorShell,
  type EntityEditorShellConfig,
} from '@/widgets/widgets/components/entity-editor-shell'
import { useGuardedUndoRedo } from '@/widgets/widgets/entity_review/use-guarded-undo-redo'
import { getPublicCopy, formatTemplate } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

type EditorMcpWidgetBodyProps = WidgetComponentProps

const getServerName = (server?: Pick<McpServerWithStatus, 'name'> | null, fallback = 'Unnamed server') =>
  server?.name?.trim() || fallback

const formatRelativeTime = (dateString: string | undefined, locale: LocaleCode) => {
  if (!dateString) return null
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (diffInSeconds < 60) return formatter.format(0, 'second')
  if (diffInSeconds < 3600) return formatter.format(-Math.floor(diffInSeconds / 60), 'minute')
  if (diffInSeconds < 86400) return formatter.format(-Math.floor(diffInSeconds / 3600), 'hour')
  if (diffInSeconds < 604800) return formatter.format(-Math.floor(diffInSeconds / 86400), 'day')
  if (diffInSeconds < 2592000)
    return formatter.format(-Math.floor(diffInSeconds / 604800), 'week')
  if (diffInSeconds < 31536000)
    return formatter.format(-Math.floor(diffInSeconds / 2592000), 'month')
  return formatter.format(-Math.floor(diffInSeconds / 31536000), 'year')
}

const getStatusClassName = (status?: McpServerWithStatus['connectionStatus'] | 'draft') => {
  if (status === 'connected') {
    return 'border-green-700 bg-green-500/10 text-green-700'
  }

  if (status === 'error') {
    return 'border-red-200 bg-red-500/10 text-red-700'
  }

  if (status === 'draft') {
    return 'border-border bg-muted text-muted-foreground'
  }

  return 'border-border bg-muted text-muted-foreground'
}

const getStatusLabel = (
  status: McpServerWithStatus['connectionStatus'] | 'draft' | undefined,
  copy: Pick<
    ReturnType<typeof getPublicCopy>['workspace']['widgets']['mcpEditor'],
    'connected' | 'error' | 'draft' | 'disconnected'
  >
) => {
  if (status === 'connected') return copy.connected
  if (status === 'error') return copy.error
  if (status === 'draft') return copy.draft
  return copy.disconnected
}

const refreshServerApi = async (
  serverId: string,
  workspaceId: string,
  fallbackMessage: string
) => {
  const response = await fetch(
    `/api/mcp/servers/${encodeURIComponent(serverId)}/refresh?workspaceId=${encodeURIComponent(
      workspaceId
    )}`,
    { method: 'POST' }
  )

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.error || fallbackMessage)
  }

  return data
}

const MCP_SHELL_BASE_CONFIG: Omit<
  EntityEditorShellConfig,
  'noWorkspaceMessage' | 'noSelectionMessage'
> = {
  entityKind: ENTITY_KIND_MCP_SERVER,
  fallbackWidgetKey: 'editor_mcp',
  legacyIdKey: 'mcpServerId',
  buildWidgetParams: buildPersistedReviewParams,
  buildPairContext: buildPersistedPairContext,
  readEntitySelectionState,
}

export function EditorMcpWidgetBody(props: EditorMcpWidgetBodyProps) {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.widgets.mcpEditor
  const shellConfig: EntityEditorShellConfig = {
    ...MCP_SHELL_BASE_CONFIG,
    noWorkspaceMessage: copy.selectWorkspaceToEdit,
    noSelectionMessage: copy.selectServerToEdit,
  }

  return (
    <EntityEditorShell
      {...props}
      config={shellConfig}
      useSelectionPersistence={({
        resolvedPairColor,
        isLinkedToColorPair,
        pairContext,
        setPairContext,
        onWidgetParamsChange,
        panelId,
        params,
      }) => {
        useMcpSelectionPersistence({
          onWidgetParamsChange,
          panelId,
          params,
          pairColor: resolvedPairColor,
          scopeKey: 'editor_mcp',
          onServerSelect: (serverId) => {
            if (!isLinkedToColorPair) {
              return
            }

            if (pairContext?.mcpServerId === serverId) {
              return
            }

            setPairContext(
              resolvedPairColor,
              buildPersistedPairContext({
                existing: pairContext,
                legacyIdKey: 'mcpServerId',
                descriptor: null,
                legacyEntityId: serverId,
              })
            )
          },
        })
      }}
    >
      {({ workspaceId, descriptor, persistDescriptor, panelId, widget }) => (
        <McpEditorSession
          workspaceId={workspaceId}
          panelId={panelId}
          widget={widget}
          descriptor={descriptor}
          onReviewTargetChange={persistDescriptor}
        />
      )}
    </EntityEditorShell>
  )
}

function McpEditorSession({
  workspaceId,
  panelId,
  widget,
  descriptor,
  onReviewTargetChange,
}: {
  workspaceId: string
  panelId?: string
  widget?: WidgetComponentProps['widget']
  descriptor: ReviewTargetDescriptor
  onReviewTargetChange: (descriptor: ReviewTargetDescriptor | null) => void
}) {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.widgets.mcpEditor
  const { doc, isLoading, error, undo, redo, runtime, canUndo, canRedo } = useEntitySession()
  const [saveError, setSaveError] = useState<string | null>(null)
  const {
    servers,
    isLoading: isServersLoading,
    error: serverError,
    fetchServers,
    refreshServer,
  } = useMcpServersStore((state) => ({
    servers: state.servers,
    isLoading: state.isLoading,
    error: state.error,
    fetchServers: state.fetchServers,
    refreshServer: state.refreshServer,
  }))
  const { refreshTools, getToolsByServer } = useMcpTools(workspaceId)
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()
  const { handleUndo, handleRedo } = useGuardedUndoRedo({ runtime, undo, redo, canUndo, canRedo })

  const [yjsName, setYjsName] = useYjsStringField(doc, 'name', '')
  const [yjsDescription, setYjsDescription] = useYjsStringField(doc, 'description', '')
  const [yjsTransport, setYjsTransport] = useYjsStringField(doc, 'transport', 'streamable-http')
  const [yjsUrl, setYjsUrl] = useYjsStringField(doc, 'url', '')
  const [yjsHeaders, setYjsHeaders] = useYjsField<Record<string, string>>(doc, 'headers', {})
  const [yjsCommand, setYjsCommand] = useYjsStringField(doc, 'command', '')
  const [yjsArgs, setYjsArgs] = useYjsField<string[]>(doc, 'args', [])
  const [yjsEnv, setYjsEnv] = useYjsField<Record<string, string>>(doc, 'env', {})
  const [yjsTimeout, setYjsTimeout] = useYjsNumberField(doc, 'timeout', 30000)
  const [yjsRetries, setYjsRetries] = useYjsNumberField(doc, 'retries', 3)
  const [yjsEnabled, setYjsEnabled] = useYjsBooleanField(doc, 'enabled', true)

  const yjsFormData = useMemo(
    (): McpServerFormData => ({
      name: yjsName,
      description: yjsDescription,
      transport: yjsTransport as McpServerFormData['transport'],
      url: yjsUrl,
      headers: yjsHeaders,
      command: yjsCommand,
      args: yjsArgs,
      env: yjsEnv,
      timeout: yjsTimeout,
      retries: yjsRetries,
      enabled: yjsEnabled,
    }),
    [
      yjsArgs,
      yjsCommand,
      yjsDescription,
      yjsEnabled,
      yjsEnv,
      yjsHeaders,
      yjsName,
      yjsRetries,
      yjsTimeout,
      yjsTransport,
      yjsUrl,
    ]
  )

  const [formDataState, setFormDataState] = useState<McpServerFormData>(() => yjsFormData)
  const initialFormDataRef = useRef<McpServerFormData>(yjsFormData)
  const initializedSessionRef = useRef<string | null>(null)

  useEffect(() => {
    setFormDataState(yjsFormData)
    if (initializedSessionRef.current !== descriptor.reviewSessionId) {
      initialFormDataRef.current = yjsFormData
      initializedSessionRef.current = descriptor.reviewSessionId
      clearTestResult()
      setSaveError(null)
    }
  }, [clearTestResult, descriptor.reviewSessionId, yjsFormData])

  const setFormData = useCallback<Dispatch<SetStateAction<McpServerFormData>>>(
    (next) => {
      setFormDataState((previous) => {
        const resolved = typeof next === 'function' ? next(previous) : next
        setYjsName(resolved.name)
        setYjsDescription(resolved.description)
        setYjsTransport(resolved.transport)
        setYjsUrl(resolved.url)
        setYjsHeaders(resolved.headers)
        setYjsCommand(resolved.command)
        setYjsArgs(resolved.args)
        setYjsEnv(resolved.env)
        setYjsTimeout(resolved.timeout)
        setYjsRetries(resolved.retries)
        setYjsEnabled(resolved.enabled)
        return resolved
      })
    },
    [
      setYjsArgs,
      setYjsCommand,
      setYjsDescription,
      setYjsEnabled,
      setYjsEnv,
      setYjsHeaders,
      setYjsName,
      setYjsRetries,
      setYjsTimeout,
      setYjsTransport,
      setYjsUrl,
    ]
  )

  const workspaceServers = useMemo(
    () =>
      servers
        .filter((server) => server.workspaceId === workspaceId && !server.deletedAt)
        .sort((a, b) => {
          const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '')
          const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '')
          return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
        }),
    [servers, workspaceId]
  )

  const selectedServer = descriptor.entityId
    ? (workspaceServers.find((server) => server.id === descriptor.entityId) ?? null)
    : null
  const selectedServerTools = descriptor.entityId ? getToolsByServer(descriptor.entityId) : []

  useEffect(() => {
    fetchServers(workspaceId).catch((fetchError) => {
      console.error('Failed to load MCP servers for editor widget', fetchError)
    })
  }, [fetchServers, workspaceId])

  const handleResetForm = useCallback(() => {
    setFormData(initialFormDataRef.current)
    clearTestResult()
    setSaveError(null)
  }, [clearTestResult, setFormData])

  const handleTestConnection = useCallback(async () => {
    if (!workspaceId || !descriptor.entityId || !formDataState.url?.trim()) return

    await testConnection({
      name: formDataState.name.trim() || getServerName(selectedServer, copy.unnamedServer),
      transport: formDataState.transport,
      url: formDataState.url,
      headers: createMcpSavePayload(formDataState).headers,
      timeout: formDataState.timeout,
      workspaceId,
    })
  }, [copy.unnamedServer, descriptor.entityId, formDataState, selectedServer, testConnection, workspaceId])

  const handleRefreshTools = useCallback(async () => {
    if (!workspaceId || !descriptor.entityId) return

    try {
      await refreshServerApi(descriptor.entityId, workspaceId, copy.failedToRefreshMcpServer)
      await refreshServer(workspaceId, descriptor.entityId)
      await refreshTools(true)
      await fetchServers(workspaceId)
    } catch (refreshError) {
      console.error('Failed to refresh MCP server tools', refreshError)
      setSaveError(refreshError instanceof Error ? refreshError.message : copy.failedToRefreshMcpServer)
    }
  }, [
    copy.failedToRefreshMcpServer,
    descriptor.entityId,
    fetchServers,
    refreshServer,
    refreshTools,
    workspaceId,
  ])

  const handleSave = useCallback(async () => {
    if (!workspaceId || !descriptor.reviewSessionId) {
      return
    }

    const payload = createMcpSavePayload(formDataState)
    if (!payload.name) {
      setSaveError(copy.serverNameRequired)
      return
    }

    setSaveError(null)

    try {
      const response = await fetch('/api/copilot/review-entities/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityKind: ENTITY_KIND_MCP_SERVER,
          workspaceId,
          reviewSessionId: descriptor.reviewSessionId,
          draftSessionId: descriptor.draftSessionId ?? undefined,
          mcpServer: {
            id: descriptor.entityId ?? undefined,
            ...payload,
          },
        }),
      })

      const responsePayload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(responsePayload?.error || copy.failedToSaveMcpServer)
      }

      await fetchServers(workspaceId)
      if (responsePayload?.reviewTarget) {
        onReviewTargetChange?.(responsePayload.reviewTarget as ReviewTargetDescriptor)
      }
    } catch (saveError) {
      setSaveError(saveError instanceof Error ? saveError.message : copy.failedToSaveMcpServer)
    }
  }, [
    copy.failedToSaveMcpServer,
    copy.serverNameRequired,
    descriptor.draftSessionId,
    descriptor.entityId,
    descriptor.reviewSessionId,
    fetchServers,
    formDataState,
    onReviewTargetChange,
    workspaceId,
  ])

  useMcpEditorActions({
    panelId,
    widget,
    save: handleSave,
    refresh: handleRefreshTools,
    close: () => onReviewTargetChange?.(null),
    reset: handleResetForm,
    test: handleTestConnection,
    undo: handleUndo,
    redo: handleRedo,
  })

  if (isLoading || !doc) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (error) {
    return <WidgetStateMessage message={error} />
  }

  if (serverError && descriptor.entityId && workspaceServers.length === 0 && isServersLoading) {
    return <WidgetStateMessage message={serverError || copy.failedToLoadMcpServers} />
  }

  const displayStatus = descriptor.entityId
    ? selectedServer?.connectionStatus ?? 'disconnected'
    : 'draft'

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <div className='flex-1 space-y-5 overflow-auto p-5'>
        <div className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-medium text-foreground text-sm'>
              {descriptor.entityId
                ? getServerName(selectedServer, copy.unnamedServer)
                : formDataState.name.trim() || copy.draft}
            </h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-[10px] ${getStatusClassName(displayStatus)}`}
            >
              <span className='h-1.5 w-1.5 rounded-full bg-current opacity-70' />
              {getStatusLabel(displayStatus, copy)}
            </span>
            <span className='rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground'>
              {formDataState.transport.toUpperCase()}
            </span>
          </div>
          {descriptor.entityId && selectedServer ? (
            <div className='flex flex-wrap items-center gap-2 text-muted-foreground text-xs'>
              {selectedServer.updatedAt ? (
                <span>
                  {formatTemplate(copy.updated, {
                    time: formatRelativeTime(selectedServer.updatedAt, locale) ?? '',
                  })}
                </span>
              ) : null}
              {selectedServer.lastToolsRefresh ? (
                <span>
                  {formatTemplate(copy.toolsRefreshed, {
                    time: formatRelativeTime(selectedServer.lastToolsRefresh, locale) ?? '',
                  })}
                </span>
              ) : null}
              {selectedServer.lastConnected ? (
                <span>
                  {formatTemplate(copy.lastConnected, {
                    time: formatRelativeTime(selectedServer.lastConnected, locale) ?? '',
                  })}
                </span>
              ) : null}
            </div>
          ) : (
            <p className='text-muted-foreground text-xs'>
              {copy.saveDraftHint}
            </p>
          )}
        </div>

        <McpServerForm
          formData={formDataState}
          setFormData={setFormData}
          testResult={testResult}
          isTestingConnection={isTestingConnection}
          workspaceId={workspaceId}
          clearTestResult={clearTestResult}
          className='p-5'
        />

        <div className='space-y-3 rounded-md'>
          <div className='flex items-center justify-between'>
            <p className='text-muted-foreground text-xs uppercase tracking-wide'>{copy.tools}</p>
            <span className='text-muted-foreground text-xs'>
              {descriptor.entityId
                ? formatTemplate(copy.toolCount, { count: selectedServerTools.length })
                : copy.saveRequired}
            </span>
          </div>

          {descriptor.entityId ? (
            selectedServerTools.length > 0 ? (
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
                {copy.noToolsDiscovered}
              </div>
            )
          ) : (
            <div className='rounded-md border border-dashed px-3 py-4 text-muted-foreground text-sm'>
              {copy.saveThisServerToRefreshAndInspectDiscoveredMcpTools}
            </div>
          )}
        </div>

        {selectedServer?.lastError ? (
          <div className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
            <p className='font-medium'>{copy.lastError}</p>
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
