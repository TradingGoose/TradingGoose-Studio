import { memo, useCallback, useMemo } from 'react'
import {
  ArrowLeftRight,
  ArrowUpDown,
  BookOpen,
  Circle,
  CircleOff,
  Copy,
  Info,
  Lock,
  LogOut,
  Trash2,
  Unlock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getBlock } from '@/blocks'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { useWorkflowBlocks } from '@/lib/yjs/use-workflow-doc'
import { emitRemoveFromSubflow } from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus'

interface ActionBarProps {
  blockId: string
  blockType: string
  workflowId: string
  channelId: string
  disabled?: boolean
  showWebhookIndicator?: boolean
  showScheduleBadge?: boolean
  hasScheduleInfo?: boolean
  isScheduleDisabled?: boolean
  onScheduleToggle?: () => void
}

type StatusTone = 'blue' | 'yellow' | 'green'

const statusToneClasses: Record<StatusTone, { text: string; halo: string; dot: string }> = {
  blue: {
    text: 'text-blue-600 hover:text-blue-600',
    halo: 'bg-blue-500/20',
    dot: 'bg-blue-500',
  },
  yellow: {
    text: 'text-yellow-600 hover:text-yellow-600',
    halo: 'bg-yellow-500/20',
    dot: 'bg-yellow-500',
  },
  green: {
    text: 'text-green-600 hover:text-green-600',
    halo: 'bg-green-500/20',
    dot: 'bg-green-500',
  },
}

export const ActionBar = memo(
  function ActionBar({
    blockId,
    blockType,
    workflowId,
    channelId,
    disabled = false,
    showWebhookIndicator = false,
    showScheduleBadge = false,
    hasScheduleInfo = false,
    isScheduleDisabled = false,
    onScheduleToggle,
  }: ActionBarProps) {
    const {
      collaborativeRemoveBlock,
      collaborativeToggleBlockEnabled,
      collaborativeDuplicateBlock,
      collaborativeToggleBlockHandles,
      collaborativeToggleBlockLocked,
    } = useWorkflowEditorActions()

    // Optimized: derive all block data from Yjs blocks
    const blocks = useWorkflowBlocks()
    const { isEnabled, horizontalHandles, parentId, parentType, isLocked, isParentLocked, isParentDisabled } =
      useMemo(() => {
        const block = blocks[blockId]
        const pid = block?.data?.parentId
        const parentBlock = pid ? blocks[pid] : undefined
        return {
          isEnabled: block?.enabled ?? true,
          horizontalHandles: block?.horizontalHandles ?? true,
          parentId: pid,
          parentType: parentBlock?.type,
          isLocked: block?.locked ?? false,
          isParentLocked: parentBlock?.locked ?? false,
          isParentDisabled: parentBlock ? !parentBlock.enabled : false,
        }
      }, [blocks, blockId])

    const userPermissions = useUserPermissionsContext()

    const blockConfig = getBlock(blockType)
    const isTriggerBlock = blockConfig?.category === 'triggers'

    const getTooltipMessage = (defaultMessage: string) => {
      if (disabled) {
        return userPermissions.isOfflineMode ? 'Connection lost - please refresh' : 'Read-only mode'
      }
      return defaultMessage
    }

    const isActionLocked = isLocked || isParentLocked
    const canMutate = !disabled && !isActionLocked
    const isUnlockBlockedByParent = isLocked && isParentLocked
    const disableMutatingActions = disabled || isActionLocked
    const disableEnableToggle = disableMutatingActions || (!isEnabled && isParentDisabled)
    const disableSubflowRemoval = disableMutatingActions || !userPermissions.canEdit
    const getLockedTooltip = (defaultMessage: string) =>
      isActionLocked ? 'Block is locked' : getTooltipMessage(defaultMessage)

    const tooltipSide = horizontalHandles ? 'top' : 'right'
    const actionButtonClass = cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')
    const destructiveActionButtonClass = cn(actionButtonClass, 'hover:text-red-600')
    const scheduleTone: StatusTone = !hasScheduleInfo
      ? 'blue'
      : isScheduleDisabled
        ? 'yellow'
        : 'green'
    const scheduleTooltip = isActionLocked
      ? 'Block is locked.'
      : !hasScheduleInfo
        ? 'This workflow is triggered by a schedule. Configure frequency and timezone in this block.'
        : isScheduleDisabled
          ? onScheduleToggle
            ? 'This schedule is currently disabled. Click to reactivate it.'
            : 'This schedule is currently disabled.'
          : onScheduleToggle
            ? 'Click to disable this schedule.'
            : 'This schedule is active.'
    const renderStatusDot = (tone: StatusTone) => (
      <div className='relative flex h-2 w-2 items-center justify-center'>
        <div className={cn('absolute h-3 w-3 rounded-full', statusToneClasses[tone].halo)} />
        <div className={cn('relative h-2 w-2 rounded-full', statusToneClasses[tone].dot)} />
      </div>
    )

    return (
      <div
        className={cn(
          horizontalHandles
            ? '-translate-x-1/2 absolute bottom-full left-1/2 z-10 mb-2'
            : '-right-14 absolute top-0',
          horizontalHandles
            ? 'flex flex-row items-center gap-1 p-1'
            : 'flex flex-col items-center gap-2 p-1',
          'rounded-md border border-gray-200 bg-background shadow-xs dark:border-gray-800',
          'opacity-0 transition-opacity duration-200 group-hover:opacity-100'
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                const cantEnable = !isEnabled && isParentDisabled
                if (canMutate && !cantEnable) {
                  collaborativeToggleBlockEnabled(blockId)
                }
              }}
              className={actionButtonClass}
              disabled={disableEnableToggle}
            >
              {isEnabled ? <Circle className='h-2 w-2' /> : <CircleOff className='h-2 w-2' />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {isActionLocked
              ? 'Block is locked'
              : !isEnabled && isParentDisabled
                ? 'Parent container is disabled'
                : getTooltipMessage(isEnabled ? 'Disable Block' : 'Enable Block')}
          </TooltipContent>
        </Tooltip>

        {userPermissions.canAdmin && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  if (!disabled && !isUnlockBlockedByParent) {
                    collaborativeToggleBlockLocked(blockId)
                  }
                }}
                className={actionButtonClass}
                disabled={disabled || isUnlockBlockedByParent}
              >
                {isLocked ? <Unlock className='h-2 w-2' /> : <Lock className='h-2 w-2' />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              {isUnlockBlockedByParent
                ? 'Parent container is locked'
                : isLocked
                  ? 'Unlock Block'
                  : 'Lock Block'}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (canMutate) {
                  collaborativeDuplicateBlock(blockId)
                }
              }}
              className={actionButtonClass}
              disabled={disableMutatingActions}
            >
              <Copy className='h-2 w-2' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>{getLockedTooltip('Duplicate Block')}</TooltipContent>
        </Tooltip>

        {showScheduleBadge && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className={cn(actionButtonClass, statusToneClasses[scheduleTone].text)}
                onClick={() => {
                  if (canMutate) {
                    onScheduleToggle?.()
                  }
                }}
                disabled={disableMutatingActions}
              >
                {renderStatusDot(scheduleTone)}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide} className='max-w-[300px] p-4'>
              <p className='text-sm'>{scheduleTooltip}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {showWebhookIndicator && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='sm' className={actionButtonClass} disabled={disabled}>
                {renderStatusDot('green')}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide} className='max-w-[300px] p-4'>
              <p className='text-muted-foreground text-sm'>
                This workflow is triggered by a webhook.
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {blockConfig?.docsLink ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className={actionButtonClass}
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(blockConfig.docsLink, '_target', 'noopener,noreferrer')
                }}
                disabled={disabled}
              >
                <BookOpen className='h-2 w-2' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>See Docs</TooltipContent>
          </Tooltip>
        ) : (
          blockConfig?.longDescription && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='sm' className={actionButtonClass} disabled={disabled}>
                  <Info className='h-2 w-2' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={tooltipSide} className='max-w-[300px] p-4'>
                <div className='space-y-3'>
                  <div>
                    <p className='mb-1 font-medium text-sm'>Description</p>
                    <p className='wrap max-w-[300px] whitespace-pre-wrap text-muted-foreground text-sm'>
                      {blockConfig.longDescription}
                    </p>
                  </div>
                  {blockConfig.outputs && Object.keys(blockConfig.outputs).length > 0 && (
                    <div>
                      <p className='mb-1 font-medium text-sm'>Output</p>
                      <div className='text-sm'>
                        {Object.entries(blockConfig.outputs).map(([key, value]) => (
                          <div key={key} className='mb-1'>
                            <span className='text-muted-foreground'>{key}</span>{' '}
                            <span className='text-green-500'>
                              {typeof value === 'object' && value !== null && 'type' in value
                                ? value.type
                                : value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        )}

        {/* Remove from subflow - only show when inside loop/parallel */}
        {!isTriggerBlock && parentId && (parentType === 'loop' || parentType === 'parallel') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  if (canMutate && userPermissions.canEdit) {
                    emitRemoveFromSubflow({
                      blockId,
                      workflowId,
                      channelId,
                    })
                  }
                }}
                className={cn(
                  actionButtonClass,
                  disableSubflowRemoval && 'cursor-not-allowed opacity-50'
                )}
                disabled={disableSubflowRemoval}
              >
                <LogOut className='h-2 w-2' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>{getLockedTooltip('Remove From Subflow')}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (canMutate) {
                  collaborativeToggleBlockHandles(blockId)
                }
              }}
              className={actionButtonClass}
              disabled={disableMutatingActions}
            >
              {horizontalHandles ? (
                <ArrowLeftRight className='h-2 w-2' />
              ) : (
                <ArrowUpDown className='h-2 w-2' />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {getLockedTooltip(horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (canMutate) {
                  collaborativeRemoveBlock(blockId)
                }
              }}
              className={destructiveActionButtonClass}
              disabled={disableMutatingActions}
            >
              <Trash2 className='h-2 w-2' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>{getLockedTooltip('Delete Block')}</TooltipContent>
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
      prevProps.disabled === nextProps.disabled &&
      prevProps.showWebhookIndicator === nextProps.showWebhookIndicator &&
      prevProps.showScheduleBadge === nextProps.showScheduleBadge &&
      prevProps.hasScheduleInfo === nextProps.hasScheduleInfo &&
      prevProps.isScheduleDisabled === nextProps.isScheduleDisabled &&
      prevProps.onScheduleToggle === nextProps.onScheduleToggle
    )
  }
)
