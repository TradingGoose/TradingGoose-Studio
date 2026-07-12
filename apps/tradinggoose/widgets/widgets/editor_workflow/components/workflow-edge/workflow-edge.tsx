'use client';
import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps, getBezierPath } from '@xyflow/react'

interface WorkflowEdgeData extends Record<string, unknown> {
  isSelected?: boolean
  isInsideLoop?: boolean
  parentLoopId?: string
  onDelete?: (edgeId: string) => void
}

type WorkflowCanvasEdge = Edge<WorkflowEdgeData, 'workflowEdge' | 'default'>
type WorkflowEdgeProps = EdgeProps<WorkflowCanvasEdge>

export const WorkflowEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  source,
  target,
}: WorkflowEdgeProps) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const isSelected = data?.isSelected ?? false
  const isInsideLoop = data?.isInsideLoop ?? false
  const parentLoopId = data?.parentLoopId

  const getEdgeColor = () => {
    if (isSelected) return '#475569'
    return '#94a3b8'
  }

  const edgeStyle = {
    strokeWidth: isSelected ? 2.5 : 2,
    stroke: getEdgeColor(),
    strokeDasharray: '5,5',
    ...style,
  }

  return (
    <>
      <BaseEdge
        path={edgePath}
        data-testid='workflow-edge'
        style={edgeStyle}
        interactionWidth={30}
        data-edge-id={id}
        data-parent-loop-id={parentLoopId}
        data-is-selected={isSelected ? 'true' : 'false'}
        data-is-inside-loop={isInsideLoop ? 'true' : 'false'}
      />
      {/* Animate dash offset for edge movement effect */}
      <animate
        attributeName='stroke-dashoffset'
        from='10'
        to='0'
        dur='1s'
        repeatCount='indefinite'
      />

      {isSelected && (
        <EdgeLabelRenderer>
          <div
            className='nodrag nopan flex bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900 h-6 w-6 cursor-pointer items-center justify-center rounded-full  rounded-full shadow-sm '
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 100,
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()

              if (data?.onDelete) {
                // Pass this specific edge's ID to the delete function
                data.onDelete(id)
              }
            }}
          >
            <X className='h-5 w-5 text-red-500' />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
