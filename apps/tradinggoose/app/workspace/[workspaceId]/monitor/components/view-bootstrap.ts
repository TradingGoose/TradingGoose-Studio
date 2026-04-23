import {
  DEFAULT_MONITOR_VIEW_CONFIG,
  normalizeMonitorViewConfig,
  type CreateMonitorViewBody,
  type MonitorViewConfig,
  type MonitorViewRow,
} from './view-config'

type BootstrapMonitorViewsInput = {
  workspaceId: string
  getLocalWorkingConfig: () => MonitorViewConfig
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

const resolveWorkingConfig = (getLocalWorkingConfig: () => MonitorViewConfig) =>
  normalizeMonitorViewConfig(getLocalWorkingConfig())

export const bootstrapMonitorViews = async ({
  workspaceId,
  getLocalWorkingConfig,
  listMonitorViews,
  createMonitorView,
}: BootstrapMonitorViewsInput): Promise<BootstrapMonitorViewsResult> => {
  try {
    const rows = await listMonitorViews(workspaceId)

    if (rows.length > 0) {
      const activeRow = rows.find((row) => row.isActive) ?? rows[0]

      return {
        viewStateMode: 'server',
        viewRows: rows,
        activeViewId: activeRow?.id ?? null,
        viewConfig: activeRow
          ? normalizeMonitorViewConfig(activeRow.config)
          : DEFAULT_MONITOR_VIEW_CONFIG,
        viewsError: null,
      }
    }

    try {
      const localWorkingConfig = resolveWorkingConfig(getLocalWorkingConfig)
      const createdRow = await createMonitorView(workspaceId, {
        name: 'Default View',
        config: localWorkingConfig,
        makeActive: true,
      })

      return {
        viewStateMode: 'server',
        viewRows: [createdRow],
        activeViewId: createdRow.id,
        viewConfig: normalizeMonitorViewConfig(createdRow.config),
        viewsError: null,
      }
    } catch (error) {
      const localWorkingConfig = resolveWorkingConfig(getLocalWorkingConfig)

      return {
        viewStateMode: 'error',
        viewRows: [],
        activeViewId: null,
        viewConfig: localWorkingConfig,
        viewsError:
          error instanceof Error ? error.message : 'Unable to save the default monitor view.',
      }
    }
  } catch (error) {
    const localWorkingConfig = resolveWorkingConfig(getLocalWorkingConfig)

    return {
      viewStateMode: 'error',
      viewRows: [],
      activeViewId: null,
      viewConfig: localWorkingConfig,
      viewsError:
        error instanceof Error ? error.message : 'Unable to load monitor views.',
    }
  }
}
