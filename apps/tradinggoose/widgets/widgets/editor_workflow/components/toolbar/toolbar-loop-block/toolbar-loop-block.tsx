'use client'

import { useCallback } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store-client'
import { LoopTool } from '@/widgets/widgets/editor_workflow/components/subflows/loop/loop-config'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

type LoopToolbarItemProps = {
  disabled?: boolean
  channelId?: string
}

// Custom component for the Loop Tool
export default function LoopToolbarItem({ disabled = false, channelId }: LoopToolbarItemProps) {
  const userPermissions = useUserPermissionsContext()
  const workflowRoute = useOptionalWorkflowRoute()
  const resolvedChannelId = channelId ?? workflowRoute?.channelId ?? DEFAULT_WORKFLOW_CHANNEL_ID

  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    // Only send the essential data for the loop node
    const simplifiedData = {
      type: 'loop',
    }
    e.dataTransfer.setData('application/json', JSON.stringify(simplifiedData))
    e.dataTransfer.effectAllowed = 'move'
  }

  // Handle click to add loop block
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return

      // Dispatch a custom event to be caught by the workflow component
      const event = new CustomEvent('add-block-from-toolbar', {
        detail: {
          type: 'loop',
          clientX: e.clientX,
          clientY: e.clientY,
          channelId: resolvedChannelId,
        },
      })
      window.dispatchEvent(event)
    },
    [disabled, resolvedChannelId]
  )

  const blockContent = (
    <div
      draggable={!disabled}
      onDragStart={handleDragStart}
      onClick={handleClick}
      className={cn(
        'group flex h-8 items-center gap-[10px] rounded-sm p-2 transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:bg-card active:cursor-grabbing'
      )}
    >
      <div
        className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm'
        style={{ backgroundColor: LoopTool.bgColor + '30', color: LoopTool.bgColor }}
      >
        <LoopTool.icon
          className={cn(
            'h-[14px] w-[14px] transition-transform duration-200',
            !disabled && 'group-hover:scale-110'
          )}
        />
      </div>
      <span className='font-medium text-sm leading-none'>{LoopTool.name}</span>
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
