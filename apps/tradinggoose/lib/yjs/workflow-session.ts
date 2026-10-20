/**
 * Workflow Session Document Contract
 *
 * Defines the top-level Yjs collections for a collaborative workflow session
 * and provides helpers to read/write the live workflow state.
 *
 * Top-level collections:
 *   - "workflow"  (Y.Map) — editable blocks, edges, and save timestamp
 *   - "subBlockFields" (Y.Map) — per-block Y.Maps of scalar or collaborative text field values
 *   - "variables" (Y.Map) — per-workflow variable records keyed by variable id
 *   - "metadata"  (Y.Map) — session-level workflow metadata
 */

import type { Edge } from '@xyflow/react'
import * as Y from 'yjs'
import { resolveStoredDateValue } from '@/lib/time-format'
import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { getBlock } from '@/blocks/registry'
import { resolveOutputType } from '@/blocks/utils'
import type {
  BlockState,
  Loop,
  Parallel,
  WorkflowDirection,
} from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

// ---------------------------------------------------------------------------
// Yjs map key constants (avoids stringly-typed keys across the codebase)
// ---------------------------------------------------------------------------

export const YJS_KEYS = {
  WORKFLOW: 'workflow',
  SUB_BLOCK_FIELDS: 'subBlockFields',
  VARIABLES: 'variables',
  METADATA: 'metadata',
  BLOCKS: 'blocks',
  EDGES: 'edges',
  DIRECTION: 'direction',
  LAST_SAVED: 'lastSaved',
} as const

// ---------------------------------------------------------------------------
// Top-level map accessors
// ---------------------------------------------------------------------------

export function readWorkflowMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.WORKFLOW)
}

export function getVariablesMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.VARIABLES)
}

export function readWorkflowSubBlockFieldsMap(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap<Y.Map<any>>(YJS_KEYS.SUB_BLOCK_FIELDS)
}

export function ensureWorkflowBlockFieldsMap(doc: Y.Doc, blockId: string): Y.Map<any> {
  const fields = readWorkflowSubBlockFieldsMap(doc)
  const existing = fields.get(blockId)
  if (existing) return existing
  const blockFields = new Y.Map<any>()
  fields.set(blockId, blockFields)
  return blockFields
}

export function getMetadataMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.METADATA)
}

function isWorkflowTextField(blockType: string, subBlockId: string): boolean | undefined {
  const variants = getBlock(blockType)?.subBlocks.filter(({ id }) => id === subBlockId)
  // An atomic widget variant makes the whole field atomic across widget changes.
  return variants?.length
    ? variants.every(
        (variant) =>
          (variant.type === 'short-input' && variant.inputType !== 'number') ||
          variant.type === 'long-input' ||
          variant.type === 'code'
      )
    : undefined
}

export function readWorkflowSubBlockFieldValueFromMap(
  subBlockFields: Y.Map<Y.Map<any>>,
  blockId: string,
  subBlockId: string
): any {
  const value = subBlockFields.get(blockId)?.get(subBlockId)
  return value instanceof Y.Text ? value.toString() : value
}

export function readWorkflowSubBlockFieldValue(
  doc: Y.Doc,
  blockId: string,
  subBlockId: string
): any {
  return readWorkflowSubBlockFieldValueFromMap(
    readWorkflowSubBlockFieldsMap(doc),
    blockId,
    subBlockId
  )
}

export function readWorkflowTextField(
  doc: Y.Doc,
  blockId: string,
  subBlockId: string
): Y.Text | null {
  const value = readWorkflowSubBlockFieldsMap(doc).get(blockId)?.get(subBlockId)
  return value instanceof Y.Text ? value : null
}

export function setWorkflowSubBlockValues(
  doc: Y.Doc,
  updates: Array<{ blockId: string; subBlockId: string; value: any; collaborative?: boolean }>
): void {
  const blocks = readWorkflowMap(doc).get(YJS_KEYS.BLOCKS)
  for (const { blockId, subBlockId, value, collaborative } of updates) {
    const block = blocks?.[blockId]
    if (!block) continue
    const fields = ensureWorkflowBlockFieldsMap(doc, blockId)
    const existing = fields.get(subBlockId)
    const textField =
      isWorkflowTextField(block.type, subBlockId) ?? collaborative ?? existing instanceof Y.Text
    if (typeof value === 'string' && textField) {
      if (existing instanceof Y.Text) {
        if (existing.toString() === value) continue
        existing.delete(0, existing.length)
        existing.insert(0, value)
      } else {
        fields.set(subBlockId, new Y.Text(value))
      }
    } else if (
      !fields.has(subBlockId) ||
      existing instanceof Y.Text ||
      (!Object.is(existing, value) && JSON.stringify(existing) !== JSON.stringify(value))
    ) {
      fields.set(subBlockId, value)
    }
  }
}

export function materializeWorkflowBlockFields(
  blockId: string,
  block: BlockState | null,
  subBlockFields: Y.Map<Y.Map<any>>
): BlockState | null {
  const fields = subBlockFields.get(blockId)
  if (!block || !fields) return block
  let nextBlock = block
  for (const [subBlockId, field] of fields) {
    const value = field instanceof Y.Text ? field.toString() : field
    if (block.subBlocks?.[subBlockId]?.value === value) continue
    if (nextBlock === block) nextBlock = { ...block, subBlocks: { ...block.subBlocks } }
    nextBlock.subBlocks[subBlockId] = { ...block.subBlocks?.[subBlockId], id: subBlockId, value }
  }
  if (nextBlock !== block) {
    nextBlock.outputs = resolveOutputType(
      readBlockOutputs(block.type, nextBlock.subBlocks, block.triggerMode === true)
    )
  }
  return nextBlock
}

export function materializeWorkflowFields(
  blocks: Record<string, BlockState>,
  subBlockFields: Y.Map<Y.Map<any>>
): Record<string, BlockState> {
  let nextBlocks = blocks
  for (const [blockId, block] of Object.entries(blocks)) {
    const materialized = materializeWorkflowBlockFields(blockId, block, subBlockFields)!
    if (materialized === block) continue
    if (nextBlocks === blocks) nextBlocks = { ...blocks }
    nextBlocks[blockId] = materialized
  }
  return nextBlocks
}

// ---------------------------------------------------------------------------
// Workflow snapshot types
// ---------------------------------------------------------------------------

export interface WorkflowSnapshot {
  direction?: WorkflowDirection
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastSaved?: string | number
}

/**
 * Applies safe defaults to a partial snapshot.  Used by both
 * `createWorkflowSnapshot` and `readWorkflowSnapshot` so the defaulting
 * logic is defined in exactly one place.
 */
function applySnapshotDefaults(partial: Partial<WorkflowSnapshot>): WorkflowSnapshot {
  return {
    ...(partial.direction !== undefined ? { direction: partial.direction } : {}),
    blocks: partial.blocks ?? {},
    edges: partial.edges ?? [],
    loops: partial.loops ?? {},
    parallels: partial.parallels ?? {},
    lastSaved: partial.lastSaved,
  }
}

/**
 * Creates a WorkflowSnapshot with safe defaults for all fields.
 * Use this instead of manually spreading `?? {}` / `?? []` at every call site.
 */
export function createWorkflowSnapshot(partial: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return applySnapshotDefaults(partial)
}

// ---------------------------------------------------------------------------
// Workflow read/write helpers
// ---------------------------------------------------------------------------

/**
 * Returns a snapshot with loop and parallel settings derived from materialized
 * block values, so concurrent Yjs updates cannot leave execution settings stale.
 *
 * The returned data references the underlying Y.Map values directly.
 * **Callers must treat the result as read-only.** If you need to mutate
 * any field, use `readWorkflowSnapshotCloned` instead.
 */
export function readWorkflowSnapshot(doc: Y.Doc): WorkflowSnapshot {
  const wMap = readWorkflowMap(doc)
  const subBlockFields = readWorkflowSubBlockFieldsMap(doc)
  const blocks = materializeWorkflowFields(wMap.get(YJS_KEYS.BLOCKS) ?? {}, subBlockFields)

  return applySnapshotDefaults({
    direction: wMap.get(YJS_KEYS.DIRECTION),
    blocks,
    edges: wMap.get(YJS_KEYS.EDGES) ?? [],
    loops: generateLoopBlocks(blocks),
    parallels: generateParallelBlocks(blocks),
    lastSaved: wMap.get(YJS_KEYS.LAST_SAVED),
  })
}

/**
 * Like `readWorkflowSnapshot`, but deep-clones the mutable collections so the
 * caller can safely mutate the returned data.
 */
export function readWorkflowSnapshotCloned(doc: Y.Doc): WorkflowSnapshot {
  return structuredClone(readWorkflowSnapshot(doc))
}

/**
 * Applies a full workflow state to the Yjs document inside a single
 * transaction. Optional lastSaved is only written when present so callers can
 * do partial updates by omitting it.
 *
 * @param origin - Yjs transaction origin tag (defaults to `'system'`)
 */
export function setWorkflowState(doc: Y.Doc, state: WorkflowSnapshot, origin?: string): void {
  doc.transact(() => {
    const wMap = readWorkflowMap(doc)
    const subBlockFields = readWorkflowSubBlockFieldsMap(doc)
    if (state.direction !== undefined) wMap.set(YJS_KEYS.DIRECTION, state.direction)
    wMap.set(YJS_KEYS.BLOCKS, state.blocks)
    wMap.set(YJS_KEYS.EDGES, state.edges)
    if (state.lastSaved !== undefined) wMap.set(YJS_KEYS.LAST_SAVED, state.lastSaved)

    for (const blockId of Array.from(subBlockFields.keys())) {
      if (!state.blocks[blockId]) subBlockFields.delete(blockId)
    }
    for (const [blockId, block] of Object.entries(state.blocks)) {
      const fields = ensureWorkflowBlockFieldsMap(doc, blockId)
      for (const subBlockId of Array.from(fields.keys())) {
        if (!block.subBlocks[subBlockId]) fields.delete(subBlockId)
      }
    }
    setWorkflowSubBlockValues(
      doc,
      Object.entries(state.blocks).flatMap(([blockId, block]) =>
        Object.entries(block.subBlocks).map(([subBlockId, subBlock]) => ({
          blockId,
          subBlockId,
          value: subBlock.value,
        }))
      )
    )
  }, origin ?? YJS_ORIGINS.SYSTEM)
}

export function replaceWorkflowDocumentState(
  doc: Y.Doc,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>
): void {
  setWorkflowState(doc, workflowState, YJS_ORIGINS.SYSTEM)

  if (variables !== undefined) {
    setVariables(doc, variables, YJS_ORIGINS.SYSTEM)
  }
}

// ---------------------------------------------------------------------------
// Variable read/write helpers
// ---------------------------------------------------------------------------

/**
 * Returns a plain-object copy of all variables currently stored in the Yjs
 * document, keyed by variable id.
 */
export function getVariablesSnapshot(doc: Y.Doc): Record<string, any> {
  const vMap = getVariablesMap(doc)
  const result: Record<string, any> = {}
  vMap.forEach((value, key) => {
    result[key] = value
  })
  return result
}

/**
 * Replaces the entire variables map in the Yjs document.  The map is cleared
 * first so that deleted variables are removed.
 *
 * @param origin - Yjs transaction origin tag (defaults to `'system'`)
 */
export function setVariables(doc: Y.Doc, variables: Record<string, any>, origin?: string): void {
  doc.transact(() => {
    const vMap = getVariablesMap(doc)
    vMap.clear()
    for (const [key, value] of Object.entries(variables)) {
      vMap.set(key, value)
    }
  }, origin ?? YJS_ORIGINS.SYSTEM)
}

// ---------------------------------------------------------------------------
// Combined doc -> persisted state helper
// ---------------------------------------------------------------------------

/**
 * Reads the full persisted workflow state (blocks, edges, loops, parallels,
 * variables) from a Y.Doc in one call.  This is the canonical extraction used
 * by the server-side Yjs loader.
 */
export interface PersistedDocState {
  direction?: WorkflowDirection
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  variables: Record<string, any>
  lastSaved: number
}

export function extractPersistedStateFromDoc(doc: Y.Doc): PersistedDocState {
  const snapshot = readWorkflowSnapshot(doc)
  const variables = getVariablesSnapshot(doc)
  const lastSaved = resolveStoredDateValue(snapshot.lastSaved)?.getTime() ?? Date.now()

  return {
    ...snapshot,
    variables,
    lastSaved,
  }
}
