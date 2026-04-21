import { createWithEqualityFn as create } from 'zustand/traditional'
import { devtools } from 'zustand/middleware'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { populateTriggerFieldsFromConfig } from '@/hooks/use-trigger-config-aggregation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { SubBlockStore } from '@/stores/workflows/subblock/types'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store'
import { isTriggerValid } from '@/triggers'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'

/**
 * SubBlockState stores values for all subblocks in workflows
 *
 * Important implementation notes:
 * 1. Values are stored per workflow, per block, per subblock
 * 2. When workflows are synced to the database, the mergeSubblockState function
 *    in utils.ts combines the block structure with these values
 * 3. If a subblock value exists here but not in the block structure
 *    (e.g., inputFormat in the input trigger block), the merge function will include it
 *    in the synchronized state to ensure persistence
 */

export const useSubBlockStore = create<SubBlockStore>()(
  devtools((set, get) => ({
    workflowValues: {},
    loadingWebhooks: new Set<string>(),
    checkedWebhooks: new Set<string>(),

    setValue: (blockId: string, subBlockId: string, value: any, workflowId?: string) => {
      const resolvedWorkflowId =
        workflowId ??
        useWorkflowRegistry.getState().getActiveWorkflowId(DEFAULT_WORKFLOW_CHANNEL_ID)
      if (!resolvedWorkflowId) return

      // Validate and fix table data if needed
      let validatedValue = value
      if (Array.isArray(value)) {
        // Check if this looks like table data (array of objects with cells)
        const isTableData =
          value.length > 0 &&
          value.some((item) => item && typeof item === 'object' && 'cells' in item)

        if (isTableData) {
          console.log('Validating table data for subblock:', { blockId, subBlockId })
          validatedValue = value.map((row: any) => {
            // Ensure each row has proper structure
            if (!row || typeof row !== 'object') {
              console.warn('Fixing malformed table row:', row)
              return {
                id: crypto.randomUUID(),
                cells: { Key: '', Value: '' },
              }
            }

            // Ensure row has an id
            if (!row.id) {
              row.id = crypto.randomUUID()
            }

            // Ensure row has cells object
            if (!row.cells || typeof row.cells !== 'object') {
              console.warn('Fixing malformed table row cells:', row)
              row.cells = { Key: '', Value: '' }
            }

            return row
          })
        }
      }

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [resolvedWorkflowId]: {
            ...state.workflowValues[resolvedWorkflowId],
            [blockId]: {
              ...state.workflowValues[resolvedWorkflowId]?.[blockId],
              [subBlockId]: validatedValue,
            },
          },
        },
      }))

      // Trigger debounced sync to DB
      get().syncWithDB()
    },

    getValue: (blockId: string, subBlockId: string, workflowId?: string) => {
      const resolvedWorkflowId =
        workflowId ??
        useWorkflowRegistry.getState().getActiveWorkflowId(DEFAULT_WORKFLOW_CHANNEL_ID)
      if (!resolvedWorkflowId) return null

      return get().workflowValues[resolvedWorkflowId]?.[blockId]?.[subBlockId] ?? null
    },

    clear: () => {
      const activeWorkflowId = useWorkflowRegistry
        .getState()
        .getActiveWorkflowId(DEFAULT_WORKFLOW_CHANNEL_ID)
      if (!activeWorkflowId) return

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: {},
        },
      }))

      // Note: Socket.IO handles real-time sync automatically
    },
    setWorkflowValues: (workflowId: string, values: Record<string, Record<string, any>>) => {
      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [workflowId]: values,
        },
      }))
    },

    initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => {
      // Initialize from blocks
      const values: Record<string, Record<string, any>> = {}
      Object.entries(blocks).forEach(([blockId, block]) => {
        values[blockId] = {}
        Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
          values[blockId][subBlockId] = (subBlock as SubBlockConfig).value
        })
      })

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [workflowId]: values,
        },
      }))

      Object.entries(blocks).forEach(([blockId, block]) => {
        const blockConfig = getBlock(block.type)
        if (!blockConfig) return

        const isTriggerBlock = blockConfig.category === 'triggers' || block.triggerMode === true
        if (!isTriggerBlock) return

        const triggerId = resolveTriggerIdForBlock(block) ?? undefined

        if (!triggerId || !isTriggerValid(triggerId)) {
          return
        }

        const triggerConfigSubBlock = block.subBlocks?.triggerConfig
        if (triggerConfigSubBlock?.value && typeof triggerConfigSubBlock.value === 'object') {
          populateTriggerFieldsFromConfig(
            blockId,
            triggerConfigSubBlock.value,
            triggerId,
            workflowId
          )

          const currentChecked = get().checkedWebhooks
          if (currentChecked.has(blockId)) {
            set((state) => {
              const newSet = new Set(state.checkedWebhooks)
              newSet.delete(blockId)
              return { checkedWebhooks: newSet }
            })
          }
        }
      })
    },

    // Removed syncWithDB - Socket.IO handles real-time sync automatically
    syncWithDB: () => {
      // No-op: Socket.IO handles real-time sync
    },
  }))
)
