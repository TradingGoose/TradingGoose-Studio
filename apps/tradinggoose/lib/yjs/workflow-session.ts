/**
 * Workflow Session Document Contract
 *
 * Defines the top-level Yjs collections for a collaborative workflow session
 * and provides helpers to read/write the live workflow state.
 *
 * Top-level collections:
 *   - "workflow"  (Y.Map) — editable blocks, edges, and save timestamp
 *   - "subBlockFields" (Y.Map) — scalar or collaborative text values keyed by blockId/subBlockId
 *   - "variables" (Y.Map) — per-workflow variable records keyed by variable id
 *   - "metadata"  (Y.Map) — session-level workflow metadata
 */

import type { Edge } from '@xyflow/react'
import * as Y from 'yjs'
import { resolveStoredDateValue } from '@/lib/time-format'
import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { evaluateSubBlockCondition } from '@/lib/workflows/sub-block-conditions'
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

const WORKFLOW_SUB_BLOCK_FIELD_SEPARATOR = '::'

// ---------------------------------------------------------------------------
// Top-level map accessors
// ---------------------------------------------------------------------------

export function readWorkflowMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.WORKFLOW)
}

export function getVariablesMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.VARIABLES)
}

export function readWorkflowSubBlockFieldsMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.SUB_BLOCK_FIELDS)
}

export function getMetadataMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.METADATA)
}

export function createWorkflowSubBlockFieldKey(blockId: string, subBlockId: string): string {
  return `${blockId}${WORKFLOW_SUB_BLOCK_FIELD_SEPARATOR}${subBlockId}`
}

export function parseWorkflowSubBlockFieldKey(
  key: string
): { blockId: string; subBlockId: string } | null {
  const separatorIndex = key.indexOf(WORKFLOW_SUB_BLOCK_FIELD_SEPARATOR)
  if (
    separatorIndex <= 0 ||
    separatorIndex >= key.length - WORKFLOW_SUB_BLOCK_FIELD_SEPARATOR.length
  ) {
    return null
  }

  return {
    blockId: key.slice(0, separatorIndex),
    subBlockId: key.slice(separatorIndex + WORKFLOW_SUB_BLOCK_FIELD_SEPARATOR.length),
  }
}

function isWorkflowTextField(
  doc: Y.Doc,
  blockId: string,
  subBlockId: string,
  readFieldValue = (field: string) => readWorkflowSubBlockFieldValue(doc, blockId, field)
): boolean | undefined {
  const block = readWorkflowMap(doc).get(YJS_KEYS.BLOCKS)?.[blockId] as BlockState | undefined
  const config = block && getBlock(block.type)
  const variants = config?.subBlocks.filter(({ id }) => id === subBlockId)
  if (!config || !variants?.length) return undefined
  const textVariants = variants.filter(
    (variant) =>
      (variant.type === 'short-input' && variant.inputType !== 'number') ||
      variant.type === 'long-input' ||
      variant.type === 'code'
  )
  if (textVariants.length === 0) return false
  if (textVariants.length === variants.length) return true

  const isPureTrigger = config.category === 'triggers'
  const isTriggerMode = block?.triggerMode === true || isPureTrigger
  const modeVariants = variants.filter((variant) =>
    isTriggerMode
      ? variant.mode === 'trigger' || (isPureTrigger && !variant.mode)
      : variant.mode !== 'trigger'
  )
  if (modeVariants.length > 0 && modeVariants.every((variant) => textVariants.includes(variant))) {
    return true
  }
  const field = modeVariants.find((variant) =>
    evaluateSubBlockCondition(variant.condition, readFieldValue)
  )
  return !!field && textVariants.includes(field)
}

export function readWorkflowTextFieldFromMap(
  subBlockFields: Y.Map<any>,
  blockId: string,
  subBlockId: string
): Y.Text | null {
  const existing = subBlockFields.get(createWorkflowSubBlockFieldKey(blockId, subBlockId))
  return existing instanceof Y.Text ? existing : null
}

export function readWorkflowSubBlockFieldValueFromMap(
  subBlockFields: Y.Map<any>,
  blockId: string,
  subBlockId: string
): any {
  const value = subBlockFields.get(createWorkflowSubBlockFieldKey(blockId, subBlockId))
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
  return readWorkflowTextFieldFromMap(readWorkflowSubBlockFieldsMap(doc), blockId, subBlockId)
}

function writeYTextValue(text: Y.Text, value: string): void {
  if (text.toString() === value) {
    return
  }

  if (text.length > 0) {
    text.delete(0, text.length)
  }
  if (value) {
    text.insert(0, value)
  }
}

export function ensureWorkflowTextField(
  doc: Y.Doc,
  blockId: string,
  subBlockId: string,
  initialValue = ''
): Y.Text | null {
  const subBlockFields = readWorkflowSubBlockFieldsMap(doc)
  if (isWorkflowTextField(doc, blockId, subBlockId) === false) return null
  const existing = readWorkflowTextFieldFromMap(subBlockFields, blockId, subBlockId)
  if (existing) {
    return existing
  }

  const next = new Y.Text()
  if (initialValue) {
    next.insert(0, initialValue)
  }

  doc.transact(() => {
    subBlockFields.set(createWorkflowSubBlockFieldKey(blockId, subBlockId), next)
  }, YJS_ORIGINS.SYSTEM)

  return next
}

export function setWorkflowSubBlockValues(
  doc: Y.Doc,
  updates: Array<{ blockId: string; subBlockId: string; value: any }>
): void {
  const blocks = readWorkflowMap(doc).get(YJS_KEYS.BLOCKS)
  const fields = readWorkflowSubBlockFieldsMap(doc)
  const pendingValues = new Map(
    updates.map(
      ({ blockId, subBlockId, value }) =>
        [createWorkflowSubBlockFieldKey(blockId, subBlockId), value] as const
    )
  )
  for (const { blockId, subBlockId, value } of updates) {
    if (!blocks?.[blockId]) continue
    const key = createWorkflowSubBlockFieldKey(blockId, subBlockId)
    const existing = fields.get(key)
    const textField = isWorkflowTextField(doc, blockId, subBlockId, (field) => {
      const fieldKey = createWorkflowSubBlockFieldKey(blockId, field)
      return pendingValues.has(fieldKey)
        ? pendingValues.get(fieldKey)
        : readWorkflowSubBlockFieldValueFromMap(fields, blockId, field)
    })
    if (
      typeof value === 'string' &&
      (textField === true || (textField === undefined && existing instanceof Y.Text))
    ) {
      if (existing instanceof Y.Text) {
        writeYTextValue(existing, value)
      } else {
        const text = new Y.Text()
        if (value) text.insert(0, value)
        fields.set(key, text)
      }
    } else if (
      !fields.has(key) ||
      existing instanceof Y.Text ||
      (!Object.is(existing, value) && JSON.stringify(existing) !== JSON.stringify(value))
    ) {
      fields.set(key, value)
    }
  }
}

export function materializeWorkflowBlockFields(
  blockId: string,
  block: BlockState | null,
  subBlockFields: Y.Map<any>
): BlockState | null {
  if (!block) {
    return block
  }

  let nextBlock = block

  for (const [key, field] of subBlockFields) {
    const parsed = parseWorkflowSubBlockFieldKey(key)
    if (!parsed || parsed.blockId !== blockId) continue
    const { subBlockId } = parsed
    const nextValue = field instanceof Y.Text ? field.toString() : field
    if (block.subBlocks?.[subBlockId]?.value === nextValue) {
      continue
    }

    if (nextBlock === block) {
      nextBlock = {
        ...block,
        subBlocks: {
          ...block.subBlocks,
        },
      }
    }

    nextBlock.subBlocks[subBlockId] = {
      ...nextBlock.subBlocks[subBlockId],
      id: subBlockId,
      value: nextValue,
    }
  }

  return nextBlock === block
    ? nextBlock
    : {
        ...nextBlock,
        outputs: resolveOutputType(
          readBlockOutputs(block.type, nextBlock.subBlocks, block.triggerMode === true)
        ),
      }
}

export function materializeWorkflowFields(
  blocks: Record<string, BlockState>,
  subBlockFields: Y.Map<any>
): Record<string, BlockState> {
  let nextBlocks = blocks

  for (const [blockId, block] of Object.entries(blocks)) {
    const materializedBlock = materializeWorkflowBlockFields(blockId, block, subBlockFields)
    if (!materializedBlock || materializedBlock === block) {
      continue
    }

    if (nextBlocks === blocks) {
      nextBlocks = { ...blocks }
    }
    nextBlocks[blockId] = materializedBlock
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

    for (const key of Array.from(subBlockFields.keys())) {
      const parsed = parseWorkflowSubBlockFieldKey(key)
      if (!parsed) {
        subBlockFields.delete(key)
        continue
      }

      if (!state.blocks?.[parsed.blockId]?.subBlocks?.[parsed.subBlockId]) {
        subBlockFields.delete(key)
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
