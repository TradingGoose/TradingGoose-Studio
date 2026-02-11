import type { OwnerId } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-types'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/manual-tool-types'
import type {
  LineToolExport,
  LineToolsDoubleClickEventParams,
} from '@/widgets/widgets/data_chart/plugins/core'

export const MANUAL_DOMAIN_PREFIX = 'manual:'

export const parseDoubleClickTool = (event: unknown): LineToolExport<any> | null => {
  if (!event || typeof event !== 'object') return null
  const selectedLineTool = (event as Partial<LineToolsDoubleClickEventParams>).selectedLineTool
  if (!selectedLineTool || typeof selectedLineTool !== 'object') return null
  if (typeof selectedLineTool.id !== 'string') return null
  if (!Array.isArray(selectedLineTool.points)) return null
  return selectedLineTool as LineToolExport<any>
}

const INLINE_TEXT_ANCHOR_INDEX_BY_TOOL: Partial<Record<ManualToolType, number>> = {
  Callout: 1,
}

export const resolveInlineTextAnchorPoint = (tool: LineToolExport<any>) => {
  const toolType = tool.toolType as ManualToolType
  const anchorIndex = INLINE_TEXT_ANCHOR_INDEX_BY_TOOL[toolType] ?? 0
  return tool.points[anchorIndex] ?? tool.points[0] ?? null
}

export const areSetsEqual = (left: Set<string>, right: Set<string>) => {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

export const parseLineToolExports = (serialized: string): Array<LineToolExport<any>> => {
  try {
    const parsed = JSON.parse(serialized)
    if (!Array.isArray(parsed)) return []
    return parsed as Array<LineToolExport<any>>
  } catch {
    return []
  }
}

export const toManualOwnerId = (drawToolsId: string): OwnerId =>
  `${MANUAL_DOMAIN_PREFIX}${drawToolsId}`

export const fromManualOwnerId = (ownerId: string): string | null => {
  if (!ownerId.startsWith(MANUAL_DOMAIN_PREFIX)) return null
  return ownerId.slice(MANUAL_DOMAIN_PREFIX.length)
}
