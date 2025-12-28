'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Search, Server } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Input } from '@/components/ui'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components'
import { createLogger } from '@/lib/logs/console/logger'
import { GlobalNavbarHeader } from '@/global-navbar'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import type { McpToolForUI } from '@/hooks/use-mcp-tools'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import { McpServerModal } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/mcp-server-modal/mcp-server-modal'
import { refreshServerApi } from './components/mcp-refresh-server'
import { McpServerDetails } from './components/mcp-detail'
import { McpServerForm } from './components/mcp-edit'
import { McpServerList } from './components/mcp-list'
import type { McpServerFormData } from './components/types'

const logger = createLogger('McpServers')

const createDefaultFormState = (): McpServerFormData => ({
  name: '',
  transport: 'streamable-http',
  url: '',
  timeout: 30000,
  headers: {},
})

export function McpServers() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const { mcpTools, error: toolsError, refreshTools } = useMcpTools(workspaceId)
  const {
    servers,
    isLoading: serversLoading,
    error: serversError,
    fetchServers,
    updateServer,
    deleteServer,
    refreshServer,
  } = useMcpServersStore()

  const sanitizeHeaders = useCallback(
    (headers?: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(headers || {}).filter(
          ([key, value]) => key.trim() !== '' && value.trim() !== ''
        )
      ),
    []
  )

  const [formMode, setFormMode] = useState<'edit' | null>(null)
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [deletingServers, setDeletingServers] = useState<Set<string>>(new Set())
  const [formData, setFormData] = useState<McpServerFormData>(() => createDefaultFormState())
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [panelLayout, setPanelLayout] = useState<number[] | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [serverPendingDeleteId, setServerPendingDeleteId] = useState<string | null>(null)
  const formContainerRef = useRef<HTMLDivElement>(null)

  // MCP server testing
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  // Loading state for saving server changes
  const [isSavingServer, setIsSavingServer] = useState(false)
  const [isRefreshingTools, setIsRefreshingTools] = useState(false)
  const resetFormState = useCallback(() => {
    setFormData(createDefaultFormState())
    clearTestResult()
  }, [clearTestResult])

  const closeForm = useCallback(() => {
    setFormMode(null)
    setEditingServerId(null)
    resetFormState()
  }, [resetFormState])

  const handleStartCreate = useCallback(() => {
    setIsCreateModalOpen(true)
    setFormMode(null)
    setEditingServerId(null)
    resetFormState()
  }, [resetFormState])

  const handleStartEdit = useCallback(
    (server: McpServerWithStatus) => {
      setFormMode('edit')
      setEditingServerId(server.id)
      setSelectedServerId(server.id)
      setFormData({
        name: server.name || '',
        transport: server.transport || 'streamable-http',
        url: server.url || '',
        timeout: server.timeout ?? 30000,
        headers: { ...(server.headers || {}) },
      })
    },
    []
  )

  const handleSelectServer = useCallback(
    (serverId: string | null) => {
      setSelectedServerId(serverId)
      setFormMode(null)
      setEditingServerId(null)
      resetFormState()
    },
    [resetFormState]
  )

  const handleTestConnection = useCallback(async () => {
    if (!workspaceId || !formData.name.trim() || !formData.url?.trim()) return

    await testConnection({
      name: formData.name,
      transport: formData.transport,
      url: formData.url,
      headers: sanitizeHeaders(formData.headers),
      timeout: formData.timeout,
      workspaceId,
    })
  }, [formData, testConnection, workspaceId, sanitizeHeaders])

  const handleUpdateServer = useCallback(async () => {
    if (!workspaceId || !editingServerId || !formData.name.trim()) return

    setIsSavingServer(true)
    try {
      // validate connection before saving if needed
      if (!testResult) {
        await testConnection({
          name: formData.name,
          transport: formData.transport,
          url: formData.url,
          headers: sanitizeHeaders(formData.headers),
          timeout: formData.timeout,
          workspaceId,
        })
      }

      await updateServer(workspaceId, editingServerId, {
        name: formData.name.trim(),
        transport: formData.transport,
        url: formData.url,
        timeout: formData.timeout || 30000,
        headers: sanitizeHeaders(formData.headers),
      })

      closeForm()
      refreshTools(true)
      logger.info(`Updated MCP server: ${editingServerId}`)
    } catch (error) {
      logger.error('Failed to update MCP server:', error)
    } finally {
      setIsSavingServer(false)
    }
  }, [
    workspaceId,
    editingServerId,
    formData,
    testResult,
    testConnection,
    updateServer,
    closeForm,
    refreshTools,
  ])

  const handleRemoveServer = useCallback(
    async (serverId: string) => {
      if (!workspaceId) return
      // Add server to deleting set
      setDeletingServers((prev) => new Set(prev).add(serverId))

      try {
        await deleteServer(workspaceId, serverId)
        await refreshTools(true) // Force refresh after removing server

        if (editingServerId === serverId) {
          closeForm()
        }
        if (selectedServerId === serverId) {
          setSelectedServerId(null)
        }

        logger.info(`Removed MCP server: ${serverId}`)
      } catch (error) {
        logger.error('Failed to remove MCP server:', error)
        // Remove from deleting set on error so user can try again
        setDeletingServers((prev) => {
          const newSet = new Set(prev)
          newSet.delete(serverId)
          return newSet
        })
      } finally {
        // Remove from deleting set after successful deletion
        setDeletingServers((prev) => {
          const newSet = new Set(prev)
          newSet.delete(serverId)
          return newSet
        })
      }
    },
    [deleteServer, refreshTools, workspaceId, editingServerId, closeForm, selectedServerId]
  )

  const confirmDeleteServer = useCallback(async () => {
    if (!serverPendingDeleteId) return
    await handleRemoveServer(serverPendingDeleteId)
    setServerPendingDeleteId(null)
  }, [handleRemoveServer, serverPendingDeleteId])

  const handleCloseDetails = useCallback(() => {
    setSelectedServerId(null)
    setEditingServerId(null)
    setFormMode(null)
    resetFormState()
  }, [resetFormState])

  const handleRefreshTools = useCallback(async () => {
    if (!workspaceId) return
    setIsRefreshingTools(true)
    try {
      await refreshTools(true)
      if (selectedServerId) {
        try {
          await refreshServerApi(selectedServerId, workspaceId)
          await refreshServer(workspaceId, selectedServerId)
        } catch (error) {
          logger.error('Failed to refresh server via API', error)
        }
      }
    } finally {
      setIsRefreshingTools(false)
    }
  }, [refreshTools, refreshServer, workspaceId, selectedServerId])

  // Load data on mount only
  useEffect(() => {
    if (!workspaceId) return
    fetchServers(workspaceId)
    refreshTools() // Don't force refresh on mount
  }, [fetchServers, refreshTools, workspaceId])

  useEffect(() => {
    if (!servers || servers.length === 0) {
      setSelectedServerId(null)
      return
    }

    if (selectedServerId && !servers.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(null)
    }
  }, [servers, selectedServerId])

  useEffect(() => {
    if (formMode && formContainerRef.current) {
      formContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [formMode])

  const toolsByServer = (mcpTools || []).reduce<Record<string, McpToolForUI[]>>((acc, tool) => {
    if (!tool || !tool.serverId) {
      return acc // Skip invalid tools
    }
    if (!acc[tool.serverId]) {
      acc[tool.serverId] = []
    }
    acc[tool.serverId].push(tool)
    return acc
  }, {})

  // Filter servers based on search term
  const filteredServers = (servers || []).filter((server) =>
    server.name?.toLowerCase().includes(searchTerm.toLowerCase())
  )
  const hasServers = Array.isArray(servers) && servers.length > 0
  const showNoResults = hasServers && searchTerm.trim().length > 0 && filteredServers.length === 0
  const selectedServer =
    selectedServerId && Array.isArray(servers)
      ? servers.find((server) => server.id === selectedServerId) || null
      : null
  const selectedServerTools = selectedServer ? toolsByServer[selectedServer.id] || [] : []
  const pendingDeleteServer =
    serverPendingDeleteId && Array.isArray(servers)
      ? servers.find((server) => server.id === serverPendingDeleteId) || null
      : null
  const isPendingServerDeleting =
    serverPendingDeleteId && deletingServers ? deletingServers.has(serverPendingDeleteId) : false
  const showDetailsPanel = Boolean(selectedServer)
  const leftPanelSize = panelLayout?.[0] ?? 60
  const rightPanelSize = panelLayout?.[1] ?? 40
  const isEditingSelected =
    formMode === 'edit' && selectedServer && editingServerId === selectedServer.id
  const isSaveDisabled =
    serversLoading || isSavingServer || !formData.name.trim() || !formData.url?.trim()

  const headerLeftContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <Server className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>MCP Servers</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search servers...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>
    </div>
  )

  const headerRightContent = (
    <PrimaryButton onClick={handleStartCreate} disabled={serversLoading}>
      <Plus className='h-3.5 w-3.5' />
      <span>Add Server</span>
    </PrimaryButton>
  )

  const editFormContent =
    isEditingSelected && selectedServer ? (
      <McpServerForm
        mode='edit'
        formData={formData}
        setFormData={setFormData}
        testResult={testResult}
        isTestingConnection={isTestingConnection}
        onTestConnection={handleTestConnection}
        onSubmit={handleUpdateServer}
        onCancel={closeForm}
        isSaving={isSavingServer}
        serversLoading={serversLoading}
        workspaceId={workspaceId}
        clearTestResult={clearTestResult}
        showSaveButton={false}
        formRef={formContainerRef}
        className='p-5'
      />
    ) : null

  const listContent = (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-auto'>
        <McpServerList
          serversLoading={serversLoading}
          toolsError={toolsError}
          serversError={serversError}
          hasServers={hasServers}
          filteredServers={filteredServers}
          toolsByServer={toolsByServer}
          deletingServers={deletingServers}
          selectedServerId={selectedServerId}
          onSelectServer={handleSelectServer}
          onEdit={handleStartEdit}
          onDelete={(serverId) => setServerPendingDeleteId(serverId)}
          showNoResults={showNoResults}
          searchTerm={searchTerm}
          onStartCreate={handleStartCreate}
        />
      </div>
    </div>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeftContent} right={headerRightContent} />
      <div className='flex h-full flex-col'>
        <div className='flex flex-1 overflow-hidden'>
          {showDetailsPanel ? (
            <ResizablePanelGroup
              direction='horizontal'
              className='flex flex-1 overflow-hidden'
              onLayout={(sizes) => setPanelLayout(sizes)}
            >
              <ResizablePanel
                order={1}
                defaultSize={leftPanelSize}
                minSize={45}
                className='flex min-h-0 min-w-0 flex-col overflow-hidden'
              >
                {listContent}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                order={2}
                defaultSize={rightPanelSize}
                minSize={30}
                className='min-h-0 min-w-0 overflow-hidden p-3'
              >
        <McpServerDetails
          server={selectedServer}
          tools={selectedServerTools}
          onEdit={handleStartEdit}
          onClosePanel={handleCloseDetails}
          onRefreshTools={handleRefreshTools}
          isRefreshing={isRefreshingTools}
          isEditing={Boolean(isEditingSelected)}
          onSave={handleUpdateServer}
          isSaving={isSavingServer}
          disableSave={isSaveDisabled}
          formContent={editFormContent}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            listContent
          )}
        </div>
      </div>

      <McpServerModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onServerCreated={(newServerId) => {
          if (newServerId) {
            setSelectedServerId(newServerId)
          }
          refreshTools(true)
        }}
        blockId='mcp-servers-page'
        workspaceId={workspaceId}
      />

      <AlertDialog
        open={Boolean(serverPendingDeleteId)}
        onOpenChange={(open) => {
          if (!open) setServerPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MCP Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className='font-medium text-foreground'>
                {pendingDeleteServer?.name || 'this server'}
              </span>
              ? <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPendingServerDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteServer}
              disabled={isPendingServerDeleting}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isPendingServerDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

}
