import { isUnsupportedMonitorViewDataError } from '../data/api'
import {
  type CreateMonitorViewBody,
  getDefaultMonitorViewConfig,
  getDefaultMonitorViewName,
  type MonitorPageMode,
  type MonitorSavedViewConfig,
  type MonitorViewRow,
  normalizeMonitorSavedViewConfig,
} from './view-config'

const MODE_ORDER: MonitorPageMode[] = ['executions', 'config']

type BootstrapMonitorViewsInput = {
  workspaceId: string
  preferredActiveMode?: MonitorPageMode
  preferredActiveViewIdsByMode?: Partial<Record<MonitorPageMode, string | null>>
  listMonitorViews: (workspaceId: string) => Promise<MonitorViewRow[]>
  createMonitorView: (workspaceId: string, body: CreateMonitorViewBody) => Promise<MonitorViewRow>
}

export type BootstrapMonitorViewsResult = {
  viewStateMode: 'server' | 'partial-error' | 'error'
  viewRows: MonitorViewRow[]
  activeViewIdsByMode: Partial<Record<MonitorPageMode, string | null>>
  configsByMode: Record<MonitorPageMode, MonitorSavedViewConfig>
  rowStateByMode: Record<MonitorPageMode, 'server' | 'error'>
  errorsByMode: Partial<Record<MonitorPageMode, string>>
  renderableModes: MonitorPageMode[]
  initialMode: MonitorPageMode
  viewsError: string | null
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback

const getRowsForMode = (rows: MonitorViewRow[], mode: MonitorPageMode) =>
  rows.filter((row) => row.mode === mode)

const chooseActiveRow = (
  rows: MonitorViewRow[],
  mode: MonitorPageMode,
  preferredActiveViewIdsByMode: Partial<Record<MonitorPageMode, string | null>>
) => {
  const sameModeRows = getRowsForMode(rows, mode)
  const preferredId = preferredActiveViewIdsByMode[mode]
  if (preferredId) {
    const preferredRow = sameModeRows.find((row) => row.id === preferredId)
    if (preferredRow) return preferredRow
  }
  return sameModeRows.find((row) => row.isActive) ?? sameModeRows[0] ?? null
}

const buildFatalResult = (
  error: unknown,
  preferredActiveMode: MonitorPageMode
): BootstrapMonitorViewsResult => {
  const message = getErrorMessage(error, 'Unable to load monitor views.')

  return {
    viewStateMode: 'error',
    viewRows: [],
    activeViewIdsByMode: {},
    configsByMode: {
      executions: getDefaultMonitorViewConfig('executions'),
      config: getDefaultMonitorViewConfig('config'),
    },
    rowStateByMode: { executions: 'error', config: 'error' },
    errorsByMode: { executions: message, config: message },
    renderableModes: [],
    initialMode: preferredActiveMode,
    viewsError: message,
  }
}

export const bootstrapMonitorViews = async ({
  workspaceId,
  preferredActiveMode = 'executions',
  preferredActiveViewIdsByMode = {},
  listMonitorViews,
  createMonitorView,
}: BootstrapMonitorViewsInput): Promise<BootstrapMonitorViewsResult> => {
  const normalizedPreferredMode =
    preferredActiveMode === 'config' || preferredActiveMode === 'executions'
      ? preferredActiveMode
      : 'executions'

  let rows: MonitorViewRow[]
  try {
    rows = await listMonitorViews(workspaceId)
  } catch (error) {
    return buildFatalResult(error, normalizedPreferredMode)
  }

  const errorsByMode: Partial<Record<MonitorPageMode, string>> = {}
  const rowStateByMode: Record<MonitorPageMode, 'server' | 'error'> = {
    executions: 'error',
    config: 'error',
  }
  const mutableRows = [...rows]

  for (const mode of MODE_ORDER) {
    if (getRowsForMode(mutableRows, mode).length > 0) {
      rowStateByMode[mode] = 'server'
      continue
    }

    try {
      const createdRow = await createMonitorView(workspaceId, {
        name: getDefaultMonitorViewName(mode),
        config: getDefaultMonitorViewConfig(mode),
        makeActive: true,
      })
      mutableRows.push(createdRow)
      rowStateByMode[mode] = 'server'
    } catch (error) {
      rowStateByMode[mode] = 'error'
      errorsByMode[mode] = getErrorMessage(
        error,
        `Unable to create default ${getDefaultMonitorViewName(mode)} view.`
      )
      if (isUnsupportedMonitorViewDataError(error)) {
        errorsByMode[mode] = getErrorMessage(error, errorsByMode[mode]!)
      }
    }
  }

  const activeViewIdsByMode: Partial<Record<MonitorPageMode, string | null>> = {}
  const configsByMode: Record<MonitorPageMode, MonitorSavedViewConfig> = {
    executions: getDefaultMonitorViewConfig('executions'),
    config: getDefaultMonitorViewConfig('config'),
  }

  for (const mode of MODE_ORDER) {
    if (rowStateByMode[mode] !== 'server') continue

    const activeRow = chooseActiveRow(mutableRows, mode, preferredActiveViewIdsByMode)
    if (!activeRow) continue

    const normalizedConfig = normalizeMonitorSavedViewConfig(activeRow.config)
    if (!normalizedConfig || normalizedConfig.mode !== mode || activeRow.mode !== mode) {
      rowStateByMode[mode] = 'error'
      errorsByMode[mode] = 'Invalid monitor view response'
      continue
    }

    activeViewIdsByMode[mode] = activeRow.id
    configsByMode[mode] = normalizedConfig
  }

  const renderableModes = MODE_ORDER.filter((mode) => rowStateByMode[mode] === 'server')
  const viewStateMode =
    renderableModes.length === MODE_ORDER.length
      ? 'server'
      : renderableModes.length > 0
        ? 'partial-error'
        : 'error'

  const initialMode = renderableModes.includes(normalizedPreferredMode)
    ? normalizedPreferredMode
    : (renderableModes[0] ?? normalizedPreferredMode)
  const viewsError =
    Object.values(errorsByMode).filter(Boolean).join(' ') ||
    (viewStateMode === 'error' ? 'Unable to load monitor views.' : null)

  return {
    viewStateMode,
    viewRows: mutableRows,
    activeViewIdsByMode,
    configsByMode,
    rowStateByMode,
    errorsByMode,
    renderableModes,
    initialMode,
    viewsError,
  }
}
