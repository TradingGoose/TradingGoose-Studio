/**
 * Workflow Session Document Contract
 *
 * Defines the top-level Yjs collections for a collaborative workflow session
 * and provides helpers to read/write the live workflow state.
 *
 * Top-level collections:
 *   - "workflow"  (Y.Map) — blocks, edges, loops, parallels, deployment metadata
 *   - "textFields" (Y.Map) — text-heavy subblock values keyed by blockId/subBlockId
 *   - "variables" (Y.Map) — per-workflow variable records keyed by variable id
 *   - "metadata"  (Y.Map) — session-level workflow metadata (e.g. reseed markers)
 */

import type { Edge } from 'reactflow'
import * as Y from 'yjs'
import { resolveStoredDateValue } from '@/lib/time-format'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import type {
  BlockState,
  Loop,
  Parallel,
  WorkflowDirection,
} from '@/stores/workflows/workflow/types'

// ---------------------------------------------------------------------------
// Yjs map key constants (avoids stringly-typed keys across the codebase)
// ---------------------------------------------------------------------------

export const YJS_KEYS = {
  WORKFLOW: 'workflow',
  TEXT_FIELDS: 'textFields',
  VARIABLES: 'variables',
  METADATA: 'metadata',
  BLOCKS: 'blocks',
  EDGES: 'edges',
  LOOPS: 'loops',
  PARALLELS: 'parallels',
  DIRECTION: 'direction',
  LAST_SAVED: 'lastSaved',
  IS_DEPLOYED: 'isDeployed',
  DEPLOYED_AT: 'deployedAt',
} as const

const WORKFLOW_TEXT_FIELD_SEPARATOR = '::'

// ---------------------------------------------------------------------------
// Top-level map accessors
// ---------------------------------------------------------------------------

export function getWorkflowMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.WORKFLOW)
}

export function getVariablesMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.VARIABLES)
}

export function getWorkflowTextFieldsMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.TEXT_FIELDS)
}

export function getMetadataMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap(YJS_KEYS.METADATA)
}

export function createWorkflowTextFieldKey(blockId: string, subBlockId: string): string {
  return `${blockId}${WORKFLOW_TEXT_FIELD_SEPARATOR}${subBlockId}`
}

export function parseWorkflowTextFieldKey(
  key: string
): { blockId: string; subBlockId: string } | null {
  const separatorIndex = key.indexOf(WORKFLOW_TEXT_FIELD_SEPARATOR)
  if (separatorIndex <= 0 || separatorIndex >= key.length - WORKFLOW_TEXT_FIELD_SEPARATOR.length) {
    return null
  }

  return {
    blockId: key.slice(0, separatorIndex),
    subBlockId: key.slice(separatorIndex + WORKFLOW_TEXT_FIELD_SEPARATOR.length),
  }
}

export function getWorkflowTextFieldFromMap(
  textFields: Y.Map<any>,
  blockId: string,
  subBlockId: string
): Y.Text | null {
  const existing = textFields.get(createWorkflowTextFieldKey(blockId, subBlockId))
  return existing instanceof Y.Text ? existing : null
}

export function getWorkflowTextField(doc: Y.Doc, blockId: string, subBlockId: string): Y.Text | null {
  return getWorkflowTextFieldFromMap(getWorkflowTextFieldsMap(doc), blockId, subBlockId)
}

function writeYTextValue(text: Y.Text, value: string): void {
  const nextValue = value ?? ''
  if (text.toString() === nextValue) {
    return
  }

  if (text.length > 0) {
    text.delete(0, text.length)
  }
  if (nextValue) {
    text.insert(0, nextValue)
  }
}

export function ensureWorkflowTextField(
  doc: Y.Doc,
  blockId: string,
  subBlockId: string,
  initialValue = ''
): Y.Text {
  const textFields = getWorkflowTextFieldsMap(doc)
  const existing = getWorkflowTextFieldFromMap(textFields, blockId, subBlockId)
  if (existing) {
    return existing
  }

  const next = new Y.Text()
  if (initialValue) {
    next.insert(0, initialValue)
  }

  doc.transact(() => {
    textFields.set(createWorkflowTextFieldKey(blockId, subBlockId), next)
  }, YJS_ORIGINS.SYSTEM)

  return next
}

export function replaceWorkflowTextField(
  doc: Y.Doc,
  blockId: string,
  subBlockId: string,
  value: string,
  origin: unknown = YJS_ORIGINS.USER
): void {
  const text = ensureWorkflowTextField(doc, blockId, subBlockId)
  doc.transact(() => {
    writeYTextValue(text, value ?? '')
  }, origin)
}

export function readWorkflowTextFieldValue(
  doc: Y.Doc,
  blockId: string,
  subBlockId: string
): string | null {
  const text = getWorkflowTextField(doc, blockId, subBlockId)
  return text ? text.toString() : null
}

export function materializeWorkflowBlockTextFields(
  blockId: string,
  block: BlockState | null,
  textFields: Y.Map<any>
): BlockState | null {
  if (!block?.subBlocks) {
    return block
  }

  let nextBlock = block

  for (const subBlockId of Object.keys(block.subBlocks)) {
    const sharedText = getWorkflowTextFieldFromMap(textFields, blockId, subBlockId)
    if (!sharedText) {
      continue
    }

    const nextValue = sharedText.toString()
    if (block.subBlocks[subBlockId]?.value === nextValue) {
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
      value: nextValue,
    }
  }

  return nextBlock
}

export function materializeWorkflowTextFields(
  blocks: Record<string, BlockState>,
  textFields: Y.Map<any>
): Record<string, BlockState> {
  let nextBlocks = blocks

  for (const key of textFields.keys()) {
    const parsed = parseWorkflowTextFieldKey(key)
    if (!parsed) {
      continue
    }

    const block = nextBlocks[parsed.blockId]
    if (!block) {
      continue
    }

    const materializedBlock = materializeWorkflowBlockTextFields(parsed.blockId, block, textFields)
    if (!materializedBlock || materializedBlock === block) {
      continue
    }

    if (nextBlocks === blocks) {
      nextBlocks = { ...blocks }
    }
    nextBlocks[parsed.blockId] = materializedBlock
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
  lastSaved?: string
  isDeployed?: boolean
  deployedAt?: string
}

/**
 * Applies safe defaults to a partial snapshot.  Used by both
 * `createWorkflowSnapshot` and `getWorkflowSnapshot` so the defaulting
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
    isDeployed: partial.isDeployed,
    deployedAt: partial.deployedAt,
  }
}

/**
 * Creates a WorkflowSnapshot with safe defaults for all fields.
 * Use this instead of manually spreading `?? {}` / `?? []` at every call site.
 */
export function createWorkflowSnapshot(
  partial: Partial<WorkflowSnapshot> = {}
): WorkflowSnapshot {
  return applySnapshotDefaults(partial)
}

// ---------------------------------------------------------------------------
// Workflow read/write helpers
// ---------------------------------------------------------------------------

/**
 * Returns a plain-object snapshot of the current workflow state stored in the
 * Yjs document.  Missing keys fall back to safe defaults (empty containers).
 *
 * The returned data references the underlying Y.Map values directly.
 * **Callers must treat the result as read-only.** If you need to mutate
 * any field, use `getWorkflowSnapshotCloned` instead.
 */
export function getWorkflowSnapshot(doc: Y.Doc): WorkflowSnapshot {
  const wMap = getWorkflowMap(doc)
  const textFields = getWorkflowTextFieldsMap(doc)
  const blocks = materializeWorkflowTextFields(wMap.get(YJS_KEYS.BLOCKS) ?? {}, textFields)

  return applySnapshotDefaults({
    direction: wMap.get(YJS_KEYS.DIRECTION),
    blocks,
    edges: wMap.get(YJS_KEYS.EDGES) ?? [],
    loops: wMap.get(YJS_KEYS.LOOPS) ?? {},
    parallels: wMap.get(YJS_KEYS.PARALLELS) ?? {},
    lastSaved: wMap.get(YJS_KEYS.LAST_SAVED),
    isDeployed: wMap.get(YJS_KEYS.IS_DEPLOYED),
    deployedAt: wMap.get(YJS_KEYS.DEPLOYED_AT),
  })
}

/**
 * Like `getWorkflowSnapshot`, but deep-clones the mutable collections so the
 * caller can safely mutate the returned data.
 */
export function getWorkflowSnapshotCloned(doc: Y.Doc): WorkflowSnapshot {
  const wMap = getWorkflowMap(doc)
  const textFields = getWorkflowTextFieldsMap(doc)

  const { blocks, edges, loops, parallels } = structuredClone({
    blocks: wMap.get(YJS_KEYS.BLOCKS) ?? {},
    edges: wMap.get(YJS_KEYS.EDGES) ?? [],
    loops: wMap.get(YJS_KEYS.LOOPS) ?? {},
    parallels: wMap.get(YJS_KEYS.PARALLELS) ?? {},
  })

  return applySnapshotDefaults({
    direction: wMap.get(YJS_KEYS.DIRECTION),
    blocks: materializeWorkflowTextFields(blocks, textFields),
    edges,
    loops,
    parallels,
    lastSaved: wMap.get(YJS_KEYS.LAST_SAVED),
    isDeployed: wMap.get(YJS_KEYS.IS_DEPLOYED),
    deployedAt: wMap.get(YJS_KEYS.DEPLOYED_AT),
  })
}

/**
 * Applies a full workflow state to the Yjs document inside a single
 * transaction.  Optional fields (lastSaved, isDeployed, deployedAt) are only
 * written when present in the incoming state so callers can do partial
 * updates by omitting them.
 *
 * @param origin - Yjs transaction origin tag (defaults to `'system'`)
 */
export function setWorkflowState(doc: Y.Doc, state: WorkflowSnapshot, origin?: string): void {
  doc.transact(() => {
    const wMap = getWorkflowMap(doc)
    const textFields = getWorkflowTextFieldsMap(doc)
    if (state.direction !== undefined) wMap.set(YJS_KEYS.DIRECTION, state.direction)
    wMap.set(YJS_KEYS.BLOCKS, state.blocks ?? {})
    wMap.set(YJS_KEYS.EDGES, state.edges ?? [])
    wMap.set(YJS_KEYS.LOOPS, state.loops ?? {})
    wMap.set(YJS_KEYS.PARALLELS, state.parallels ?? {})
    if (state.lastSaved !== undefined) wMap.set(YJS_KEYS.LAST_SAVED, state.lastSaved)
    if (state.isDeployed !== undefined) wMap.set(YJS_KEYS.IS_DEPLOYED, state.isDeployed)
    if (state.deployedAt !== undefined) wMap.set(YJS_KEYS.DEPLOYED_AT, state.deployedAt)

    for (const key of Array.from(textFields.keys())) {
      const parsed = parseWorkflowTextFieldKey(key)
      if (!parsed) {
        textFields.delete(key)
        continue
      }

      const nextValue = state.blocks?.[parsed.blockId]?.subBlocks?.[parsed.subBlockId]?.value
      if (typeof nextValue !== 'string') {
        textFields.delete(key)
        continue
      }

      const existing = textFields.get(key)
      if (existing instanceof Y.Text) {
        writeYTextValue(existing, nextValue)
        continue
      }

      const next = new Y.Text()
      writeYTextValue(next, nextValue)
      textFields.set(key, next)
    }
  }, origin ?? YJS_ORIGINS.SYSTEM)
}

// ---------------------------------------------------------------------------
// Block mutation helpers
// ---------------------------------------------------------------------------

/**
 * Applies an updater function to a single block inside a Yjs transaction.
 * This is the canonical way to mutate a block imperatively (outside of React
 * hooks).  If the updater returns the same reference the write is skipped.
 *
 * NOTE: Blocks are stored as a plain object under a single Y.Map key, not as
 * nested Y.Maps. A shallow spread of the blocks object is therefore required
 * so that `wMap.set()` receives a new object reference and Yjs detects the
 * change. The cost is O(N) property assignments (pointer copies, not deep
 * clones), which is acceptable for typical workflow sizes.
 *
 * @param origin - Yjs transaction origin tag (defaults to `'system'`)
 */
export function patchWorkflowBlock(
  doc: Y.Doc,
  blockId: string,
  updater: (block: any) => any,
  origin?: string
): void {
  doc.transact(() => {
    const wMap = getWorkflowMap(doc)
    const existing = wMap.get(YJS_KEYS.BLOCKS) ?? {}
    const block = existing[blockId]
    if (!block) return
    const updated = updater(block)
    if (updated === block) return
    // Spread is required: Yjs needs a new object reference to detect the change.
    // Only the updated block is cloned; all other entries are pointer copies.
    wMap.set(YJS_KEYS.BLOCKS, { ...existing, [blockId]: updated })
  }, origin ?? YJS_ORIGINS.SYSTEM)
}

/**
 * Batch-patches multiple blocks in a single Yjs transaction.
 * Each entry maps a blockId to an updater. The blocks map is replaced once.
 *
 * @param origin - Yjs transaction origin tag (defaults to `'system'`)
 */
export function patchWorkflowBlocks(
  doc: Y.Doc,
  patches: Record<string, (block: any) => any>,
  origin?: string
): void {
  doc.transact(() => {
    const wMap = getWorkflowMap(doc)
    const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
    let changed = false
    for (const [blockId, updater] of Object.entries(patches)) {
      const block = blocks[blockId]
      if (!block) continue
      const updated = updater(block)
      if (updated !== block) {
        blocks[blockId] = updated
        changed = true
      }
    }
    if (changed) {
      wMap.set(YJS_KEYS.BLOCKS, blocks)
    }
  }, origin ?? YJS_ORIGINS.SYSTEM)
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
 * by both the server-side Yjs loader and the template builder.
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
  const snapshot = getWorkflowSnapshot(doc)
  const variables = getVariablesSnapshot(doc)
  const lastSaved = resolveStoredDateValue(snapshot.lastSaved)?.getTime() ?? Date.now()

  return {
    ...(snapshot.direction !== undefined ? { direction: snapshot.direction } : {}),
    blocks: snapshot.blocks || {},
    edges: snapshot.edges || [],
    loops: snapshot.loops || {},
    parallels: snapshot.parallels || {},
    variables: variables || {},
    lastSaved,
  }
}
