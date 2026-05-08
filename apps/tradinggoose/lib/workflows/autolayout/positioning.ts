import { createLogger } from '@/lib/logs/console/logger'
import type { Edge, GraphNode, LayoutOptions } from './types'
import { boxesOverlap, createBoundingBox } from './utils'

const logger = createLogger('AutoLayout:Positioning')

const DEFAULT_HORIZONTAL_SPACING = 550
const DEFAULT_VERTICAL_SPACING = 200
const DEFAULT_PADDING = { x: 150, y: 150 }
type LayoutAxis = 'horizontal' | 'vertical'

export function calculatePositions(
  layers: Map<number, GraphNode[]>,
  edges: Edge[],
  options: LayoutOptions = {}
): void {
  const horizontalSpacing = options.horizontalSpacing ?? DEFAULT_HORIZONTAL_SPACING
  const verticalSpacing = options.verticalSpacing ?? DEFAULT_VERTICAL_SPACING
  const padding = options.padding ?? DEFAULT_PADDING
  const alignment = options.alignment ?? 'center'

  const layerNumbers = Array.from(layers.keys()).sort((a, b) => a - b)
  let xPosition = padding.x

  for (const layerNum of layerNumbers) {
    const nodesInLayer = layers.get(layerNum)!
    const totalHeight = nodesInLayer.reduce(
      (sum, node, idx) => sum + node.metrics.height + (idx > 0 ? verticalSpacing : 0),
      0
    )

    let yOffset: number
    switch (alignment) {
      case 'start':
        yOffset = padding.y
        break
      case 'center':
        yOffset = Math.max(padding.y, 300 - totalHeight / 2)
        break
      case 'end':
        yOffset = 600 - totalHeight - padding.y
        break
      default:
        yOffset = padding.y
        break
    }

    for (const node of nodesInLayer) {
      node.position = {
        x: xPosition,
        y: yOffset,
      }

      yOffset += node.metrics.height + verticalSpacing
    }

    xPosition += Math.max(
      horizontalSpacing,
      Math.max(0, ...nodesInLayer.map((node) => node.metrics.width)) + 120
    )
  }

  const incomingAxes = applyEdgeConstraints(layers, edges, horizontalSpacing, verticalSpacing)

  resolveOverlaps(
    Array.from(layers.values()).flat(),
    incomingAxes,
    horizontalSpacing,
    verticalSpacing
  )
}

function applyEdgeConstraints(
  layers: Map<number, GraphNode[]>,
  edges: Edge[],
  horizontalSpacing: number,
  verticalSpacing: number
): Map<string, LayoutAxis | 'mixed'> {
  const nodesById = new Map(Array.from(layers.values()).flat().map((node) => [node.id, node]))
  const incomingEdges = new Map<string, Edge[]>()
  const incomingAxes = new Map<string, LayoutAxis | 'mixed'>()

  for (const edge of edges) {
    if (!incomingEdges.has(edge.target)) {
      incomingEdges.set(edge.target, [])
    }
    incomingEdges.get(edge.target)!.push(edge)
  }

  for (const layerNum of Array.from(layers.keys()).sort((a, b) => a - b)) {
    const layer = layers.get(layerNum)!
    for (const node of layer) {
      const nodeIncomingEdges = incomingEdges.get(node.id) ?? []
      let horizontalX: number | null = null
      let horizontalY: number | null = null
      let verticalX: number | null = null
      let verticalY: number | null = null

      for (const edge of nodeIncomingEdges) {
        const source = nodesById.get(edge.source)
        if (!source) continue

        const axis = getEdgeAxis(edge, source)
        const currentAxis = incomingAxes.get(node.id)
        incomingAxes.set(node.id, !currentAxis || currentAxis === axis ? axis : 'mixed')

        if (axis === 'horizontal') {
          horizontalX = Math.max(
            horizontalX ?? Number.NEGATIVE_INFINITY,
            source.position.x + source.metrics.width + horizontalSpacing
          )
          horizontalY = Math.max(
            horizontalY ?? Number.NEGATIVE_INFINITY,
            source.position.y + source.metrics.height / 2 - node.metrics.height / 2
          )
        } else {
          verticalY = Math.max(
            verticalY ?? Number.NEGATIVE_INFINITY,
            source.position.y + source.metrics.height + verticalSpacing
          )
          verticalX = Math.max(
            verticalX ?? Number.NEGATIVE_INFINITY,
            source.position.x + source.metrics.width / 2 - node.metrics.width / 2
          )
        }
      }

      if (horizontalX !== null) {
        node.position.x = horizontalX
      } else if (verticalX !== null) {
        node.position.x = verticalX
      }

      if (verticalY !== null) {
        node.position.y = verticalY
      } else if (horizontalY !== null) {
        node.position.y = horizontalY
      }
    }
  }

  return incomingAxes
}

function getEdgeAxis(edge: Edge, source: GraphNode): LayoutAxis {
  if (
    edge.sourceHandle?.startsWith('condition-') ||
    edge.sourceHandle === 'loop-start-source' ||
    edge.sourceHandle === 'loop-end-source' ||
    edge.sourceHandle === 'parallel-start-source' ||
    edge.sourceHandle === 'parallel-end-source' ||
    source.block.type === 'condition' ||
    source.block.type === 'loop' ||
    source.block.type === 'parallel'
  ) {
    return 'horizontal'
  }

  return source.block.horizontalHandles === false ? 'vertical' : 'horizontal'
}

function resolveOverlaps(
  nodes: GraphNode[],
  incomingAxes: Map<string, LayoutAxis | 'mixed'>,
  horizontalSpacing: number,
  verticalSpacing: number
): void {
  const MAX_ITERATIONS = 20
  let iteration = 0
  let hasOverlap = true

  while (hasOverlap && iteration < MAX_ITERATIONS) {
    hasOverlap = false
    iteration++

    // Sort nodes by position for consistent processing
    const sortedNodes = [...nodes].sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer
      return a.position.y - b.position.y || a.position.x - b.position.x
    })

    for (let i = 0; i < sortedNodes.length; i++) {
      for (let j = i + 1; j < sortedNodes.length; j++) {
        const node1 = sortedNodes[i]
        const node2 = sortedNodes[j]

        const box1 = createBoundingBox(node1.position, node1.metrics)
        const box2 = createBoundingBox(node2.position, node2.metrics)

        // Check for overlap with margin
        if (boxesOverlap(box1, box2, 30)) {
          hasOverlap = true
          const separateHorizontally =
            incomingAxes.get(node1.id) === 'vertical' &&
            incomingAxes.get(node2.id) === 'vertical'

          if (separateHorizontally) {
            node2.position.x = Math.max(
              node2.position.x,
              box1.x + box1.width + horizontalSpacing
            )
          } else {
            node2.position.y = Math.max(node2.position.y, box1.y + box1.height + verticalSpacing)
          }

          logger.debug('Resolved overlap between blocks', {
            block1: node1.id,
            block2: node2.id,
            sameLayer: node1.layer === node2.layer,
            iteration,
          })
        }
      }
    }
  }

  if (hasOverlap) {
    logger.warn('Could not fully resolve all overlaps after max iterations', {
      iterations: MAX_ITERATIONS,
    })
  }
}
