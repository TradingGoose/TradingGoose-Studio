import type { CSSProperties } from 'react'
import { getSmoothStepPath, type ConnectionLineComponentProps } from 'reactflow'

/**
 * Custom connection line so the preview matches WorkflowEdge's geometry.
 */
export const WorkflowConnectionLine = ({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionLineStyle,
  connectionStatus,
}: ConnectionLineComponentProps) => {
  const isHorizontal = fromPosition === 'right' || fromPosition === 'left'

  const [path] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    borderRadius: Infinity,
    offset: isHorizontal ? 30 : 20,
  })

  const defaultStyle: CSSProperties = {
    stroke: '#94a3b8',
    strokeWidth: 2,
    strokeDasharray: '5,5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    pointerEvents: 'none',
  }

  const style: CSSProperties = {
    ...defaultStyle,
    ...(connectionLineStyle ?? {}),
  }

  if (connectionStatus === 'invalid') {
    style.stroke = '#ef4444'
  }

  return <path className='react-flow__connection-path' d={path} fill='none' style={style} />
}
