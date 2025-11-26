'use client'

import { useCallback } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import type { BlockConfig } from '@/blocks/types'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store-client'

export type ToolbarBlockProps = {
  config: BlockConfig
  disabled?: boolean
  enableTriggerMode?: boolean
  channelId?: string
}

export function ToolbarBlock({
  config,
  disabled = false,
  enableTriggerMode = false,
  channelId,
}: ToolbarBlockProps) {
  const userPermissions = useUserPermissionsContext()
  const workflowRoute = useOptionalWorkflowRoute()
  const resolvedChannelId = channelId ?? workflowRoute?.channelId ?? DEFAULT_WORKFLOW_CHANNEL_ID

  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: config.type,
        enableTriggerMode,
      })
    )
    e.dataTransfer.effectAllowed = 'move'
  }

  // Handle click to add block
  const handleClick = useCallback(() => {
    if (config.type === 'connectionBlock' || disabled) return

    // Dispatch a custom event to be caught by the workflow component
    const event = new CustomEvent('add-block-from-toolbar', {
      detail: {
        type: config.type,
        enableTriggerMode,
        channelId: resolvedChannelId,
      },
    })
    window.dispatchEvent(event)
  }, [config.type, disabled, enableTriggerMode, resolvedChannelId])

  const blockContent = (
    <div
      draggable={!disabled}
      onDragStart={handleDragStart}
      onClick={handleClick}
      className={cn(
        'group flex h-9 w-full items-center gap-[10px] rounded-sm p-2 transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:bg-card active:cursor-grabbing'
      )}
    >
      <div
        className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[6px]'
        style={{ backgroundColor: config.bgColor }}
      >
        <config.icon
          className={cn(
            'text-white transition-transform duration-200',
            !disabled && 'group-hover:scale-110',
            '!h-4 !w-4'
          )}
        />
      </div>
      <span className='font-medium text-sm leading-none'>{config.name}</span>
    </div>
  )

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{blockContent}</TooltipTrigger>
        <TooltipContent>
          {userPermissions.isOfflineMode
            ? 'Connection lost - please refresh'
            : 'Edit permissions required to add blocks'}
        </TooltipContent>
      </Tooltip>
    )
  }

  return blockContent
}
