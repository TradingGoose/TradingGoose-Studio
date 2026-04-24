import {
  DEFAULT_MONITOR_VIEW_CONFIG,
  normalizeMonitorViewConfig,
  type CreateMonitorViewBody,
  type MonitorViewConfig,
  type MonitorViewRow,
} from './view-config'

type BootstrapMonitorViewsInput = {
  workspaceId: string
  listMonitorViews: (workspaceId: string) => Promise<MonitorViewRow[]>
  createMonitorView: (workspaceId: string, body: CreateMonitorViewBody) => Promise<MonitorViewRow>
}

export type BootstrapMonitorViewsResult = {
  viewStateMode: 'server' | 'error'
  viewRows: MonitorViewRow[]
  activeViewId: string | null
  viewConfig: MonitorViewConfig
  viewsError: string | null
}

export const bootstrapMonitorViews = async ({
  workspaceId,
  listMonitorViews,
  createMonitorView,
}: BootstrapMonitorViewsInput): Promise<BootstrapMonitorViewsResult> => {
  try {
    const rows = await listMonitorViews(workspaceId)

    if (rows.length === 0) {
      const createdRow = await createMonitorView(workspaceId, {
        name: 'Default View',
        config: DEFAULT_MONITOR_VIEW_CONFIG,
        makeActive: true,
      })

      const viewConfig = normalizeMonitorViewConfig(createdRow.config)

      return {
        viewStateMode: 'server',
        viewRows: [createdRow],
        activeViewId: createdRow.id,
        viewConfig,
        viewsError: null,
      }
    }

    const activeRow = rows.find((row) => row.isActive) ?? rows[0]!
    const viewConfig = normalizeMonitorViewConfig(activeRow.config)

    return {
      viewStateMode: 'server',
      viewRows: rows,
      activeViewId: activeRow.id,
      viewConfig,
      viewsError: null,
    }
  } catch (error) {
    const viewConfig = normalizeMonitorViewConfig(DEFAULT_MONITOR_VIEW_CONFIG)

    return {
      viewStateMode: 'error',
      viewRows: [],
      activeViewId: null,
      viewConfig,
      viewsError: error instanceof Error ? error.message : 'Unable to load monitor views.',
    }
  }
}
