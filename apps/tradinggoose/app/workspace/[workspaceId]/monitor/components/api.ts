import type {
  IndicatorMonitorRecord,
  IndicatorOption,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from './types'
import { parseErrorMessage, toTrimmed } from './utils'
import type {
  CreateMonitorViewBody,
  MonitorViewRow,
  MonitorViewsListResponse,
  UpdateMonitorViewBody,
} from './view-config'

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

      const detailResponse = await fetch(`/api/workflows/${encodeURIComponent(id)}/deployed`)
      if (!detailResponse.ok) return []
      const detailPayload = await detailResponse.json().catch(() => ({}))
      const blocks = detailPayload?.deployedState?.blocks
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
            isDeployed: true,
            blockName,
            label: `${toTrimmed(workflowRow?.name) || 'Workflow'} - ${blockName}`,
          } satisfies WorkflowTargetOption
        })
        .filter(Boolean) as WorkflowTargetOption[]
    })
  )

  return details.flat().sort((a, b) => a.label.localeCompare(b.label))
}

export async function loadWorkflowOptions(workspaceId: string): Promise<WorkflowPickerOption[]> {
  const response = await fetch(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`)
  if (!response.ok) return []

  const payload = await response.json().catch(() => ({}))
  const workflows = Array.isArray(payload?.data) ? payload.data : []

  return workflows
    .map((entry: any) => {
      const workflowId = toTrimmed(entry?.id)
      const workflowName = toTrimmed(entry?.name)
      if (!workflowId || !workflowName) return null

      return {
        workflowId,
        workflowName,
        workflowColor: toTrimmed(entry?.color) || '#3972F6',
      } satisfies WorkflowPickerOption
    })
    .filter((entry: WorkflowPickerOption | null): entry is WorkflowPickerOption => Boolean(entry))
    .sort((left: WorkflowPickerOption, right: WorkflowPickerOption) =>
      left.workflowName.localeCompare(right.workflowName)
    )
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

export async function listMonitorViews(workspaceId: string): Promise<MonitorViewRow[]> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views`)

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const payload = (await response.json().catch(() => ({}))) as MonitorViewsListResponse
  return Array.isArray(payload?.data) ? payload.data : []
}

export async function createMonitorView(
  workspaceId: string,
  body: CreateMonitorViewBody
): Promise<MonitorViewRow> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const payload = await response.json().catch(() => ({}))
  return payload as MonitorViewRow
}

export async function activateMonitorView(workspaceId: string, activeViewId: string) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeViewId }),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
}

export async function updateMonitorView(
  workspaceId: string,
  viewId: string,
  body: UpdateMonitorViewBody
) {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views/${encodeURIComponent(viewId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
}

export async function removeMonitorView(workspaceId: string, viewId: string) {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views/${encodeURIComponent(viewId)}`,
    {
      method: 'DELETE',
    }
  )

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
}
