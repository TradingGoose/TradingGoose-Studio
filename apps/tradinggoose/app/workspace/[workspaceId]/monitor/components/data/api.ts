import type {
  IndicatorMonitorCreateInput,
  IndicatorMonitorRecord,
  IndicatorMonitorStateUpdateInput,
  IndicatorMonitorUpdateInput,
  IndicatorOption,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from '../shared/types'
import { parseErrorMessage, toTrimmed } from '../shared/utils'
import type {
  CreateMonitorViewBody,
  MonitorPageMode,
  MonitorViewRow,
  MonitorViewsListResponse,
  UpdateMonitorViewBody,
} from '../view/view-config'
import { parseMonitorSavedViewConfig } from '../view/view-config'

const FALLBACK_INDICATOR_COLOR = '#3972F6'

export class MonitorViewRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'MonitorViewRequestError'
    this.status = status
  }
}

const throwMonitorViewRequestError = async (response: Response): Promise<never> => {
  throw new MonitorViewRequestError(await parseErrorMessage(response), response.status)
}

const verifyMonitorViewSuccessResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null)
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    (payload as { success?: unknown }).success !== true ||
    Object.keys(payload).length !== 1
  ) {
    throw new Error('Invalid monitor view success response')
  }
}

export const isUnsupportedMonitorViewDataError = (error: unknown) =>
  error instanceof MonitorViewRequestError && error.status === 409

const isMonitorPageMode = (value: unknown): value is MonitorPageMode =>
  value === 'executions' || value === 'config'

const isMonitorViewRowShape = (value: unknown): value is MonitorViewRow => {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<MonitorViewRow>

  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.sortOrder === 'number' &&
    typeof row.isActive === 'boolean' &&
    isMonitorPageMode(row.mode) &&
    Boolean(row.config) &&
    typeof row.config === 'object' &&
    isMonitorPageMode((row.config as { mode?: unknown }).mode) &&
    typeof row.createdAt === 'string' &&
    typeof row.updatedAt === 'string'
  )
}

const parseMonitorViewRowResponse = async (response: Response): Promise<MonitorViewRow> => {
  const payload = await response.json().catch(() => null)
  if (!isMonitorViewRowShape(payload)) {
    throw new Error('Invalid monitor view response')
  }

  const config = parseMonitorSavedViewConfig(payload.config)
  if (payload.mode !== config.mode) {
    throw new Error('Invalid monitor view response')
  }

  return {
    ...payload,
    mode: config.mode,
    config,
  }
}

const parseMonitorViewsListResponse = async (response: Response): Promise<MonitorViewRow[]> => {
  const payload = (await response.json().catch(() => null)) as MonitorViewsListResponse | null
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    throw new Error('Invalid monitor view response')
  }

  return payload.data.map((row) => {
    if (!isMonitorViewRowShape(row)) {
      throw new Error('Invalid monitor view response')
    }
    const config = parseMonitorSavedViewConfig(row.config)
    if (row.mode !== config.mode) {
      throw new Error('Invalid monitor view response')
    }
    return {
      ...row,
      mode: config.mode,
      config,
    }
  })
}

const parseMonitorResponse = async (response: Response): Promise<IndicatorMonitorRecord | null> => {
  const payload = await response.json().catch(() => null)
  const data = payload?.data
  return data && typeof data === 'object' ? (data as IndicatorMonitorRecord) : null
}

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

  return workflows
    .flatMap((workflowRow: any): WorkflowTargetOption[] => {
      const id = toTrimmed(workflowRow?.id)
      if (!id) return []

      const blocks = workflowRow?.deployedState?.blocks
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
    .sort((a: WorkflowTargetOption, b: WorkflowTargetOption) => a.label.localeCompare(b.label))
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
    `/api/indicators/options?workspaceId=${encodeURIComponent(workspaceId)}&surface=monitor`
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

      const inputTitles: string[] | undefined = Array.isArray(entry?.inputTitles)
        ? (Array.from(
            new Set(
              entry.inputTitles
                .filter((title: unknown): title is string => typeof title === 'string')
                .map((title: string) => title.trim())
                .filter(Boolean)
            )
          ) as string[])
        : undefined
      const inputMeta =
        entry?.inputMeta && typeof entry.inputMeta === 'object' && !Array.isArray(entry.inputMeta)
          ? Object.fromEntries(
              Object.entries(entry.inputMeta).filter(([title, meta]) => {
                if (!title.trim() || !meta || typeof meta !== 'object' || Array.isArray(meta)) {
                  return false
                }
                const metaTitle = (meta as { title?: unknown }).title
                return typeof metaTitle === 'string' && metaTitle.trim().length > 0
              })
            )
          : undefined

      return {
        id,
        name,
        source,
        color,
        ...(inputTitles && inputTitles.length > 0 ? { inputTitles } : {}),
        ...(inputMeta && Object.keys(inputMeta).length > 0
          ? { inputMeta: inputMeta as IndicatorOption['inputMeta'] }
          : {}),
      } satisfies IndicatorOption
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

export async function createIndicatorMonitor(
  body: IndicatorMonitorCreateInput
): Promise<IndicatorMonitorRecord | null> {
  const response = await fetch('/api/indicator-monitors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  return parseMonitorResponse(response)
}

export async function updateIndicatorMonitor(
  monitorId: string,
  body: IndicatorMonitorUpdateInput | IndicatorMonitorStateUpdateInput
): Promise<IndicatorMonitorRecord | null> {
  const response = await fetch(`/api/indicator-monitors/${encodeURIComponent(monitorId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  return parseMonitorResponse(response)
}

export async function deleteIndicatorMonitor(monitorId: string) {
  const response = await fetch(`/api/indicator-monitors/${encodeURIComponent(monitorId)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
}

export async function listMonitorViews(workspaceId: string): Promise<MonitorViewRow[]> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views`)

  if (!response.ok) {
    await throwMonitorViewRequestError(response)
  }

  return parseMonitorViewsListResponse(response)
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
    await throwMonitorViewRequestError(response)
  }

  return parseMonitorViewRowResponse(response)
}

export async function setActiveMonitorView(workspaceId: string, activeViewId: string) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeViewId }),
  })

  if (!response.ok) {
    await throwMonitorViewRequestError(response)
  }

  await verifyMonitorViewSuccessResponse(response)
}

export async function reorderMonitorViews(
  workspaceId: string,
  body: {
    mode: MonitorPageMode
    viewOrder: string[]
    activeViewId?: string
  }
) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwMonitorViewRequestError(response)
  }

  await verifyMonitorViewSuccessResponse(response)
}

export async function updateMonitorView(
  workspaceId: string,
  viewId: string,
  body: UpdateMonitorViewBody
): Promise<MonitorViewRow> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views/${encodeURIComponent(viewId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    await throwMonitorViewRequestError(response)
  }

  return parseMonitorViewRowResponse(response)
}

export async function removeMonitorView(workspaceId: string, viewId: string) {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/monitor-views/${encodeURIComponent(viewId)}`,
    {
      method: 'DELETE',
    }
  )

  if (!response.ok) {
    await throwMonitorViewRequestError(response)
  }

  await verifyMonitorViewSuccessResponse(response)
}
