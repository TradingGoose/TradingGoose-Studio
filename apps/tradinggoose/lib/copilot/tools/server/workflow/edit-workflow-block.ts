import { getBlock } from '@/blocks'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getAllowedSubBlockIds } from '@/lib/workflows/block-config-canonicalization'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  buildWorkflowMutationResult,
  loadBaseWorkflowState,
} from './workflow-mutation-utils'

interface EditWorkflowBlockParams {
  workflowId: string
  blockId: string
  blockType?: string
  name?: string
  enabled?: boolean
  subBlocks?: Record<string, unknown>
  currentWorkflowState?: string
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function throwInvalidBlockEdit(input: {
  error: string
  hint: string
  issues?: Array<{ path: string; message: string }>
}): never {
  throw new StructuredServerToolError({
    status: 422,
    body: {
      code: 'invalid_workflow_block_edit',
      error: input.error,
      hint: input.hint,
      retryable: true,
      ...(input.issues ? { issues: input.issues } : {}),
    },
  })
}

export const editWorkflowBlockServerTool: BaseServerTool<EditWorkflowBlockParams, any> = {
  name: 'edit_workflow_block',
  async execute(params: EditWorkflowBlockParams): Promise<any> {
    const logger = createLogger('EditWorkflowBlockServerTool')
    const { workflowId, blockId, blockType, name, enabled, subBlocks, currentWorkflowState } = params

    if (!workflowId) {
      throw new Error('workflowId is required')
    }
    if (!blockId?.trim()) {
      throw new Error('blockId is required')
    }

    const nextName = normalizeOptionalString(name)
    const nextBlockType = normalizeOptionalString(blockType)
    const nextSubBlocks = Object.fromEntries(
      Object.entries(subBlocks ?? {}).filter(([subBlockId]) => subBlockId.trim().length > 0)
    )

    if (!nextName && enabled === undefined && Object.keys(nextSubBlocks).length === 0) {
      throwInvalidBlockEdit({
        error:
          'Workflow block edit did not include any supported updates. Provide `name`, `enabled`, or `subBlocks`.',
        hint:
          'Use `edit_workflow_block` only for existing block config changes. Keep graph edits in `edit_workflow`.',
        issues: [
          {
            path: '$',
            message: 'Expected at least one of `name`, `enabled`, or `subBlocks`.',
          },
        ],
      })
    }

    logger.info('Executing edit_workflow_block', {
      workflowId,
      blockId,
      blockType: nextBlockType,
      hasName: !!nextName,
      hasEnabled: enabled !== undefined,
      subBlockCount: Object.keys(nextSubBlocks).length,
      hasCurrentWorkflowState: !!currentWorkflowState,
    })

    const baseWorkflowState = await loadBaseWorkflowState(workflowId, currentWorkflowState)
    const currentBlock = baseWorkflowState.blocks[blockId]

    if (!currentBlock) {
      throwInvalidBlockEdit({
        error: `Workflow block "${blockId}" was not found in the current workflow state.`,
        hint: 'Read the current workflow first and use the exact existing block instance id.',
        issues: [{ path: 'blockId', message: 'Unknown workflow block id.' }],
      })
    }

    if (nextBlockType && currentBlock.type !== nextBlockType) {
      throwInvalidBlockEdit({
        error: `Workflow block "${blockId}" has type "${currentBlock.type}", not "${nextBlockType}".`,
        hint: 'Use the exact existing `block.type` for this block or omit `blockType`.',
        issues: [{ path: 'blockType', message: `Expected "${currentBlock.type}".` }],
      })
    }

    const blockConfig = getBlock(currentBlock.type)
    if (!blockConfig) {
      throw new Error(`Unknown block type: ${currentBlock.type}`)
    }

    const rootSubBlockConfigs = new Map(
      blockConfig.subBlocks.map((subBlock) => [subBlock.id, subBlock])
    )
    const allowedSubBlockIds = getAllowedSubBlockIds(blockConfig.subBlocks)
    const invalidSubBlockIds = Object.keys(nextSubBlocks).filter(
      (subBlockId) => !allowedSubBlockIds.has(subBlockId)
    )

    if (invalidSubBlockIds.length > 0) {
      throwInvalidBlockEdit({
        error: `Workflow block edit used non-canonical sub-block ids: ${invalidSubBlockIds.join(', ')}.`,
        hint:
          'Use `get_blocks_metadata` for the block type and send only canonical sub-block ids in `subBlocks`.',
        issues: invalidSubBlockIds.map((subBlockId) => ({
          path: `subBlocks.${subBlockId}`,
          message: `Unknown sub-block id for block type "${currentBlock.type}". Allowed ids: ${[...allowedSubBlockIds]
            .sort()
            .join(', ')}.`,
        })),
      })
    }

    const patchedSubBlocks = { ...currentBlock.subBlocks }
    for (const [subBlockId, value] of Object.entries(nextSubBlocks)) {
      const currentSubBlock = patchedSubBlocks[subBlockId]
      if (currentSubBlock) {
        patchedSubBlocks[subBlockId] = { ...currentSubBlock, value: value as any }
        continue
      }

      const rootSubBlockConfig = rootSubBlockConfigs.get(subBlockId)
      if (rootSubBlockConfig) {
        patchedSubBlocks[subBlockId] = {
          id: subBlockId,
          type: rootSubBlockConfig.type,
          value: value as any,
        }
        continue
      }

      throwInvalidBlockEdit({
        error: `Workflow block sub-block "${subBlockId}" cannot be created from this patch shape.`,
        hint:
          'Patch the canonical parent sub-block id returned by `get_blocks_metadata`, or read the current block and update an existing derived entry.',
        issues: [
          {
            path: `subBlocks.${subBlockId}`,
            message: 'Derived runtime sub-block entries must already exist before they can be patched.',
          },
        ],
      })
    }

    const nextWorkflowState = createWorkflowSnapshot({
      ...baseWorkflowState,
      blocks: {
        ...baseWorkflowState.blocks,
        [blockId]: {
          ...currentBlock,
          ...(nextName ? { name: nextName } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
          subBlocks: patchedSubBlocks,
        },
      },
    })

    try {
      return buildWorkflowMutationResult({
        workflowId,
        baseWorkflowState,
        nextWorkflowState,
        requestedDirection: baseWorkflowState.direction,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.startsWith('Invalid edited workflow:')) {
        throw error
      }

      const details = message.replace(/^Invalid edited workflow:\s*/, '').trim()
      const issues = details
        .split(/;\s+/)
        .filter(Boolean)
        .map((detail) => {
          const trimmedDetail = detail.trim()
          const subBlockMatch = trimmedDetail.match(
            /^Document contract is inconsistent: invalid block sub-block values for ([^ ]+) \((.+)\)$/
          )

          if (!subBlockMatch) {
            return {
              path: '$',
              message: trimmedDetail,
            }
          }

          return {
            path: `subBlocks.${subBlockMatch[1].replace(/^subBlocks\./, '')}`,
            message: subBlockMatch[2],
          }
        })

      throwInvalidBlockEdit({
        error: message,
        hint:
          'Patch only canonical sub-block ids for the existing block, and use the exact value format required by that block metadata.',
        issues,
      })
    }
  },
}
