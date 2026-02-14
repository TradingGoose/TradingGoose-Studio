import type { LineToolExport, LineToolPoint } from '@/widgets/widgets/data_chart/plugins/core'

export type ManualOwnerSnapshotToolOptions = {
  visible?: false
  text?: {
    value: string
  }
}

export type ManualOwnerSnapshotTool = {
  id: string
  toolType: string
  points: LineToolPoint[]
  options?: ManualOwnerSnapshotToolOptions
}

export type ManualOwnerSnapshot = {
  tools: ManualOwnerSnapshotTool[]
}

export type ManualOwnerImportTool = {
  id: string
  toolType: string
  points: LineToolPoint[]
  options: Record<string, unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizePoint = (value: unknown): LineToolPoint | null => {
  if (!isRecord(value)) return null
  const rawTimestamp = Number(value.timestamp)
  const timestamp =
    Number.isFinite(rawTimestamp) && Math.abs(rawTimestamp) > 1e12
      ? rawTimestamp / 1000
      : rawTimestamp
  const price = Number(value.price)
  if (!Number.isFinite(timestamp) || !Number.isFinite(price)) return null
  return { timestamp, price }
}

const normalizeOptions = (value: unknown): ManualOwnerSnapshotToolOptions | undefined => {
  if (!isRecord(value)) return undefined

  const textRecord = isRecord(value.text) ? value.text : undefined
  const textValue = typeof textRecord?.value === 'string' ? textRecord.value : undefined

  const next: ManualOwnerSnapshotToolOptions = {}
  if (value.visible === false) next.visible = false
  if (textValue !== undefined) next.text = { value: textValue }

  return Object.keys(next).length > 0 ? next : undefined
}

const normalizeTool = (value: unknown): ManualOwnerSnapshotTool | null => {
  if (!isRecord(value)) return null

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const toolType = typeof value.toolType === 'string' ? value.toolType.trim() : ''
  if (!id || !toolType) return null

  if (!Array.isArray(value.points)) return null
  const points = value.points
    .map((point) => normalizePoint(point))
    .filter((point): point is LineToolPoint => point !== null)
  if (points.length === 0) return null

  const options = normalizeOptions(value.options)
  return options ? { id, toolType, points, options } : { id, toolType, points }
}

export const normalizeManualOwnerSnapshot = (raw: unknown): ManualOwnerSnapshot | null => {
  if (!isRecord(raw) || !Array.isArray(raw.tools)) return null
  const tools = raw.tools
    .map((tool) => normalizeTool(tool))
    .filter((tool): tool is ManualOwnerSnapshotTool => tool !== null)
  return { tools }
}

export const createEmptyManualOwnerSnapshot = (): ManualOwnerSnapshot => ({ tools: [] })

export const serializeManualOwnerSnapshot = (snapshot: ManualOwnerSnapshot | undefined): string =>
  snapshot ? JSON.stringify(snapshot) : ''

export const encodeManualOwnerSnapshot = (
  tools: Array<LineToolExport<any>>
): ManualOwnerSnapshot | null => {
  const normalized = tools
    .map((tool) => normalizeTool(tool))
    .filter((tool): tool is ManualOwnerSnapshotTool => tool !== null)

  if (normalized.length === 0) return null
  return { tools: normalized }
}

export const mergeManualOwnerSnapshots = (
  ...snapshots: Array<ManualOwnerSnapshot | null | undefined>
): ManualOwnerSnapshot | null => {
  const toolById = new Map<string, ManualOwnerSnapshotTool>()
  const orderedIds: string[] = []

  snapshots.forEach((snapshot) => {
    const normalized = normalizeManualOwnerSnapshot(snapshot)
    if (!normalized) return

    normalized.tools.forEach((tool) => {
      if (!toolById.has(tool.id)) {
        orderedIds.push(tool.id)
      }
      toolById.set(tool.id, tool)
    })
  })

  if (orderedIds.length === 0) {
    return null
  }

  const mergedTools = orderedIds
    .map((id) => toolById.get(id))
    .filter((tool): tool is ManualOwnerSnapshotTool => tool !== undefined)

  return mergedTools.length > 0 ? { tools: mergedTools } : null
}

export const decodeManualOwnerSnapshot = (snapshot: unknown): ManualOwnerImportTool[] => {
  const normalized = normalizeManualOwnerSnapshot(snapshot)
  if (!normalized) return []

  return normalized.tools.map((tool) => {
    const nextOptions: Record<string, unknown> = {}
    if (tool.options?.visible === false) {
      nextOptions.visible = false
    }

    if (typeof tool.options?.text?.value === 'string') {
      nextOptions.text = { value: tool.options.text.value }
    }

    return {
      id: tool.id,
      toolType: tool.toolType,
      points: tool.points.map((point) => ({ timestamp: point.timestamp, price: point.price })),
      options: nextOptions,
    }
  })
}
