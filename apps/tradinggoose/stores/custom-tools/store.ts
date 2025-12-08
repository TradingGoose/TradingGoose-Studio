import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import type { CustomToolsStore } from '@/stores/custom-tools/types'

const logger = createLogger('CustomToolsStore')

const initialState = {
  toolsByWorkspace: {},
  activeWorkspaceId: null,
} satisfies Pick<CustomToolsStore, 'toolsByWorkspace' | 'activeWorkspaceId'>

export const useCustomToolsStore = create<CustomToolsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setTools: (workspaceId, tools) => {
        logger.info(`Synced ${tools.length} custom tools for workspace ${workspaceId}`)
        set((state) => ({
          toolsByWorkspace: {
            ...state.toolsByWorkspace,
            [workspaceId]: tools,
          },
          activeWorkspaceId: workspaceId,
        }))
      },

      getTool: (id, workspaceId) => {
        const targetWorkspace = workspaceId ?? get().activeWorkspaceId
        if (!targetWorkspace) return undefined
        return get().toolsByWorkspace[targetWorkspace]?.find((tool) => tool.id === id)
      },

      getAllTools: (workspaceId) => {
        const targetWorkspace = workspaceId ?? get().activeWorkspaceId
        if (!targetWorkspace) return []
        return get().toolsByWorkspace[targetWorkspace] ?? []
      },

      resetWorkspace: (workspaceId) => {
        set((state) => {
          const next = { ...state.toolsByWorkspace }
          delete next[workspaceId]
          return {
            toolsByWorkspace: next,
            activeWorkspaceId: state.activeWorkspaceId === workspaceId ? null : state.activeWorkspaceId,
          }
        })
      },

      resetAll: () => set(initialState),
    }),
    {
      name: 'custom-tools-store',
    }
  )
)
