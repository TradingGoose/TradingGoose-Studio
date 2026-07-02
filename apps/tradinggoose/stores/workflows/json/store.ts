import { devtools } from 'zustand/middleware'
import { createWithEqualityFn as create } from 'zustand/traditional'
import { createLogger } from '@/lib/logs/console/logger'
import { createWorkflowExportFile } from '@/lib/workflows/import-export'
import { getSnapshotForWorkflow } from '@/lib/yjs/workflow-session-registry'
import { useSkillsStore } from '@/stores/skills/store'

const logger = createLogger('WorkflowJsonStore')

export interface WorkflowJsonScope {
  workflowId: string
  name: string
  description?: string
  workspaceId?: string | null
}

interface WorkflowJsonStore {
  json: string

  generateJson: (scope: WorkflowJsonScope) => Promise<void>
  getJson: (scope: WorkflowJsonScope) => Promise<string>
  refreshJson: (scope: WorkflowJsonScope) => Promise<void>
}

export const useWorkflowJsonStore = create<WorkflowJsonStore>()(
  devtools(
    (set, get) => ({
      json: '',

      generateJson: async (scope) => {
        const clearJson = () => set({ json: '' })

        const workflowId = scope.workflowId.trim()
        if (!workflowId) {
          logger.warn('No workflow to generate JSON for')
          clearJson()
          return
        }

        try {
          const workflowSnapshot = getSnapshotForWorkflow(workflowId)

          if (!workflowSnapshot) {
            logger.warn('No workflow state found for ID:', workflowId)
            clearJson()
            return
          }

          const exportFile = createWorkflowExportFile({
            workflow: {
              name: scope.name,
              description: scope.description ?? '',
              state: workflowSnapshot,
            },
            skills: scope.workspaceId
              ? useSkillsStore.getState().getAllSkills(scope.workspaceId)
              : [],
          })

          // Convert to formatted JSON
          const jsonString = JSON.stringify(exportFile, null, 2)

          set({
            json: jsonString,
          })

          logger.info('Workflow JSON generated successfully', {
            version: exportFile.version,
            exportedAt: exportFile.exportedAt,
            blocksCount: Object.keys(exportFile.workflows[0]?.state.blocks ?? {}).length,
            edgesCount: exportFile.workflows[0]?.state.edges.length ?? 0,
            skillsCount: exportFile.skills.length,
            jsonLength: jsonString.length,
          })
        } catch (error) {
          logger.error('Failed to generate JSON:', error)
          clearJson()
        }
      },

      getJson: async (scope) => {
        await get().generateJson(scope)
        return get().json
      },

      refreshJson: async (scope) => {
        await get().generateJson(scope)
      },
    }),
    {
      name: 'workflow-json-store',
    }
  )
)
