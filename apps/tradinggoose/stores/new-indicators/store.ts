import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import type { NewIndicatorsStore } from '@/stores/new-indicators/types'

const logger = createLogger('NewIndicatorsStore')

const initialState = {
  indicatorsByWorkspace: {},
  activeWorkspaceId: null,
} satisfies Pick<NewIndicatorsStore, 'indicatorsByWorkspace' | 'activeWorkspaceId'>

export const useNewIndicatorsStore = create<NewIndicatorsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setIndicators: (workspaceId, indicators) => {
        set((state) => {
          const current = state.indicatorsByWorkspace[workspaceId] ?? []
          const isSame =
            current.length === indicators.length &&
            current.every((indicator, index) => {
              const next = indicators[index]
              if (!next) return false
              return (
                indicator.id === next.id &&
                indicator.updatedAt === next.updatedAt &&
                indicator.name === next.name &&
                (indicator.color ?? '') === (next.color ?? '') &&
                (indicator.pineCode ?? '') === (next.pineCode ?? '')
              )
            })

          if (isSame) {
            return state
          }

          logger.info(`Synced ${indicators.length} pine indicators for workspace ${workspaceId}`)
          return {
            indicatorsByWorkspace: {
              ...state.indicatorsByWorkspace,
              [workspaceId]: indicators,
            },
            activeWorkspaceId: workspaceId,
          }
        })
      },

      getIndicator: (id, workspaceId) => {
        const targetWorkspace = workspaceId ?? get().activeWorkspaceId
        if (!targetWorkspace) return undefined
        return get().indicatorsByWorkspace[targetWorkspace]?.find((indicator) => indicator.id === id)
      },

      getAllIndicators: (workspaceId) => {
        const targetWorkspace = workspaceId ?? get().activeWorkspaceId
        if (!targetWorkspace) return []
        return get().indicatorsByWorkspace[targetWorkspace] ?? []
      },

      resetWorkspace: (workspaceId) => {
        set((state) => {
          const next = { ...state.indicatorsByWorkspace }
          delete next[workspaceId]
          return {
            indicatorsByWorkspace: next,
            activeWorkspaceId:
              state.activeWorkspaceId === workspaceId ? null : state.activeWorkspaceId,
          }
        })
      },

      resetAll: () => set(initialState),
    }),
    {
      name: 'new-indicators-store',
    }
  )
)

