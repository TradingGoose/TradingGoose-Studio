'use client'

import {
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMessages } from 'next-intl'
import type * as Y from 'yjs'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { sanitizeRecord } from '@/lib/utils'
import { getFieldsMap, setEntityField } from '@/lib/yjs/entity-session'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { formatTemplate } from '@/i18n/utils'
import type { WidgetComponentProps } from '@/widgets/types'
import { useMcpEditorActions } from '@/widgets/utils/mcp-editor-actions'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { McpServerForm } from '@/widgets/widgets/_shared/mcp/components/mcp-server-form'
import {
  createDefaultMcpServerFormData,
  type McpServerFormData,
  resolveMcpServerId,
} from '@/widgets/widgets/_shared/mcp/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'

type EditorMcpWidgetBodyProps = WidgetComponentProps
type McpConnectionStatus = 'connected' | 'disconnected' | 'error'

const getStatusClassName = (status?: McpConnectionStatus) => {
  if (status === 'connected') {
    return 'border-green-700 bg-green-500/10 text-green-700'
  }

  if (status === 'error') {
    return 'border-red-200 bg-red-500/10 text-red-700'
  }

  return 'border-border bg-muted text-muted-foreground'
}

const getStatusLabel = (
  status: McpConnectionStatus | undefined,
  copy: {
    connected: string
    error: string
    disconnected: string
  }
) => {
  if (status === 'connected') return copy.connected
  if (status === 'error') return copy.error
  return copy.disconnected
}

function readMcpFormData(doc: Y.Doc | null, fallback: McpServerFormData): McpServerFormData {
  if (!doc) return fallback
  const fields = getFieldsMap(doc)
  return {
    name: fallback.name,
    description: fields.get('description') ?? fallback.description,
    transport: fields.get('transport') ?? fallback.transport,
    url: fields.get('url') ?? fallback.url,
    headers: fields.get('headers') ?? fallback.headers,
    command: fields.get('command') ?? fallback.command,
    args: fields.get('args') ?? fallback.args,
    env: fields.get('env') ?? fallback.env,
    timeout: fields.get('timeout') ?? fallback.timeout,
    retries: fields.get('retries') ?? fallback.retries,
    enabled: fields.get('enabled') ?? fallback.enabled,
  }
}

function useMcpServerYjsFormData(
  doc: Y.Doc | null,
  fallback: McpServerFormData,
  setName: (name: string) => void,
  canEditRef: RefObject<boolean>
): [McpServerFormData, (next: SetStateAction<McpServerFormData>) => void] {
  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const fields = getFieldsMap(doc)
    return (cb: () => void) => {
      fields.observe(cb)
      return () => fields.unobserve(cb)
    }
  }, [doc])
  const read = useCallback(() => readMcpFormData(doc, fallback), [doc, fallback])
  const formData = useYjsSubscription(subscribe, read, fallback)
  const setFormData = useCallback(
    (next: SetStateAction<McpServerFormData>) => {
      if (!doc || !canEditRef.current) return
      const value = typeof next === 'function' ? next(formData) : next
      setName(value.name)
      for (const [key, fieldValue] of Object.entries(value)) {
        if (key === 'name') continue
        setEntityField(doc, key, fieldValue)
      }
    },
    [canEditRef, doc, formData, setName]
  )

  return [formData, setFormData]
}

const refreshServerApi = async (
  serverId: string,
  workspaceId: string,
  fallbackErrorMessage: string
) => {
  const response = await fetch(
    `/api/mcp/servers/${encodeURIComponent(serverId)}/refresh?workspaceId=${encodeURIComponent(
      workspaceId
    )}`,
    { method: 'POST' }
  )

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.error || fallbackErrorMessage)
  }

  return data
}

export function EditorMcpWidgetBody({
  params,
  pairColor = 'gray',
  context,
  panelId,
  widget,
  onWidgetLinkedParamsPatch,
}: EditorMcpWidgetBodyProps) {
  const copy = useMessages().workspace.widgets.mcpEditor
  const workspaceId = context?.workspaceId ?? null
  const canEditEntity = context?.canWrite !== false
  const canEditRef = useLatestRef(canEditEntity)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [identityName, setIdentityName] = useState('')
  const initialFormDataRef = useRef<McpServerFormData>(createDefaultMcpServerFormData())
  const initializedServerIdRef = useRef<string | null>(null)
  const defaultFormData = useMemo(() => createDefaultMcpServerFormData(), [])
  const { refreshTools, getToolsByServer } = useMcpTools(workspaceId ?? '')
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()
  const {
    members: serverMembers,
    isLoading: isServerListLoading,
    error: serverListError,
  } = useEntityList('mcp_server', workspaceId)

  const requestedServerId = resolveMcpServerId({
    params,
  })
  const requestedServerMember = requestedServerId
    ? serverMembers.find((member) => member.entityId === requestedServerId)
    : null
  const selectedServerId = resolveEntityIdFromList({
    requestedEntityId: requestedServerId,
    entityIds: serverMembers.map((member) => member.entityId),
    useDefaultEntity: false,
  })

  const selectedServerStatus = selectedServerId
    ? serverMembers.find((member) => member.entityId === selectedServerId)?.connectionStatus
    : undefined
  const selectedServerMember =
    serverMembers.find((member) => member.entityId === selectedServerId) ?? null
  const selectedServerTools = selectedServerId ? getToolsByServer(selectedServerId) : []
  const serverSession = useSavedEntityYjsSession(
    'mcp_server',
    selectedServerId,
    workspaceId,
    null,
    context?.canWrite === false ? 'read' : 'write'
  )
  const formFallback = useMemo(
    () => ({ ...defaultFormData, name: identityName }),
    [defaultFormData, identityName]
  )
  const [formDataState, setFormDataState] = useMcpServerYjsFormData(
    serverSession.doc,
    formFallback,
    setIdentityName,
    canEditRef
  )

  useEffect(() => {
    setIdentityName(selectedServerMember?.entityName ?? '')
  }, [selectedServerId, selectedServerMember?.entityName])

  useEffect(() => {
    if (!selectedServerId || !serverSession.doc) {
      initializedServerIdRef.current = null
      initialFormDataRef.current = defaultFormData
      clearTestResult()
      setSaveError(null)
      return
    }

    if (initializedServerIdRef.current === selectedServerId) {
      return
    }

    initializedServerIdRef.current = selectedServerId
    initialFormDataRef.current = formDataState
    clearTestResult()
    setSaveError(null)
  }, [clearTestResult, defaultFormData, formDataState, selectedServerId, serverSession.doc])

  const handleClose = useCallback(() => {
    onWidgetLinkedParamsPatch?.({ mcpServerId: null })
  }, [onWidgetLinkedParamsPatch])

  const handleResetForm = useCallback(() => {
    if (!canEditRef.current) return
    setFormDataState(initialFormDataRef.current)
    clearTestResult()
    setSaveError(null)
  }, [canEditRef, clearTestResult, setFormDataState])

  const handleTestConnection = useCallback(async () => {
    if (!canEditRef.current || !workspaceId || !selectedServerId || !formDataState.url?.trim()) {
      return
    }

    await testConnection({
      name: formDataState.name.trim() || copy.unnamedServer,
      transport: formDataState.transport,
      url: formDataState.url,
      headers: sanitizeRecord(formDataState.headers),
      timeout: formDataState.timeout,
      workspaceId,
    })
  }, [canEditRef, copy.unnamedServer, formDataState, selectedServerId, testConnection, workspaceId])

  const handleRefreshTools = useCallback(async () => {
    if (
      !workspaceId ||
      !selectedServerId ||
      !canEditRef.current ||
      formDataState.enabled === false ||
      !formDataState.url?.trim()
    ) {
      return
    }

    try {
      await refreshServerApi(selectedServerId, workspaceId, copy.failedToRefreshMcpServer)
      if (!canEditRef.current) return
      await refreshTools()
    } catch (refreshError) {
      console.error('Failed to refresh MCP server tools', refreshError)
      if (canEditRef.current) setSaveError(copy.failedToRefreshMcpServer)
    }
  }, [
    copy.failedToRefreshMcpServer,
    canEditRef,
    formDataState.enabled,
    formDataState.url,
    refreshTools,
    selectedServerId,
    workspaceId,
  ])

  const handleSave = useCallback(async () => {
    if (!canEditRef.current || !workspaceId || !selectedServerId || !serverSession.doc) return

    if (!formDataState.name.trim()) {
      setSaveError(copy.serverNameRequired)
      return
    }

    setSaveError(null)

    try {
      if (!canEditRef.current) return
      await serverSession.save(
        formDataState.name.trim() !== selectedServerMember?.entityName
          ? formDataState.name.trim()
          : undefined
      )
      if (!canEditRef.current) return
      initialFormDataRef.current = formDataState
      if (formDataState.enabled === false || !formDataState.url?.trim()) {
        await refreshTools()
      } else {
        await handleRefreshTools()
      }
    } catch (error) {
      console.error('Failed to save MCP server', error)
      setSaveError(copy.failedToSaveMcpServer)
    }
  }, [
    copy.failedToSaveMcpServer,
    copy.serverNameRequired,
    canEditRef,
    formDataState,
    handleRefreshTools,
    refreshTools,
    serverSession.doc,
    serverSession.save,
    selectedServerId,
    selectedServerMember?.entityName,
    workspaceId,
  ])

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
    return <WidgetStateMessage message={copy.selectWorkspaceToEdit} />
  }

  if (serverListError && serverMembers.length === 0) {
    return <WidgetStateMessage message={serverListError} />
  }

  if (
    requestedServerId &&
    !isServerListLoading &&
    !serverListError &&
    !requestedServerMember &&
    !selectedServerId
  ) {
    return <WidgetStateMessage message={copy.mcpServerNotFound} />
  }

  if (!selectedServerId && isServerListLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!selectedServerId) {
    return (
      <WidgetStateMessage
        message={pairColor !== 'gray' ? copy.noSharedMcpServerSelected : copy.selectServerToEdit}
      />
    )
  }

  if (serverSession.error) {
    return <WidgetStateMessage message={serverSession.error} />
  }

  if (serverSession.isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  const displayStatus: McpConnectionStatus = testResult
    ? testResult.success
      ? 'connected'
      : 'error'
    : selectedServerStatus === 'connected' || selectedServerStatus === 'error'
      ? selectedServerStatus
      : 'disconnected'

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <div className='flex-1 space-y-5 overflow-auto p-5'>
        <div className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-medium text-foreground text-sm'>
              {formDataState.name.trim() || copy.unnamedServer}
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
        </div>

        <McpServerForm
          formData={formDataState}
          setFormData={setFormDataState}
          testResult={testResult}
          isTestingConnection={isTestingConnection}
          workspaceId={workspaceId}
          clearTestResult={clearTestResult}
          disabled={!canEditEntity}
          className='p-5'
        />

        <div className='space-y-3 rounded-md'>
          <div className='flex items-center justify-between'>
            <p className='text-muted-foreground text-xs uppercase tracking-wide'>{copy.tools}</p>
            <span className='text-muted-foreground text-xs'>
              {formatTemplate(copy.toolCount, { count: selectedServerTools.length })}
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
              {copy.noToolsDiscovered}
            </div>
          )}
        </div>

        {saveError ? (
          <div className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
            {saveError}
          </div>
        ) : null}
      </div>
    </div>
  )
}
