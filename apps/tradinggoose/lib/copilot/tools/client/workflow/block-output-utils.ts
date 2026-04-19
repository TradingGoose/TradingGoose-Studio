import { getBlockOutputPaths } from '@/lib/workflows/block-outputs'
import { getBlock } from '@/blocks'
import { normalizeBlockName } from '@/stores/workflows/utils'
import type { Variable } from '@/stores/variables/types'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'
import { getRegisteredWorkflowSession } from '@/lib/yjs/workflow-session-registry'
import { getWorkflowSnapshot } from '@/lib/yjs/workflow-session'

export interface WorkflowContext {
  workflowId: string
  blocks: Record<string, BlockState>
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  subBlockValues: Record<string, Record<string, any>>
}

export interface VariableOutput {
  id: string
  name: string
  type: string
  tag: string
}

/**
 * Extract sub-block values from a plain blocks record (no Yjs session needed).
 * Returns a map of blockId -> { subBlockId -> value }.
 *
 * This is the pure-data counterpart of `getWorkflowSubBlockValues` which reads
 * from a live Yjs session. Use this variant when you already have the blocks
 * snapshot in memory (e.g. during YAML export or server-side processing).
 */
export function extractSubBlockValuesFromBlocks(
  blocks: Record<string, any>
): Record<string, Record<string, any>> {
  const result: Record<string, Record<string, any>> = {}
  for (const [blockId, block] of Object.entries(blocks)) {
    if (block?.subBlocks) {
      const blockValues: Record<string, any> = {}
      for (const [subId, sub] of Object.entries(block.subBlocks as Record<string, any>)) {
        if (sub && typeof sub === 'object' && 'value' in sub) {
          blockValues[subId] = sub.value
        }
      }
      result[blockId] = blockValues
    }
  }
  return result
}

/**
 * Get subblock values from the Yjs session registry.
 * In the Yjs world, subblock values are embedded in the blocks themselves,
 * so we extract them from the workflow snapshot.
 *
 * Accepts an optional pre-fetched `snapshot` parameter. When provided, the
 * function skips the Yjs document snapshot entirely, avoiding redundant
 * full-document reads when the caller already has the snapshot in hand
 * (e.g. from a prior `getWorkflowSnapshot` call in the same tool execution).
 */
export function getWorkflowSubBlockValues(
  workflowId: string,
  snapshot?: { blocks: Record<string, any> }
): Record<string, Record<string, any>> {
  if (snapshot) {
    return extractSubBlockValuesFromBlocks(snapshot.blocks)
  }

  const session = getRegisteredWorkflowSession(workflowId)
  if (!session?.doc) return {}
  const liveSnapshot = getWorkflowSnapshot(session.doc)
  return extractSubBlockValuesFromBlocks(liveSnapshot.blocks)
}

export function getMergedSubBlocks(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, any>>,
  targetBlockId: string
): Record<string, any> {
  const base = blocks[targetBlockId]?.subBlocks || {}
  const live = subBlockValues?.[targetBlockId] || {}
  const merged: Record<string, any> = { ...base }
  for (const [subId, liveVal] of Object.entries(live)) {
    merged[subId] = { ...(base[subId] || {}), value: liveVal }
  }
  return merged
}

export function getSubBlockValue(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, any>>,
  targetBlockId: string,
  subBlockId: string
): any {
  const live = subBlockValues?.[targetBlockId]?.[subBlockId]
  if (live !== undefined) return live
  return blocks[targetBlockId]?.subBlocks?.[subBlockId]?.value
}

export function getWorkflowVariableOutputs(
  variablesRecord: Record<string, any> | null | undefined
): VariableOutput[] {
  const varsSnapshot = variablesRecord
  if (!varsSnapshot) return []
  const workflowVariables = Object.values(varsSnapshot) as Variable[]
  const validVariables = workflowVariables.filter(
    (variable: Variable) => variable.name && variable.name.trim() !== ''
  )
  return validVariables.map((variable: Variable) => ({
    id: variable.id,
    name: variable.name,
    type: variable.type,
    tag: `variable.${normalizeBlockName(variable.name)}`,
  }))
}

export function getSubflowInsidePaths(
  blockType: 'loop' | 'parallel',
  blockId: string,
  loops: Record<string, Loop>,
  parallels: Record<string, Parallel>
): string[] {
  const paths = ['index']
  if (blockType === 'loop') {
    const loopType = loops[blockId]?.loopType || 'for'
    if (loopType === 'forEach') {
      paths.push('currentItem', 'items')
    }
  } else {
    const parallelType = parallels[blockId]?.parallelType || 'count'
    if (parallelType === 'collection') {
      paths.push('currentItem', 'items')
    }
  }
  return paths
}

export function computeBlockOutputPaths(block: BlockState, ctx: WorkflowContext): string[] {
  const { blocks, loops, parallels, subBlockValues } = ctx
  const blockConfig = getBlock(block.type)
  const mergedSubBlocks = getMergedSubBlocks(blocks, subBlockValues, block.id)

  if (block.type === 'loop' || block.type === 'parallel') {
    const insidePaths = getSubflowInsidePaths(block.type, block.id, loops, parallels)
    return ['results', ...insidePaths]
  }

  if (block.type === 'evaluator') {
    const metricsValue = getSubBlockValue(blocks, subBlockValues, block.id, 'metrics')
    if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
      const validMetrics = metricsValue.filter((metric: { name?: string }) => metric?.name)
      return validMetrics.map((metric: { name: string }) => metric.name.toLowerCase())
    }
    return getBlockOutputPaths(block.type, mergedSubBlocks)
  }

  if (block.type === 'variables') {
    const variablesValue = getSubBlockValue(blocks, subBlockValues, block.id, 'variables')
    if (variablesValue && Array.isArray(variablesValue) && variablesValue.length > 0) {
      const validAssignments = variablesValue.filter((assignment: { variableName?: string }) =>
        assignment?.variableName?.trim()
      )
      return validAssignments.map((assignment: { variableName: string }) =>
        assignment.variableName.trim()
      )
    }
    return []
  }

  return getBlockOutputPaths(block.type, mergedSubBlocks, block.triggerMode)
}

export function formatOutputsWithPrefix(paths: string[], blockName: string): string[] {
  const normalizedName = normalizeBlockName(blockName)
  return paths.map((path) => `${normalizedName}.${path}`)
}
