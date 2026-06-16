import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { useSession } from '@/lib/auth-client'
import { useGeneralStore } from '@/stores/settings/general/store'

const logger = createLogger('GeneralSettingsQuery')

export const generalSettingsKeys = {
  all: ['generalSettings'] as const,
  settings: (userId: string | null) => [...generalSettingsKeys.all, 'settings', userId] as const,
}

export interface GeneralSettings {
  theme: 'light' | 'dark' | 'system'
  telemetryEnabled: boolean
  billingUsageNotificationsEnabled: boolean
}

async function fetchGeneralSettings(): Promise<GeneralSettings> {
  const response = await fetch('/api/users/me/settings')

  if (!response.ok) {
    throw new Error('Failed to fetch general settings')
  }

  const { data } = await response.json()

  return {
    theme: data.theme || 'system',
    telemetryEnabled: data.telemetryEnabled ?? true,
    billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled ?? true,
  }
}

function syncSettingsToZustand(settings: GeneralSettings) {
  const { setSettings } = useGeneralStore.getState()

  setSettings({
    theme: settings.theme,
    telemetryEnabled: settings.telemetryEnabled,
    isBillingUsageNotificationsEnabled: settings.billingUsageNotificationsEnabled,
  })
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
    if (userId && query.data) {
      syncSettingsToZustand(query.data)
    }
  }, [query.data, userId])

  return query
}

interface UpdateSettingParams {
  key: keyof GeneralSettings
  value: any
}

export function useUpdateGeneralSetting() {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const userId = session?.user?.id ?? null
  const settingsKey = generalSettingsKeys.settings(userId)

  return useMutation({
    mutationFn: async ({ key, value }: UpdateSettingParams) => {
      const response = await fetch('/api/users/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })

      if (!response.ok) {
        throw new Error(`Failed to update setting: ${key}`)
      }

      return response.json()
    },
    onMutate: async ({ key, value }) => {
      if (!userId) {
        return { previousSettings: undefined }
      }

      await queryClient.cancelQueries({ queryKey: settingsKey })

      const previousSettings = queryClient.getQueryData<GeneralSettings>(settingsKey)

      if (previousSettings) {
        const newSettings = {
          ...previousSettings,
          [key]: value,
        }
        queryClient.setQueryData<GeneralSettings>(settingsKey, newSettings)
        syncSettingsToZustand(newSettings)
      }

      return { previousSettings }
    },
    onError: (err, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(settingsKey, context.previousSettings)
        syncSettingsToZustand(context.previousSettings)
      }
      logger.error('Failed to update setting:', err)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKey })
    },
  })
}
