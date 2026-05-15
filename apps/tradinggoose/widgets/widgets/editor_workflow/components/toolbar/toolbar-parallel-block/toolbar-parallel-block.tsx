'use client'

import { useCallback } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getIconTileStyle } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SubflowBlockConfigs } from '@/widgets/widgets/editor_workflow/components/subflows/config'
import { useToolbarAddBlock } from '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-context'

type ParallelToolbarItemProps = {
  disabled?: boolean
}

export default function ParallelToolbarItem({ disabled = false }: ParallelToolbarItemProps) {
  const userPermissions = useUserPermissionsContext()
  const addBlock = useToolbarAddBlock()
  const parallelTool = SubflowBlockConfigs.parallel
  const ParallelIcon = parallelTool.icon
  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    const simplifiedData = {
      type: 'parallel',
    }
    e.dataTransfer.setData('application/json', JSON.stringify(simplifiedData))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return

      addBlock({
        type: 'parallel',
        clientX: e.clientX,
        clientY: e.clientY,
      })
    },
    [disabled, addBlock]
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
        style={getIconTileStyle(parallelTool.bgColor, '30')}
      >
        <ParallelIcon
          className={cn(
            'h-[14px] w-[14px] transition-transform duration-200',
            !disabled && 'group-hover:scale-110'
          )}
        />
      </div>
      <span className='font-medium text-sm leading-none'>{parallelTool.name}</span>
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
