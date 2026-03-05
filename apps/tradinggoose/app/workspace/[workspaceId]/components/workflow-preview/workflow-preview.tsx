'use client'

import { cn } from '@/lib/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { PreviewWorkflow } from '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-workflow'

interface WorkflowPreviewProps {
  workflowState: WorkflowState
  showSubBlocks?: boolean
  className?: string
  height?: string | number
  width?: string | number
  isPannable?: boolean
  defaultPosition?: { x: number; y: number }
  defaultZoom?: number
  fitPadding?: number
  onNodeClick?: (blockId: string, mousePosition: { x: number; y: number }) => void
  workspaceId?: string
  workflowId?: string
  channelId?: string
}

export function WorkflowPreview({
  workflowState,
  showSubBlocks: _showSubBlocks = true,
  className,
  height = '100%',
  width = '100%',
  isPannable = false,
  defaultPosition,
  defaultZoom = 0.8,
  fitPadding = 0.25,
  onNodeClick,
}: WorkflowPreviewProps) {
  const isValidWorkflowState = workflowState?.blocks && workflowState.edges

  if (!isValidWorkflowState) {
    return (
      <div
        style={{ height, width }}
        className='flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900'
      >
        <div className='text-center text-gray-500 dark:text-gray-400'>
          <div className='mb-2 font-medium text-lg'>⚠️ Logged State Not Found</div>
          <div className='text-sm'>
            This log was migrated from the old system and doesn't contain workflow state data.
          </div>
        </div>
      </div>
    )
  }

  const previewContent = (
    <PreviewWorkflow
      workflowState={workflowState}
      className={cn('preview-mode', className)}
      height={height}
      width={width}
      isPannable={isPannable}
      defaultPosition={defaultPosition}
      defaultZoom={defaultZoom ?? 1}
      fitPadding={fitPadding}
      onNodeClick={onNodeClick}
      showInspector={false}
      framed={false}
    />
  )
  return previewContent
}
