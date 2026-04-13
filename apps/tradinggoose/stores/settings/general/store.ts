import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { syncThemeToNextThemes } from '@/lib/theme-sync'
import type { General, GeneralStore, UserSettings } from '@/stores/settings/general/types'

const logger = createLogger('GeneralStore')

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set, get) => {
        const store: General = {
          theme: 'system',
          telemetryEnabled: true,
          isLoading: false,
          error: null,
          isThemeLoading: false,
          isTelemetryLoading: false,
          isBillingUsageNotificationsEnabled: true,
        }

        const updateSettingOptimistic = async <K extends keyof UserSettings>(
          key: K,
          value: UserSettings[K],
          loadingKey: 'isThemeLoading' | 'isTelemetryLoading',
          stateKey: 'theme' | 'telemetryEnabled'
        ) => {
          if (get()[loadingKey]) return

          const originalValue = get()[stateKey]
          set({ [stateKey]: value, [loadingKey]: true } as Partial<General>)

          try {
            await get().updateSetting(key, value)
            set({ [loadingKey]: false } as Partial<General>)
          } catch (error) {
            set({ [stateKey]: originalValue, [loadingKey]: false } as Partial<General>)
            logger.error(`Failed to update ${String(key)}, rolled back:`, error)
          }
        }

        return {
          ...store,
          setSettings: (settings) => {
            set((state) => ({
              ...state,
              ...settings,
              isLoading: false,
              error: null,
            }))
          },
          setTheme: async (theme) => {
            if (get().isThemeLoading) return

            const originalTheme = get().theme
            set({ theme, isThemeLoading: true })
            syncThemeToNextThemes(theme)

            try {
              await get().updateSetting('theme', theme)
              set({ isThemeLoading: false })
            } catch (error) {
              set({ theme: originalTheme, isThemeLoading: false })
              syncThemeToNextThemes(originalTheme)
              logger.error('Failed to sync theme to database:', error)
              throw error
            }
          },
          setTelemetryEnabled: async (enabled) => {
            await updateSettingOptimistic(
              'telemetryEnabled',
              enabled,
              'isTelemetryLoading',
              'telemetryEnabled'
            )
          },
          updateSetting: async (key, value) => {
            if (typeof window !== 'undefined' && window.location.pathname.startsWith('/chat/')) {
              logger.debug(`Skipping setting update for ${key} on chat page`)
              return
            }

            try {
              const apiKey =
                key === 'isBillingUsageNotificationsEnabled'
                  ? 'billingUsageNotificationsEnabled'
                  : key

              const response = await fetch('/api/users/me/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [apiKey]: value }),
              })

              if (!response.ok) {
                throw new Error(`Failed to update setting: ${key}`)
              }

              set({ error: null })
            } catch (error) {
              logger.error(`Error updating setting ${key}:`, error)
              set({ error: error instanceof Error ? error.message : 'Unknown error' })
              throw error
            }
          },
        }
      },
      {
        name: 'general-settings',
      }
    ),
    { name: 'general-store' }
  )
)
