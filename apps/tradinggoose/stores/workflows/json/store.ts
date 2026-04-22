import { createWithEqualityFn as create } from 'zustand/traditional'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { createWorkflowExportFile } from '@/lib/workflows/import-export'
import { getSnapshotForWorkflow } from '@/lib/yjs/workflow-session-registry'
import { useSkillsStore } from '@/stores/skills/store'
import type { SkillDefinition } from '@/stores/skills/types'
import { useWorkflowRegistry } from '../registry/store'

const logger = createLogger('WorkflowJsonStore')

export interface WorkflowJsonScope {
  workflowId?: string | null
  channelId?: string
  workspaceSkills?: Array<Pick<SkillDefinition, 'id' | 'name' | 'description' | 'content'>>
}

interface WorkflowJsonStore {
  json: string
  lastGenerated?: number

  generateJson: (scope?: WorkflowJsonScope) => void
  getJson: (scope?: WorkflowJsonScope) => Promise<string>
  refreshJson: (scope?: WorkflowJsonScope) => void
}

export const useWorkflowJsonStore = create<WorkflowJsonStore>()(
  devtools(
    (set, get) => ({
      json: '',
      lastGenerated: undefined,

      generateJson: (scope) => {
        const clearJson = () =>
          set({
            json: '',
            lastGenerated: Date.now(),
          })

        const scopedWorkflowId =
          typeof scope?.workflowId === 'string' && scope.workflowId.trim().length > 0
            ? scope.workflowId
            : null
        const registryState = useWorkflowRegistry.getState()
        const activeWorkflowId =
          scopedWorkflowId ?? registryState.getActiveWorkflowId(scope?.channelId)

        if (!activeWorkflowId) {
          logger.warn('No active workflow to generate JSON for')
          clearJson()
          return
        }

        try {
          const currentWorkflow = registryState.workflows[activeWorkflowId]

          if (!currentWorkflow) {
            logger.warn('No workflow metadata found for ID:', activeWorkflowId)
            clearJson()
            return
          }

          const workflowSnapshot = getSnapshotForWorkflow(activeWorkflowId)

          if (!workflowSnapshot) {
            logger.warn('No workflow state found for ID:', activeWorkflowId)
            clearJson()
            return
          }

          const workspaceSkills =
            scope?.workspaceSkills ??
            (currentWorkflow.workspaceId
              ? useSkillsStore
                  .getState()
                  .getAllSkills(currentWorkflow.workspaceId)
                  .map((skill) => ({
                    id: skill.id,
                    name: skill.name,
                    description: skill.description,
                    content: skill.content,
                  }))
              : [])

          const exportFile = createWorkflowExportFile({
            workflow: {
              name: currentWorkflow.name,
              description: currentWorkflow.description ?? '',
              color: currentWorkflow.color ?? '',
              state: workflowSnapshot,
            },
            skills: workspaceSkills,
          })

          // Convert to formatted JSON
          const jsonString = JSON.stringify(exportFile, null, 2)

          set({
            json: jsonString,
            lastGenerated: Date.now(),
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
        const currentTime = Date.now()
        const { json, lastGenerated } = get()
        const hasScope =
          typeof scope?.workflowId === 'string' ||
          (typeof scope?.channelId === 'string' && scope.channelId.length > 0)

        // Scoped requests are always refreshed to avoid channel/workflow cache mismatch.
        // Unscoped requests keep the short cache to reduce repeated work.
        if (hasScope || !lastGenerated || currentTime - lastGenerated > 1000) {
          get().generateJson(scope)
          return get().json
        }

        return json
      },

      refreshJson: (scope) => {
        get().generateJson(scope)
      },
    }),
    {
      name: 'workflow-json-store',
    }
  )
)
