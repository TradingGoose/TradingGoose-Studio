import type { IndicatorMonitorRecord, IndicatorOption, WorkflowTargetOption } from './types'
import { parseErrorMessage, toTrimmed } from './utils'

const FALLBACK_INDICATOR_COLOR = '#3972F6'

export async function loadWorkflowTargetOptions(
  workspaceId: string
): Promise<WorkflowTargetOption[]> {
  const workflowsResponse = await fetch(
    `/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`
  )
  if (!workflowsResponse.ok) return []

  const workflowsPayload = await workflowsResponse.json().catch(() => ({}))
  const workflows = Array.isArray(workflowsPayload?.data) ? workflowsPayload.data : []
  if (workflows.length === 0) return []

  const details = await Promise.all(
    workflows.map(async (workflowRow: any) => {
      const id = toTrimmed(workflowRow?.id)
      if (!id) return []

      const detailResponse = await fetch(`/api/workflows/${encodeURIComponent(id)}`)
      if (!detailResponse.ok) return []
      const detailPayload = await detailResponse.json().catch(() => ({}))
      const blocks = detailPayload?.data?.state?.blocks
      if (!blocks || typeof blocks !== 'object') return []

      return Object.entries(blocks)
        .map(([blockId, blockData]) => {
          const data = blockData as { id?: string; type?: string; name?: string } | undefined
          if (data?.type !== 'indicator_trigger') return null

          const resolvedBlockId = toTrimmed(data?.id) || blockId
          const blockName = toTrimmed(data?.name) || 'Indicator Trigger'
          return {
            workflowId: id,
            blockId: resolvedBlockId,
            workflowName: toTrimmed(workflowRow?.name) || 'Workflow',
            workflowColor: toTrimmed(workflowRow?.color) || '#3972F6',
            blockName,
            label: `${toTrimmed(workflowRow?.name) || 'Workflow'} - ${blockName}`,
          } satisfies WorkflowTargetOption
        })
        .filter((entry): entry is WorkflowTargetOption => Boolean(entry))
    })
  )

  return details.flat().sort((a, b) => a.label.localeCompare(b.label))
}

export async function loadIndicatorOptions(workspaceId: string): Promise<IndicatorOption[]> {
  const response = await fetch(
    `/api/indicators/options?workspaceId=${encodeURIComponent(workspaceId)}`
  )
  if (!response.ok) return []

  const payload = await response.json().catch(() => ({}))
  const data = Array.isArray(payload?.data) ? payload.data : []

  return data
    .map((entry: any) => {
      const id = toTrimmed(entry?.id)
      const name = toTrimmed(entry?.name)
      const source = entry?.source === 'custom' ? 'custom' : 'default'
      const color =
        typeof entry?.color === 'string' && entry.color.trim().length > 0
          ? entry.color.trim()
          : FALLBACK_INDICATOR_COLOR
      if (!id || !name) return null
      return { id, name, source, color } satisfies IndicatorOption
    })
    .filter((entry: IndicatorOption | null): entry is IndicatorOption => Boolean(entry))
}

export async function loadMonitors(workspaceId: string): Promise<IndicatorMonitorRecord[]> {
  const response = await fetch(
    `/api/indicator-monitors?workspaceId=${encodeURIComponent(workspaceId)}`
  )

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const payload = await response.json().catch(() => ({}))
  return Array.isArray(payload?.data) ? payload.data : []
}
