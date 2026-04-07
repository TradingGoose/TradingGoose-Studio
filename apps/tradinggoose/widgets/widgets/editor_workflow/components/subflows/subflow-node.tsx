import type React from 'react'
import { type CSSProperties, memo, useEffect } from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Handle, type NodeProps, Position, useReactFlow, useUpdateNodeInternals } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
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
  const updateNodeInternals = useUpdateNodeInternals()
  const userPermissions = useUserPermissionsContext()
  const workflowRoute = useOptionalWorkflowRoute()

  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentWorkflow.getBlockById(id)

  const isPreview = data?.isPreview || false
  const isEnabled = currentBlock?.enabled ?? true
  const isLocked = currentBlock?.locked ?? false

  const isLoop = data.kind === 'loop'
  const startHandleId = isLoop ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = isLoop ? 'loop-end-source' : 'parallel-end-source'
  const endTargetHandleId = isLoop ? 'loop-end-target' : 'parallel-end-target'
  const blockColor = isLoop ? '#00ccff' : '#ffdd00'
  const blockName = data.name || (isLoop ? 'Loop' : 'Parallel')
  const BlockIcon = isLoop ? RepeatIcon : SplitIcon
  const hasPriorityRing = Boolean(data?.hasNestedError)

  const getHandleClasses = (position: 'left' | 'right') => {
    const baseClasses =
      '!w-[7px] !h-5 !bg-slate-300 dark:!bg-slate-500 !rounded-xs !border-none !z-[30] group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)] !cursor-crosshair transition-[colors] duration-150'

    if (position === 'left') {
      return `${baseClasses} hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none !left-[-8px]`
    }

    return `${baseClasses} hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !right-[-8px]`
  }

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      updateNodeInternals(id)
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [data.height, data.width, id, updateNodeInternals])

  const isEndTargetConnectionValid = (sourceId: string | null | undefined) => {
    const sourceNode = getNodes().find((node) => node.id === sourceId)
    const sourceParentId = sourceNode?.parentId || sourceNode?.data?.parentId
    return sourceParentId === id
  }

  return (
    <>
      <SubflowNodeStyles />
      <div className='group relative'>
        <Card
          className={cn(
            'relative cursor-default select-none rounded-md border border-border shadow-xs',
            'transition-block-bg transition-ring',
            'z-[20]',
            !isEnabled && 'shadow-sm',
            data?.hasNestedError && 'bg-red-50/50 ring-2 ring-red-500 dark:bg-red-900/10',
            !hasPriorityRing && 'hover:ring-1 hover:ring-[var(--block-hover-color)]'
          )}
          style={
            {
              '--block-hover-color': blockColor,
              width: data.width || 500,
              height: data.height || 300,
              position: 'relative',
              overflow: 'visible',
              pointerEvents: 'auto',
              ...(selected ? { borderColor: blockColor, borderWidth: '1px' } : {}),
            } as CSSProperties & Record<'--block-hover-color', string>
          }
          data-node-id={id}
          data-type='subflowNode'
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
            onMouseDown={(event) => {
              if (!isPreview) {
                event.stopPropagation()
              }
            }}
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
          <div
            className='h-[calc(100%-56px)] p-4'
            data-dragarea='true'
            style={{
              position: 'relative',
              pointerEvents: isPreview ? 'none' : 'auto',
            }}
          />

          <div
            className='-translate-y-1/2 absolute top-1/2 left-4 flex items-center justify-center rounded-md border border-border bg-card px-3 py-1.5'
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

          <div
            className='-translate-y-1/2 absolute top-1/2 right-4 flex items-center justify-center rounded-md border border-border bg-card px-3 py-1.5'
            style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
            data-parent-id={id}
            data-node-role={`${data.kind}-end`}
            data-extent='parent'
          >
            <Handle
              type='target'
              position={Position.Left}
              id={endTargetHandleId}
              isValidConnection={(connection) => isEndTargetConnectionValid(connection.source)}
              className='!w-[6px] !h-4 !bg-slate-300 dark:!bg-slate-500 !rounded-xs !border-none !z-[30] hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none !cursor-crosshair transition-[colors] duration-150'
              style={{
                left: '-6px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'auto',
              }}
              data-parent-id={id}
            />
            <span className='font-medium text-sm'>End</span>
          </div>

          <Handle
            type='target'
            position={Position.Left}
            id='target'
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
            id={endHandleId}
            className={getHandleClasses('right')}
            style={{
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'auto',
            }}
          />
        </Card>
      </div>
    </>
  )
})

SubflowNodeComponent.displayName = 'SubflowNodeComponent'
