import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { defaultLocale, isLocaleCode, type LocaleCode } from '@/i18n/utils'
import { useGeneralStore } from '@/stores/settings/general/store'

export const generalSettingsKeys = {
  all: ['generalSettings'] as const,
  settings: (userId: string | null) => [...generalSettingsKeys.all, 'settings', userId] as const,
}

export interface GeneralSettings {
  theme: 'light' | 'dark' | 'system'
  preferredLocale: LocaleCode
  telemetryEnabled: boolean
  billingUsageNotificationsEnabled: boolean
}

export async function fetchGeneralSettings(): Promise<GeneralSettings> {
  const response = await fetch('/api/users/me/settings')

  if (!response.ok) {
    throw new Error('Failed to fetch general settings')
  }

  const { data } = await response.json()

  return {
    theme: data.theme || 'system',
    preferredLocale: isLocaleCode(data.preferredLocale) ? data.preferredLocale : defaultLocale,
    telemetryEnabled: data.telemetryEnabled ?? true,
    billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled ?? true,
  }
}

export async function patchBillingUsageNotifications(value: boolean): Promise<void> {
  const response = await fetch('/api/users/me/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ billingUsageNotificationsEnabled: value }),
  })

  if (!response.ok) {
    throw new Error('Failed to update billing usage notifications')
  }
}

export function getGeneralSettingsResponsePatch(
  settings: GeneralSettings,
  mutations: { isThemeLoading: boolean; isTelemetryLoading: boolean }
) {
  return {
    ...(!mutations.isThemeLoading ? { theme: settings.theme } : {}),
    ...(!mutations.isTelemetryLoading ? { telemetryEnabled: settings.telemetryEnabled } : {}),
    isBillingUsageNotificationsEnabled: settings.billingUsageNotificationsEnabled,
  }
}

export function useGeneralSettings({
  enabled = true,
  userId,
}: {
  enabled?: boolean
  userId: string | null
}) {
  const query = useQuery({
    queryKey: generalSettingsKeys.settings(userId),
    queryFn: fetchGeneralSettings,
    enabled: enabled && Boolean(userId),
    staleTime: 60 * 60 * 1000,
  })

  useEffect(() => {
    if (!userId || !query.data) return

    const state = useGeneralStore.getState()
    state.setSettings(getGeneralSettingsResponsePatch(query.data, state))
  }, [query.data, query.dataUpdatedAt, userId])

  return query
}
