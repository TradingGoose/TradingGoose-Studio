'use client'

import { useCallback } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getIconTileStyle } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { BlockConfig } from '@/blocks/types'
import { useToolbarAddBlock } from '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-context'

export type ToolbarBlockProps = {
  config: BlockConfig
  disabled?: boolean
  enableTriggerMode?: boolean
}

export function ToolbarBlock({
  config,
  disabled = false,
  enableTriggerMode = false,
}: ToolbarBlockProps) {
  const userPermissions = useUserPermissionsContext()
  const addBlock = useToolbarAddBlock()

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

    addBlock({
      type: config.type,
      enableTriggerMode,
    })
  }, [config.type, disabled, enableTriggerMode, addBlock])

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
        className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary text-foreground'
        style={getIconTileStyle(config.bgColor)}
      >
        <config.icon
          className={cn(
            'transition-transform duration-200',
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
