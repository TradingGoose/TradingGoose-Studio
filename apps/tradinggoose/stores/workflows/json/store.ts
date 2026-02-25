import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { type ExportWorkflowState, sanitizeForExport } from '@/lib/workflows/json-sanitizer'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '../registry/store'

const logger = createLogger('WorkflowJsonStore')

export interface WorkflowJsonScope {
  workflowId?: string | null
  channelId?: string
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
        const scopedWorkflowId =
          typeof scope?.workflowId === 'string' && scope.workflowId.trim().length > 0
            ? scope.workflowId
            : null
        const activeWorkflowId =
          scopedWorkflowId ?? useWorkflowRegistry.getState().getActiveWorkflowId(scope?.channelId)

        if (!activeWorkflowId) {
          logger.warn('No active workflow to generate JSON for')
          return
        }

        try {
          // Get the workflow state with merged subblock values
          const workflow = getWorkflowWithValues(activeWorkflowId, scope?.channelId)

          if (!workflow || !workflow.state) {
            logger.warn('No workflow state found for ID:', activeWorkflowId)
            return
          }

          const workflowState = workflow.state

          // Sanitize for export (keeps positions, removes secrets, adds version)
          const exportState: ExportWorkflowState = sanitizeForExport(workflowState)

          // Convert to formatted JSON
          const jsonString = JSON.stringify(exportState, null, 2)

          set({
            json: jsonString,
            lastGenerated: Date.now(),
          })

          logger.info('Workflow JSON generated successfully', {
            version: exportState.version,
            exportedAt: exportState.exportedAt,
            blocksCount: Object.keys(exportState.state.blocks).length,
            edgesCount: exportState.state.edges.length,
            jsonLength: jsonString.length,
          })
        } catch (error) {
          logger.error('Failed to generate JSON:', error)
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
