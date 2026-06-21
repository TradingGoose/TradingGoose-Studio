import { createWithEqualityFn as create } from 'zustand/traditional'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import {
  collectWorkflowSkillIds,
  createWorkflowExportFile,
} from '@/lib/workflows/import-export'
import { getEntityFields } from '@/lib/yjs/entity-session'
import { bootstrapYjsProvider } from '@/lib/yjs/provider'
import { getSnapshotForWorkflow } from '@/lib/yjs/workflow-session-registry'
import { useWorkflowRegistry } from '../registry/store'

const logger = createLogger('WorkflowJsonStore')

export interface WorkflowJsonScope {
  workflowId?: string | null
  channelId?: string
}

interface WorkflowJsonStore {
  json: string
  lastGenerated?: number

  generateJson: (scope?: WorkflowJsonScope) => Promise<void>
  getJson: (scope?: WorkflowJsonScope) => Promise<string>
  refreshJson: (scope?: WorkflowJsonScope) => Promise<void>
}

async function readWorkflowSkillExportsFromYjs(
  workflowSnapshot: NonNullable<ReturnType<typeof getSnapshotForWorkflow>>,
  workspaceId: string | null | undefined
) {
  const skillIds = collectWorkflowSkillIds(workflowSnapshot)
  if (skillIds.length === 0) {
    return []
  }
  if (!workspaceId) {
    return null
  }

  return Promise.all(
    skillIds.map(async (skillId) => {
      const session = await bootstrapYjsProvider({
        workspaceId,
        entityKind: 'skill',
        entityId: skillId,
        draftSessionId: null,
        reviewSessionId: null,
        yjsSessionId: skillId,
      })

      try {
        const fields = getEntityFields(session.doc, 'skill')
        return {
          id: skillId,
          name: String(fields.name ?? ''),
          description: String(fields.description ?? ''),
          content: String(fields.content ?? ''),
        }
      } finally {
        session.provider.disconnect()
        session.provider.destroy()
        session.doc.destroy()
      }
    })
  )
}

export const useWorkflowJsonStore = create<WorkflowJsonStore>()(
  devtools(
    (set, get) => ({
      json: '',
      lastGenerated: undefined,

      generateJson: async (scope) => {
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

          const workflowSkills = await readWorkflowSkillExportsFromYjs(
            workflowSnapshot,
            currentWorkflow.workspaceId
          )

          if (!workflowSkills) {
            logger.warn('Workflow workspace missing for skill export:', activeWorkflowId)
            clearJson()
            return
          }

          const exportFile = createWorkflowExportFile({
            workflow: {
              name: currentWorkflow.name,
              description: currentWorkflow.description ?? '',
              state: workflowSnapshot,
            },
            skills: workflowSkills,
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
          await get().generateJson(scope)
          return get().json
        }

        return json
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
