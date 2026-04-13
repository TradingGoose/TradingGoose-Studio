export interface General {
  theme: 'system' | 'light' | 'dark'
  telemetryEnabled: boolean
  isLoading: boolean
  error: string | null
  isThemeLoading: boolean
  isTelemetryLoading: boolean
  isBillingUsageNotificationsEnabled: boolean
}

export interface GeneralActions {
  setSettings: (settings: Partial<General>) => void
  setTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>
  setTelemetryEnabled: (enabled: boolean) => Promise<void>
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => Promise<void>
}

export type GeneralStore = General & GeneralActions

export type UserSettings = {
  theme: 'system' | 'light' | 'dark'
  telemetryEnabled: boolean
  isBillingUsageNotificationsEnabled: boolean
}
