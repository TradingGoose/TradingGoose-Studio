import { memo, useCallback } from 'react'
import { ArrowLeftRight, ArrowUpDown, Circle, CircleOff, Copy, LogOut, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { emitRemoveFromSubflow } from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus'
import { useWorkflowStore } from '@/stores/workflows/workflow/store-client'
import { getBlock } from '@/blocks'

interface ActionBarProps {
  blockId: string
  blockType: string
  workflowId: string
  channelId: string
  disabled?: boolean
}

export const ActionBar = memo(
  function ActionBar({
    blockId,
    blockType,
    workflowId,
    channelId,
    disabled = false,
  }: ActionBarProps) {
    const {
      collaborativeRemoveBlock,
      collaborativeToggleBlockEnabled,
      collaborativeDuplicateBlock,
      collaborativeToggleBlockHandles,
    } = useCollaborativeWorkflow()

    // Optimized: Single store subscription for all block data
    const { isEnabled, horizontalHandles, parentId, parentType } = useWorkflowStore(
      useCallback(
        (state) => {
          const block = state.blocks[blockId]
          const parentId = block?.data?.parentId
          return {
            isEnabled: block?.enabled ?? true,
            horizontalHandles: block?.horizontalHandles ?? false,
            parentId,
            parentType: parentId ? state.blocks[parentId]?.type : undefined,
          }
        },
        [blockId]
      )
    )

    const userPermissions = useUserPermissionsContext()

    const blockConfig = getBlock(blockType)
    const isTriggerBlock = blockConfig?.category === 'triggers'

    const getTooltipMessage = (defaultMessage: string) => {
      if (disabled) {
        return userPermissions.isOfflineMode ? 'Connection lost - please refresh' : 'Read-only mode'
      }
      return defaultMessage
    }

    return (
      <div
        className={cn(
          '-right-14 absolute top-0',
          'flex flex-col items-center gap-2 p-1',
          'rounded-md border border-gray-200 bg-background shadow-xs dark:border-gray-800',
          'opacity-0 transition-opacity duration-200 group-hover:opacity-100'
        )}
      >
        {/* <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              isEnabled
                ? 'bg-primary-hover hover:bg-primary-hover/90'
                : 'bg-gray-400 hover:bg-gray-400 cursor-not-allowed'
            )}
            size="sm"
            disabled={!isEnabled}
          >
            <Play fill="currentColor" className="!h-3.5 !w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Run Block</TooltipContent>
      </Tooltip> */}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (!disabled) {
                  collaborativeToggleBlockEnabled(blockId)
                }
              }}
              className={cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')}
              disabled={disabled}
            >
              {isEnabled ? <Circle className='h-2 w-2' /> : <CircleOff className='h-2 w-2' />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>
            {getTooltipMessage(isEnabled ? 'Disable Block' : 'Enable Block')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (!disabled) {
                  collaborativeDuplicateBlock(blockId)
                }
              }}
              className={cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')}
              disabled={disabled}
            >
              <Copy className='h-2 w-2' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>{getTooltipMessage('Duplicate Block')}</TooltipContent>
        </Tooltip>

        {/* Remove from subflow - only show when inside loop/parallel */}
        {!isTriggerBlock && parentId && (parentType === 'loop' || parentType === 'parallel') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
              onClick={() => {
                if (!disabled && userPermissions.canEdit) {
                  emitRemoveFromSubflow({
                    blockId,
                    workflowId,
                    channelId,
                  })
                }
              }}
                className={cn(
                  'text-gray-500',
                  (disabled || !userPermissions.canEdit) && 'cursor-not-allowed opacity-50'
                )}
                disabled={disabled || !userPermissions.canEdit}
              >
                <LogOut className='h-2 w-2' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='right'>{getTooltipMessage('Remove From Subflow')}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (!disabled) {
                  collaborativeToggleBlockHandles(blockId)
                }
              }}
              className={cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')}
              disabled={disabled}
            >
              {horizontalHandles ? (
                <ArrowLeftRight className='h-2 w-2' />
              ) : (
                <ArrowUpDown className='h-2 w-2' />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>
            {getTooltipMessage(horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (!disabled) {
                  collaborativeRemoveBlock(blockId)
                }
              }}
              className={cn(
                'text-gray-500 hover:text-red-600',
                disabled && 'cursor-not-allowed opacity-50'
              )}
              disabled={disabled}
            >
              <Trash2 className='h-2 w-2' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>{getTooltipMessage('Delete Block')}</TooltipContent>
        </Tooltip>
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Only re-render if props actually changed
    return (
      prevProps.blockId === nextProps.blockId &&
      prevProps.blockType === nextProps.blockType &&
      prevProps.workflowId === nextProps.workflowId &&
      prevProps.channelId === nextProps.channelId &&
      prevProps.disabled === nextProps.disabled
    )
  }
)
