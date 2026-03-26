import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import type { SkillsStore } from '@/stores/skills/types'

const logger = createLogger('SkillsStore')

const initialState = {
  skillsByWorkspace: {},
  activeWorkspaceId: null,
} satisfies Pick<SkillsStore, 'skillsByWorkspace' | 'activeWorkspaceId'>

export const useSkillsStore = create<SkillsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setSkills: (workspaceId, skills) => {
        logger.info(`Synced ${skills.length} skills for workspace ${workspaceId}`)
        set((state) => ({
          skillsByWorkspace: {
            ...state.skillsByWorkspace,
            [workspaceId]: skills,
          },
          activeWorkspaceId: workspaceId,
        }))
      },

      getSkill: (id, workspaceId) => {
        const targetWorkspace = workspaceId ?? get().activeWorkspaceId
        if (!targetWorkspace) return undefined
        return get().skillsByWorkspace[targetWorkspace]?.find(
          (currentSkill) => currentSkill.id === id
        )
      },

      getAllSkills: (workspaceId) => {
        const targetWorkspace = workspaceId ?? get().activeWorkspaceId
        if (!targetWorkspace) return []
        return get().skillsByWorkspace[targetWorkspace] ?? []
      },

      resetWorkspace: (workspaceId) => {
        set((state) => {
          const next = { ...state.skillsByWorkspace }
          delete next[workspaceId]
          return {
            skillsByWorkspace: next,
            activeWorkspaceId:
              state.activeWorkspaceId === workspaceId ? null : state.activeWorkspaceId,
          }
        })
      },

      resetAll: () => set(initialState),
    }),
    {
      name: 'skills-store',
    }
  )
)
