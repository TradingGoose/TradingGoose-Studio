export interface General {
  isAutoConnectEnabled: boolean
  isAutoPanEnabled: boolean
  isConsoleExpandedByDefault: boolean
  showFloatingControls: boolean
  showTrainingControls: boolean
  superUserModeEnabled: boolean
  theme: 'system' | 'light' | 'dark'
  telemetryEnabled: boolean
  isLoading: boolean
  error: string | null
  isErrorNotificationsEnabled: boolean
  isAutoConnectLoading: boolean
  isAutoPanLoading: boolean
  isConsoleExpandedByDefaultLoading: boolean
  isThemeLoading: boolean
  isTelemetryLoading: boolean
  isBillingUsageNotificationsLoading: boolean
  isBillingUsageNotificationsEnabled: boolean
  isFloatingControlsLoading: boolean
  isTrainingControlsLoading: boolean
}

export interface GeneralActions {
  setSettings: (settings: Partial<General>) => void
  toggleAutoConnect: () => Promise<void>
  toggleAutoPan: () => Promise<void>
  toggleConsoleExpandedByDefault: () => Promise<void>
  toggleFloatingControls: () => Promise<void>
  toggleTrainingControls: () => Promise<void>
  setTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>
  setTelemetryEnabled: (enabled: boolean) => Promise<void>
  setBillingUsageNotificationsEnabled: (enabled: boolean) => Promise<void>
  loadSettings: (force?: boolean) => Promise<void>
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => Promise<void>
}

export type GeneralStore = General & GeneralActions

export type UserSettings = {
  theme: 'system' | 'light' | 'dark'
  autoConnect: boolean
  autoPan: boolean
  consoleExpandedByDefault: boolean
  showFloatingControls: boolean
  showTrainingControls: boolean
  telemetryEnabled: boolean
  isBillingUsageNotificationsEnabled: boolean
  superUserModeEnabled: boolean
  errorNotificationsEnabled: boolean
}
