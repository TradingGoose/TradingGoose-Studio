'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, Wrench } from 'lucide-react'
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
import { GlobalNavbarHeader } from '@/global-navbar'
import { createLogger } from '@/lib/logs/console/logger'
import {
  useCustomTools,
  useDeleteCustomTool,
} from '@/hooks/queries/custom-tools'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store-client'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { CustomToolModal } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal'
import { CustomToolDetails } from './components/custom-tool-detail'
import { CustomToolList } from './components/custom-tool-list'

const logger = createLogger('CustomToolsPage')

export function CustomTools() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const { data: tools = [], isLoading, error, refetch } = useCustomTools(workspaceId)
  const deleteToolMutation = useDeleteCustomTool()

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [panelLayout, setPanelLayout] = useState<number[] | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingToolId, setEditingToolId] = useState<string | null>(null)
  const [toolPendingDeleteId, setToolPendingDeleteId] = useState<string | null>(null)
  const [deletingTools, setDeletingTools] = useState<Set<string>>(new Set())

  const toolsError = error
    ? error instanceof Error
      ? error.message
      : 'Failed to load custom tools'
    : null

  const filteredTools = useMemo(() => {
    if (!searchTerm.trim()) return tools
    const term = searchTerm.toLowerCase()
    return tools.filter((tool) => {
      const name = tool.title || tool.schema?.function?.name || ''
      const description = tool.schema?.function?.description || ''
      return (
        name.toLowerCase().includes(term) ||
        description.toLowerCase().includes(term)
      )
    })
  }, [tools, searchTerm])

  const hasTools = Array.isArray(tools) && tools.length > 0
  const showNoResults = hasTools && searchTerm.trim().length > 0 && filteredTools.length === 0
  const selectedTool =
    selectedToolId && Array.isArray(tools)
      ? tools.find((tool) => tool.id === selectedToolId) || null
      : null
  const pendingDeleteTool =
    toolPendingDeleteId && Array.isArray(tools)
      ? tools.find((tool) => tool.id === toolPendingDeleteId) || null
      : null

  const showDetailsPanel = Boolean(selectedTool)
  const leftPanelSize = panelLayout?.[0] ?? 60
  const rightPanelSize = panelLayout?.[1] ?? 40
  const isEditingSelected =
    Boolean(editingToolId) && Boolean(selectedTool) && editingToolId === selectedTool?.id

  useEffect(() => {
    if (!tools || tools.length === 0) {
      setSelectedToolId(null)
      return
    }

    if (selectedToolId && !tools.some((tool) => tool.id === selectedToolId)) {
      setSelectedToolId(null)
    }
  }, [tools, selectedToolId])

  const handleStartCreate = useCallback(() => {
    setEditingToolId(null)
    setIsModalOpen(true)
  }, [])

  const handleSelectTool = useCallback((toolId: string | null) => {
    setSelectedToolId(toolId)
    setEditingToolId(null)
  }, [])

  const handleEditTool = useCallback((tool: CustomToolDefinition) => {
    setSelectedToolId(tool.id)
    setEditingToolId(tool.id)
    setIsModalOpen(false)
  }, [])

  const handleCloseDetails = useCallback(() => {
    setSelectedToolId(null)
    setEditingToolId(null)
  }, [])

  const handleDeleteTool = useCallback(
    async (toolId: string) => {
      if (!workspaceId) return
      setDeletingTools((prev) => new Set(prev).add(toolId))

      try {
        await deleteToolMutation.mutateAsync({ workspaceId, toolId })
        if (selectedToolId === toolId) {
          setSelectedToolId(null)
        }
        if (editingToolId === toolId) {
          setEditingToolId(null)
        }
        await refetch()
        logger.info(`Deleted custom tool: ${toolId}`)
      } catch (err) {
        logger.error('Failed to delete custom tool:', err)
      } finally {
        setDeletingTools((prev) => {
          const next = new Set(prev)
          next.delete(toolId)
          return next
        })
      }
    },
    [deleteToolMutation, refetch, selectedToolId, workspaceId, editingToolId]
  )

  const confirmDeleteTool = useCallback(async () => {
    if (!toolPendingDeleteId) return
    await handleDeleteTool(toolPendingDeleteId)
    setToolPendingDeleteId(null)
  }, [handleDeleteTool, toolPendingDeleteId])

  const headerLeftContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <Wrench className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Custom Tools</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search custom tools...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>
    </div>
  )

  const headerRightContent = (
    <PrimaryButton onClick={handleStartCreate} disabled={isLoading}>
      <Plus className='h-3.5 w-3.5' />
      <span>Add Tool</span>
    </PrimaryButton>
  )

  const modalInitialValues =
    editingToolId && tools
      ? (() => {
          const tool = tools.find((t) => t.id === editingToolId)
          if (!tool) return undefined
          return {
            id: tool.id,
            schema: tool.schema,
            code: tool.code || '',
          }
        })()
      : undefined

  const inlineFormContent =
    isEditingSelected && selectedTool
      ? (
        <CustomToolModal
          inline
          open={isEditingSelected}
          onOpenChange={(open) => {
            if (!open) {
              setEditingToolId(null)
            }
          }}
          onSave={() => {
            setEditingToolId(null)
            refetch()
          }}
          onDelete={(toolId) => {
            if (selectedToolId === toolId) {
              setSelectedToolId(null)
            }
            setEditingToolId(null)
            refetch()
          }}
          blockId='custom-tools-inline'
          initialValues={{
            id: selectedTool.id,
            schema: selectedTool.schema,
            code: selectedTool.code || '',
          }}
        />
      )
      : null

  const listContent = (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-auto'>
        <CustomToolList
          toolsLoading={isLoading}
          toolsError={toolsError}
          hasTools={hasTools}
          filteredTools={filteredTools}
          selectedToolId={selectedToolId}
          onSelect={(toolId) => handleSelectTool(toolId)}
          onDelete={(toolId) => setToolPendingDeleteId(toolId)}
          showNoResults={showNoResults}
          searchTerm={searchTerm}
          onStartCreate={handleStartCreate}
          deletingTools={deletingTools}
        />
      </div>
    </div>
  )

  const content = (
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
                {isEditingSelected && inlineFormContent ? (
                  <div className='h-full'>{inlineFormContent}</div>
                ) : (
                  <CustomToolDetails
                    tool={selectedTool}
                    onEdit={handleEditTool}
                    onClosePanel={handleCloseDetails}
                    onDelete={(toolId) => setToolPendingDeleteId(toolId)}
                    isDeleting={selectedTool ? deletingTools.has(selectedTool.id) : false}
                    isEditing={Boolean(isEditingSelected)}
                    formContent={inlineFormContent}
                    onCancelEdit={() => setEditingToolId(null)}
                  />
                )}
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            listContent
          )}
        </div>
      </div>

      <CustomToolModal
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open)
          if (!open) {
            setEditingToolId(null)
          }
        }}
        onSave={(_tool) => {
          setIsModalOpen(false)
          setEditingToolId(null)
          refetch()
        }}
        onDelete={(toolId) => {
          if (selectedToolId === toolId) {
            setSelectedToolId(null)
          }
          setEditingToolId(null)
          refetch()
        }}
        blockId='custom-tools-page'
        initialValues={modalInitialValues}
      />

      <AlertDialog
        open={Boolean(toolPendingDeleteId)}
        onOpenChange={(open) => {
          if (!open) setToolPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Tool</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className='font-medium text-foreground'>
                {pendingDeleteTool?.title || pendingDeleteTool?.schema?.function?.name || 'this tool'}
              </span>
              ? <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(toolPendingDeleteId && deletingTools.has(toolPendingDeleteId))}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteTool}
              disabled={Boolean(toolPendingDeleteId && deletingTools.has(toolPendingDeleteId))}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {toolPendingDeleteId && deletingTools.has(toolPendingDeleteId) ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return (
    <WorkflowRouteProvider
      workspaceId={workspaceId}
      workflowId='custom-tools'
      channelId={DEFAULT_WORKFLOW_CHANNEL_ID}
    >
      {content}
    </WorkflowRouteProvider>
  )
}
