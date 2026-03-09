import type React from 'react'
import { memo, useMemo, useRef } from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Handle, type NodeProps, Position, useReactFlow } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type DiffStatus, hasDiffStatus } from '@/lib/workflows/diff/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCurrentWorkflow } from '@/hooks/workflow'
import { ActionBar } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/action-bar/action-bar'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const SubflowNodeStyles: React.FC = () => {
  return (
    <style jsx global>{`
      @keyframes loop-node-pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(47, 179, 255, 0.3);
        }
        70% {
          box-shadow: 0 0 0 6px rgba(47, 179, 255, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(47, 179, 255, 0);
        }
      }

      @keyframes parallel-node-pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(255, 221, 0, 0.35);
        }
        70% {
          box-shadow: 0 0 0 6px rgba(255, 221, 0, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(255, 221, 0, 0);
        }
      }

      .loop-node-drag-over {
        animation: loop-node-pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        border-style: solid !important;
        background-color: rgba(47, 179, 255, 0.08) !important;
        box-shadow: 0 0 0 8px rgba(47, 179, 255, 0.1);
      }

      .parallel-node-drag-over {
        animation: parallel-node-pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        border-style: solid !important;
        background-color: rgba(255, 221, 0, 0.1) !important;
        box-shadow: 0 0 0 8px rgba(255, 221, 0, 0.1);
      }

      .workflow-container .react-flow__node-subflowNode:has([data-subflow-selected='true']) {
        z-index: 10 !important;
      }

      .react-flow__node[data-parent-node-id] .react-flow__handle {
        z-index: 30;
      }
    `}</style>
  )
}

export interface SubflowNodeData {
  width?: number
  height?: number
  parentId?: string
  extent?: 'parent'
  hasNestedError?: boolean
  isPreview?: boolean
  kind: 'loop' | 'parallel'
  name?: string
}

export const SubflowNodeComponent = memo(({ data, id, selected }: NodeProps<SubflowNodeData>) => {
  const { getNodes } = useReactFlow()
  const blockRef = useRef<HTMLDivElement>(null)
  const userPermissions = useUserPermissionsContext()
  const workflowRoute = useOptionalWorkflowRoute()

  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentWorkflow.getBlockById(id)
  const diffStatus: DiffStatus =
    currentWorkflow.isDiffMode && currentBlock && hasDiffStatus(currentBlock)
      ? currentBlock.is_diff
      : undefined

  const isPreview = data?.isPreview || false
  const isEnabled = currentBlock?.enabled ?? true
  const isLocked = currentBlock?.locked ?? false

  const nestingLevel = useMemo(() => {
    let level = 0
    let currentParentId = data?.parentId

    while (currentParentId) {
      level++
      const parentNode = getNodes().find((node) => node.id === currentParentId)
      if (!parentNode) break
      currentParentId = parentNode.data?.parentId
    }

    return level
  }, [data?.parentId, getNodes])

  const nestedStyles = useMemo(() => {
    const styles: Record<string, string> = {
      backgroundColor: 'rgba(125, 126, 127, 0.05)',
    }

    if (nestingLevel > 0) {
      const colors = ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569']
      const colorIndex = (nestingLevel - 1) % colors.length
      styles.backgroundColor = `${colors[colorIndex]}20`
    }

    return styles
  }, [nestingLevel])

  const isLoop = data.kind === 'loop'
  const startHandleId = isLoop ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = isLoop ? 'loop-end-source' : 'parallel-end-source'
  const blockColor = isLoop ? '#00ccff' : '#ffdd00'
  const blockName = data.name || (isLoop ? 'Loop' : 'Parallel')
  const BlockIcon = isLoop ? RepeatIcon : SplitIcon

  const getHandleClasses = (position: 'left' | 'right') => {
    const baseClasses =
      '!w-[7px] !h-5 !bg-slate-300 dark:!bg-slate-500 !rounded-xs !border-none !z-[30] group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)] !cursor-crosshair transition-[colors] duration-150'

    if (position === 'left') {
      return `${baseClasses} hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none !left-[-7px]`
    }

    return `${baseClasses} hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !right-[-7px]`
  }

  return (
    <>
      <SubflowNodeStyles />
      <div className='group relative'>
        <Card
          ref={blockRef}
          className={cn(
            'relative cursor-default select-none rounded-md border border-border shadow-xs',
            'transition-block-bg transition-ring',
            'z-[20]',
            !isEnabled && 'shadow-sm',
            nestingLevel > 0 &&
              `border border-[0.5px] ${nestingLevel % 2 === 0 ? 'border-slate-300/60' : 'border-slate-400/60'}`,
            data?.hasNestedError && 'border-2 border-red-500 bg-red-50/50',
            diffStatus === 'new' && 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10',
            diffStatus === 'edited' &&
              'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10',
            selected && 'border-2'
          )}
          style={{
            width: data.width || 500,
            height: data.height || 300,
            position: 'relative',
            overflow: 'visible',
            ...nestedStyles,
            ...(selected ? { borderColor: blockColor } : {}),
            pointerEvents: isPreview ? 'none' : 'all',
          }}
          data-node-id={id}
          data-type='subflowNode'
          data-nesting-level={nestingLevel}
          data-subflow-selected={selected ? 'true' : 'false'}
        >
          {!isPreview && workflowRoute && (
            <ActionBar
              blockId={id}
              blockType={data.kind}
              workflowId={workflowRoute.workflowId}
              channelId={workflowRoute.channelId}
              disabled={!userPermissions.canEdit}
            />
          )}

          <div
            className='workflow-drag-handle flex cursor-grab items-center justify-between border-b bg-card p-3 [&:active]:cursor-grabbing'
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className='flex min-w-0 flex-1 items-center gap-3'>
              <div
                className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary text-foreground'
                style={{
                  backgroundColor: isEnabled ? `${blockColor}20` : 'gray',
                  color: isEnabled ? blockColor : 'white',
                }}
              >
                <BlockIcon className='h-5 w-5' />
              </div>
              <span
                className={cn(
                  'inline-block max-w-[220px] truncate font-medium text-md',
                  !isEnabled && 'text-muted-foreground'
                )}
                title={blockName}
              >
                {blockName}
              </span>
            </div>

            <div className='flex items-center gap-2'>
              {isLocked && (
                <Badge variant='secondary' className='bg-gray-100 text-gray-500 hover:bg-gray-100'>
                  Locked
                </Badge>
              )}
              {!isEnabled && (
                <Badge variant='secondary' className='bg-gray-100 text-gray-500 hover:bg-gray-100'>
                  Disabled
                </Badge>
              )}
            </div>
          </div>

          {!isPreview && (
            <div
              className='absolute right-2 bottom-2 z-20 flex h-8 w-8 cursor-se-resize items-center justify-center text-muted-foreground'
              style={{ pointerEvents: 'auto' }}
            />
          )}

          <div
            className='h-[calc(100%-56px)] p-4'
            data-dragarea='true'
            style={{
              position: 'relative',
              pointerEvents: isPreview ? 'none' : 'auto',
            }}
          >
            <div
              className='absolute top-4 left-4 flex items-center justify-center rounded-md border border-border bg-card px-3 py-1.5'
              style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
              data-parent-id={id}
              data-node-role={`${data.kind}-start`}
              data-extent='parent'
            >
              <span className='font-medium text-sm'>Start</span>
              <Handle
                type='source'
                position={Position.Right}
                id={startHandleId}
                className='!w-[6px] !h-4 !bg-slate-300 dark:!bg-slate-500 !rounded-xs !border-none !z-[30] hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !cursor-crosshair transition-[colors] duration-150'
                style={{
                  right: '-6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'auto',
                }}
                data-parent-id={id}
              />
            </div>
          </div>

          <Handle
            type='target'
            position={Position.Left}
            className={getHandleClasses('left')}
            style={{
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'auto',
            }}
          />

          <Handle
            type='source'
            position={Position.Right}
            className={getHandleClasses('right')}
            style={{
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'auto',
            }}
            id={endHandleId}
          />
        </Card>
      </div>
    </>
  )
})

SubflowNodeComponent.displayName = 'SubflowNodeComponent'
