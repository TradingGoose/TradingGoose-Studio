'use client'

/**
 * Yjs-native React hooks for workflow state.
 *
 * These replace the Zustand workflow/subblock/variable stores by reading
 * directly from the Yjs document. Components subscribe via useSyncExternalStore
 * and mutations go through doc.transact().
 *
 * This is the SOLE source of truth for workflow editing state.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Edge } from '@xyflow/react'
import type * as Y from 'yjs'
import { escapeRegExp } from '@/lib/utils'
import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { buildInitialSubBlockStates, stringifySubBlockValue } from '@/lib/workflows/subblock-values'
import { YJS_ORIGINS, type YjsOrigin } from '@/lib/yjs/transaction-origins'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import { rewriteWorkflowContentReferences } from '@/lib/yjs/workflow-reference-rewrite'
import {
  ensureWorkflowBlockFieldsMap,
  getVariablesMap,
  materializeWorkflowBlockFields,
  materializeWorkflowFields,
  readWorkflowMap,
  readWorkflowSnapshot,
  readWorkflowSubBlockFieldsMap,
  readWorkflowSubBlockFieldValue,
  readWorkflowTextField,
  setWorkflowState,
  setWorkflowSubBlockValues,
  type WorkflowSnapshot,
  YJS_KEYS,
} from '@/lib/yjs/workflow-session'
import { useOptionalWorkflowSession, useWorkflowSession } from '@/lib/yjs/workflow-session-host'
import {
  addWorkflowVariable,
  deleteWorkflowVariable,
  duplicateWorkflowVariable,
  updateWorkflowVariable,
} from '@/lib/yjs/workflow-variables'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import type { Variable } from '@/stores/variables/types'
import { normalizeBlockName } from '@/stores/workflows/utils'
import type {
  BlockState,
  Loop,
  Parallel,
  Position,
  SubBlockState,
  WorkflowState,
} from '@/stores/workflows/workflow/types'
import {
  findAllDescendantNodes,
  generateLoopBlocks,
  generateParallelBlocks,
  isBlockProtected,
} from '@/stores/workflows/workflow/utils'

// ---------------------------------------------------------------------------
// Generic Yjs map subscriber
// ---------------------------------------------------------------------------

function useYjsMapValue<T>(doc: Y.Doc | null, mapName: string, key: string, fallback: T): T {
  // Perf: use shallow observe instead of observeDeep so that changes to
  // other keys on the same Y.Map (e.g. edges changes) don't wake up
  // subscribers that only care about a single key (e.g. blocks).
  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const ymap = doc.getMap(mapName)
    return (cb: () => void) => {
      const handler = (event: Y.YMapEvent<any>) => {
        // Only bump version when our specific key was modified
        if (!event.keysChanged.has(key)) return
        cb()
      }
      ymap.observe(handler)
      return () => ymap.unobserve(handler)
    }
  }, [doc, mapName, key])

  const extract = useCallback(() => {
    if (!doc) return fallback
    return (doc.getMap(mapName).get(key) ?? fallback) as T
  }, [doc, mapName, key, fallback])

  return useYjsSubscription(subscribe, extract, fallback)
}

// ---------------------------------------------------------------------------
// Workflow graph state hooks (read-only subscriptions)
// ---------------------------------------------------------------------------

const EMPTY_BLOCKS: Record<string, BlockState> = {}
const EMPTY_EDGES: Edge[] = []

function areWorkflowBlocksStructurallyEqual(
  a: Record<string, BlockState>,
  b: Record<string, BlockState>
): boolean {
  if (a === b) return true

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)

  if (aKeys.length !== bKeys.length) {
    return false
  }

  return aKeys.every((key, index) => key === bKeys[index] && Object.is(a[key], b[key]))
}

/** Subscribe to the full blocks record from the Yjs workflow doc */
export function useWorkflowBlocks(): Record<string, BlockState> {
  const session = useOptionalWorkflowSession()
  const doc = session?.doc ?? null

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}

    const workflowMap = readWorkflowMap(doc)
    const subBlockFields = readWorkflowSubBlockFieldsMap(doc)

    return (cb: () => void) => {
      const workflowHandler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(YJS_KEYS.BLOCKS)) return
        cb()
      }

      workflowMap.observe(workflowHandler)
      subBlockFields.observeDeep(cb)

      return () => {
        workflowMap.unobserve(workflowHandler)
        subBlockFields.unobserveDeep(cb)
      }
    }
  }, [doc])

  const extract = useCallback(() => {
    if (!doc) return EMPTY_BLOCKS

    return materializeWorkflowFields(
      readWorkflowMap(doc).get(YJS_KEYS.BLOCKS) ?? EMPTY_BLOCKS,
      readWorkflowSubBlockFieldsMap(doc)
    )
  }, [doc])

  return useYjsSubscription(subscribe, extract, EMPTY_BLOCKS, areWorkflowBlocksStructurallyEqual)
}

/** Subscribe to the edges array from the Yjs workflow doc */
export function useWorkflowEdges(): Edge[] {
  const session = useOptionalWorkflowSession()
  return useYjsMapValue(session?.doc ?? null, YJS_KEYS.WORKFLOW, YJS_KEYS.EDGES, EMPTY_EDGES)
}

/** Subscribe to the loops record from the Yjs workflow doc */
export function useWorkflowLoops(): Record<string, Loop> {
  const blocks = useWorkflowBlocks()
  return useMemo(() => generateLoopBlocks(blocks), [blocks])
}

/** Subscribe to the parallels record from the Yjs workflow doc */
export function useWorkflowParallels(): Record<string, Parallel> {
  const blocks = useWorkflowBlocks()
  return useMemo(() => generateParallelBlocks(blocks), [blocks])
}

/** Subscribe to a single block by id (fine-grained: only re-renders when this block changes) */
export function useBlock(blockId: string): BlockState | null {
  const session = useOptionalWorkflowSession()
  const doc = blockId ? (session?.doc ?? null) : null

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const workflowMap = readWorkflowMap(doc)
    const subBlockFields = readWorkflowSubBlockFieldsMap(doc)

    return (cb: () => void) => {
      let observedBlock = workflowMap.get(YJS_KEYS.BLOCKS)?.[blockId]

      const workflowHandler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(YJS_KEYS.BLOCKS)) return
        const nextBlock = workflowMap.get(YJS_KEYS.BLOCKS)?.[blockId]
        if (nextBlock === observedBlock) return
        observedBlock = nextBlock
        cb()
      }

      const subBlockFieldsHandler = (events: Y.YEvent<any>[]) => {
        for (const event of events) {
          if (
            event.path[0] === blockId ||
            (event.path.length === 0 && (event as Y.YMapEvent<any>).keysChanged.has(blockId))
          ) {
            cb()
            return
          }
        }
      }

      workflowMap.observe(workflowHandler)
      subBlockFields.observeDeep(subBlockFieldsHandler)

      return () => {
        workflowMap.unobserve(workflowHandler)
        subBlockFields.unobserveDeep(subBlockFieldsHandler)
      }
    }
  }, [blockId, doc])

  const extract = useCallback(() => {
    if (!doc) return null
    const blocks = readWorkflowMap(doc).get(YJS_KEYS.BLOCKS) as
      | Record<string, BlockState>
      | undefined
    const block = blocks?.[blockId] ?? null
    return materializeWorkflowBlockFields(blockId, block, readWorkflowSubBlockFieldsMap(doc))
  }, [blockId, doc])

  const isEqual = useCallback((a: BlockState | null, b: BlockState | null) => {
    if (a === b) return true
    if (a === null || b === null) return false
    const aKeys = Object.keys(a) as (keyof BlockState)[]
    const bKeys = Object.keys(b) as (keyof BlockState)[]
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k) => Object.is(a[k], b[k]))
  }, [])

  return useYjsSubscription(subscribe, extract, null, isEqual)
}

/** Subscribe to whether a block is locked or nested inside a locked container */
export function useBlockProtection(blockId: string): boolean {
  const session = useOptionalWorkflowSession()
  const doc = session?.doc ?? null

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const ymap = doc.getMap(YJS_KEYS.WORKFLOW)
    return (cb: () => void) => {
      const handler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(YJS_KEYS.BLOCKS)) return
        cb()
      }
      ymap.observe(handler)
      return () => ymap.unobserve(handler)
    }
  }, [doc])

  const extract = useCallback(() => {
    if (!doc || !blockId) return false
    const blocks =
      (doc.getMap(YJS_KEYS.WORKFLOW).get(YJS_KEYS.BLOCKS) as
        | Record<string, BlockState>
        | undefined) ?? EMPTY_BLOCKS
    return isBlockProtected(blockId, blocks)
  }, [blockId, doc])

  return useYjsSubscription(subscribe, extract, false)
}

const EMPTY_FIELD = { value: null as any, yText: null as Y.Text | null }

function useWorkflowFieldState(blockId: string, subBlockId: string, enabled = true) {
  const session = useOptionalWorkflowSession()
  const doc = enabled ? (session?.doc ?? null) : null

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const workflowMap = readWorkflowMap(doc)
    const fields = readWorkflowSubBlockFieldsMap(doc)
    return (cb: () => void) => {
      const workflowHandler = (event: Y.YMapEvent<any>) => {
        if (event.keysChanged.has(YJS_KEYS.BLOCKS)) cb()
      }
      const fieldHandler = (events: Y.YEvent<any>[]) => {
        for (const event of events) {
          if (
            (event.path.length === 0 && (event as Y.YMapEvent<any>).keysChanged.has(blockId)) ||
            (event.path[0] === blockId &&
              (event.path[1] === subBlockId ||
                (event.path.length === 1 &&
                  (event as Y.YMapEvent<any>).keysChanged.has(subBlockId))))
          ) {
            cb()
            return
          }
        }
      }
      workflowMap.observe(workflowHandler)
      fields.observeDeep(fieldHandler)
      return () => {
        workflowMap.unobserve(workflowHandler)
        fields.unobserveDeep(fieldHandler)
      }
    }
  }, [doc, blockId, subBlockId])

  const extract = useCallback(() => {
    if (!doc) return EMPTY_FIELD
    return {
      value: readWorkflowSubBlockFieldValue(doc, blockId, subBlockId),
      yText: readWorkflowTextField(doc, blockId, subBlockId),
    }
  }, [doc, blockId, subBlockId])

  const isEqual = useCallback(
    (a: typeof EMPTY_FIELD, b: typeof EMPTY_FIELD) =>
      Object.is(a.value, b.value) && a.yText === b.yText,
    []
  )
  return useYjsSubscription(subscribe, extract, EMPTY_FIELD, isEqual)
}

/** Subscribe to a specific subblock value. */
export function useSubBlockValue(blockId: string, subBlockId: string): any {
  return useWorkflowFieldState(blockId, subBlockId).value
}

export function useWorkflowField(
  blockId: string,
  subBlockId: string,
  fallback = '',
  options: { enabled?: boolean; collaborative?: boolean } = {}
): {
  value: string
  yText: Y.Text | null
  setValue: (value: string) => void
} {
  const session = useOptionalWorkflowSession()
  const transactWorkflow = session?.transactWorkflow
  const enabled = options.enabled ?? true
  const collaborative = options.collaborative ?? true
  const doc = enabled ? (session?.doc ?? null) : null
  const field = useWorkflowFieldState(blockId, subBlockId, enabled)
  const value = field.value === undefined || !doc ? fallback : stringifySubBlockValue(field.value)

  const setValue = useCallback(
    (nextValue: string) =>
      transactWorkflow?.((workflowDoc) => {
        setWorkflowSubBlockValues(workflowDoc, [
          { blockId, subBlockId, value: nextValue, collaborative },
        ])
      }, YJS_ORIGINS.USER),
    [blockId, collaborative, subBlockId, transactWorkflow]
  )

  useEffect(() => {
    if (!doc || !collaborative || !transactWorkflow || field.value !== undefined) return
    transactWorkflow((workflowDoc) => {
      if (!readWorkflowSubBlockFieldsMap(workflowDoc).get(blockId)?.has(subBlockId)) {
        setWorkflowSubBlockValues(workflowDoc, [
          { blockId, subBlockId, value: fallback, collaborative },
        ])
      }
    }, YJS_ORIGINS.SYSTEM)
  }, [blockId, collaborative, doc, fallback, field.value, subBlockId, transactWorkflow])

  return { value, yText: field.yText, setValue }
}

/** Subscribe to all variables from the Yjs doc */
const EMPTY_VARIABLES: Record<string, any> = {}

export function useWorkflowVariables(): Record<string, any> {
  const session = useOptionalWorkflowSession()
  const doc = session?.doc ?? null

  // Cache the previous extraction result so we can skip the full forEach
  // iteration when the observer fires but the map contents are unchanged.
  const prevResultRef = useRef<Record<string, any>>(EMPTY_VARIABLES)
  const prevSizeRef = useRef<number>(0)

  // Use shallow observe instead of observeDeep.  Variables are stored as
  // top-level keys in the Y.Map, so observe() fires for adds/deletes/replaces
  // which is sufficient.  This avoids unconditionally forcing new object
  // identity on every deep sub-key change.
  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const vMap = getVariablesMap(doc)
    return (cb: () => void) => {
      const handler = () => {
        cb()
      }
      vMap.observe(handler)
      return () => vMap.unobserve(handler)
    }
  }, [doc])

  const extract = useCallback(() => {
    if (!doc) return EMPTY_VARIABLES
    const vMap = getVariablesMap(doc)
    const size = vMap.size

    // Fast path: if the map size matches the cached result, do a quick
    // reference-equality check on each entry before allocating a new object.
    if (size === prevSizeRef.current) {
      let unchanged = true
      for (const [key, value] of vMap.entries()) {
        if (!Object.is(prevResultRef.current[key], value)) {
          unchanged = false
          break
        }
      }
      if (unchanged) return prevResultRef.current
    }

    const result: Record<string, any> = {}
    for (const [key, value] of vMap.entries()) {
      result[key] = value
    }
    prevResultRef.current = result
    prevSizeRef.current = size
    return result
  }, [doc])

  const isEqual = useCallback((a: Record<string, any>, b: Record<string, any>) => {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k) => Object.is(a[k], b[k]))
  }, [])

  return useYjsSubscription(subscribe, extract, EMPTY_VARIABLES, isEqual)
}

/** Get the full workflow snapshot (non-reactive, imperative read) */
export function useWorkflowSnapshotReader(): () => WorkflowSnapshot | null {
  const session = useOptionalWorkflowSession()
  return useCallback(() => {
    if (!session?.doc) return null
    return readWorkflowSnapshot(session.doc)
  }, [session?.doc])
}

// ---------------------------------------------------------------------------
// Workflow mutation helpers
// ---------------------------------------------------------------------------

/**
 * Returns mutation methods that write directly to the Yjs doc.
 * These replace the Zustand store actions.
 */
export function useWorkflowMutations() {
  const session = useWorkflowSession()
  const { doc, transactWorkflow } = session

  /**
   * Shared helper: read blocks, apply an updater to one block, write back.
   * If the updater returns the same reference the write is skipped (no-op).
   */
  const patchBlock = useCallback(
    (
      id: string,
      updater: (block: any) => any,
      options?: {
        origin?: YjsOrigin
      }
    ) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        const block = blocks[id]
        if (!block) return
        const updated = updater(block)
        if (updated === block) return
        blocks[id] = updated
        wMap.set(YJS_KEYS.BLOCKS, blocks)
      }, options?.origin ?? YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const addBlock = useCallback(
    (
      id: string,
      type: string,
      name: string,
      position: Position,
      data?: Record<string, any>,
      parentId?: string,
      extent?: 'parent',
      blockProperties?: {
        enabled?: boolean
        locked?: boolean
        horizontalHandles?: boolean
        isWide?: boolean
        advancedMode?: boolean
        triggerMode?: boolean
        height?: number
        /** Pre-populate subblock values during creation (single transaction). */
        initialSubBlockValues?: Record<string, any>
      }
    ) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }

        const blockConfig = getBlock(type)
        let subBlocks: Record<string, SubBlockState> = {}
        const outputs: Record<string, any> = {}

        if (blockConfig) {
          const initValues = blockProperties?.initialSubBlockValues
          subBlocks = buildInitialSubBlockStates(blockConfig.subBlocks, initValues) as Record<
            string,
            SubBlockState
          >

          Object.assign(
            outputs,
            resolveOutputType(readBlockOutputs(type, subBlocks, blockProperties?.triggerMode))
          )
        }

        const block: BlockState = {
          id,
          type,
          name,
          position,
          subBlocks,
          outputs,
          enabled: blockProperties?.enabled ?? true,
          locked: blockProperties?.locked ?? false,
          horizontalHandles: blockProperties?.horizontalHandles ?? true,
          isWide: blockProperties?.isWide ?? false,
          advancedMode: blockProperties?.advancedMode ?? false,
          triggerMode: blockProperties?.triggerMode ?? false,
          height: blockProperties?.height ?? 0,
          data: {
            ...data,
            ...(parentId ? { parentId, extent: extent ?? 'parent' } : {}),
          },
        }

        blocks[id] = block
        wMap.set(YJS_KEYS.BLOCKS, blocks)
        ensureWorkflowBlockFieldsMap(d, id)
        setWorkflowSubBlockValues(
          d,
          Object.entries(subBlocks).map(([subBlockId, field]) => ({
            blockId: id,
            subBlockId,
            value: field.value,
          }))
        )
      }, YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const removeBlock = useCallback(
    (id: string) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const subBlockFields = readWorkflowSubBlockFieldsMap(d)
        const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        const edges: Edge[] = [...(wMap.get(YJS_KEYS.EDGES) ?? [])]

        // Find all descendants (for container nodes)
        const descendants = findAllDescendantNodes(id, blocks)
        const allIdsToRemove = new Set([id, ...descendants])

        // Remove blocks
        for (const blockId of allIdsToRemove) {
          delete blocks[blockId]
          subBlockFields.delete(blockId)
        }

        // Remove connected edges
        const filteredEdges = edges.filter(
          (e) => !allIdsToRemove.has(e.source) && !allIdsToRemove.has(e.target)
        )

        wMap.set(YJS_KEYS.BLOCKS, blocks)
        wMap.set(YJS_KEYS.EDGES, filteredEdges)
      }, YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const addEdge = useCallback(
    (edge: Edge) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const edges: Edge[] = [...(wMap.get(YJS_KEYS.EDGES) ?? [])]

        // Don't add duplicate edges
        const exists = edges.some(
          (e) =>
            e.source === edge.source &&
            e.target === edge.target &&
            e.sourceHandle === edge.sourceHandle &&
            e.targetHandle === edge.targetHandle
        )
        if (exists) return

        wMap.set(YJS_KEYS.EDGES, [...edges, edge])
      }, YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const removeEdge = useCallback(
    (edgeId: string) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const edges: Edge[] = (wMap.get(YJS_KEYS.EDGES) ?? []).filter((e: Edge) => e.id !== edgeId)
        wMap.set(YJS_KEYS.EDGES, edges)
      }, YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const updateBlockPosition = useCallback(
    (
      id: string,
      position: Position,
      options?: {
        origin?: YjsOrigin
      }
    ) => patchBlock(id, (b) => ({ ...b, position }), options),
    [patchBlock]
  )

  const updateBlockPositions = useCallback(
    (
      updates: Array<{ id: string; position: Position }>,
      options?: {
        origin?: YjsOrigin
      }
    ) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        for (const { id, position } of updates) {
          if (blocks[id]) {
            blocks[id] = { ...blocks[id], position }
          }
        }
        wMap.set(YJS_KEYS.BLOCKS, blocks)
      }, options?.origin ?? YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const updateBlockName = useCallback(
    (id: string, name: string): boolean => {
      if (!doc) return false
      const trimmedName = name.trim()
      if (!trimmedName) return false
      let success = false

      // Perform the uniqueness check AND write inside a single transaction
      // to avoid a TOCTOU race in collaborative sessions where another user
      // could mutate blocks between the read and the write.
      transactWorkflow((d) => {
        const wm = readWorkflowMap(d)
        const blocks: Record<string, any> = wm.get(YJS_KEYS.BLOCKS) ?? {}
        const block = blocks[id]
        if (!block) return

        const normalizedRequestedName = normalizeBlockName(trimmedName)
        const hasCollision = Object.entries(blocks).some(
          ([blockId, otherBlock]: [string, any]) =>
            blockId !== id &&
            typeof otherBlock.name === 'string' &&
            normalizeBlockName(otherBlock.name) === normalizedRequestedName
        )
        if (hasCollision) return
        if (block.name === trimmedName) {
          success = true
          return
        }

        wm.set(YJS_KEYS.BLOCKS, { ...blocks, [id]: { ...block, name: trimmedName } })

        if (block.name !== trimmedName && block.name.trim() !== '') {
          const normalizedOld = normalizeBlockName(block.name)
          const regex = new RegExp(`<${escapeRegExp(normalizedOld)}(?=(?:>|\\.))`, 'gi')
          const replacement = `<${normalizedRequestedName}`

          rewriteWorkflowContentReferences(d, regex, replacement)
        }
        success = true
      }, YJS_ORIGINS.USER)

      return success
    },
    [doc, transactWorkflow]
  )

  const toggleBlockEnabled = useCallback(
    (id: string) => patchBlock(id, (b) => ({ ...b, enabled: !b.enabled })),
    [patchBlock]
  )

  const toggleBlockLocked = useCallback(
    (id: string) =>
      patchBlock(id, (b) => {
        const locked = !b.locked
        return { ...b, locked, data: { ...b.data, locked } }
      }),
    [patchBlock]
  )

  const setBlockAdvancedMode = useCallback(
    (id: string, advancedMode: boolean) => patchBlock(id, (b) => ({ ...b, advancedMode })),
    [patchBlock]
  )

  const setBlockTriggerMode = useCallback(
    (id: string, triggerMode: boolean) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        const block = blocks[id]
        const blockConfig = block ? getBlock(block.type) : undefined
        if (!block || !blockConfig) return

        const updated = {
          ...block,
          subBlocks: block.subBlocks ?? {},
          outputs: resolveOutputType(
            readBlockOutputs(
              block.type,
              materializeWorkflowBlockFields(id, block, readWorkflowSubBlockFieldsMap(d))!
                .subBlocks,
              triggerMode
            )
          ),
          triggerMode,
        }

        blocks[id] = updated
        wMap.set(YJS_KEYS.BLOCKS, blocks)

        if (triggerMode) {
          const edges: Edge[] = [...(wMap.get(YJS_KEYS.EDGES) ?? [])]
          wMap.set(
            YJS_KEYS.EDGES,
            edges.filter((edge) => edge.target !== id)
          )
        }
      }, YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const toggleBlockWide = useCallback(
    (id: string) => patchBlock(id, (b) => ({ ...b, isWide: !b.isWide })),
    [patchBlock]
  )

  const toggleBlockHandles = useCallback(
    (id: string) => patchBlock(id, (b) => ({ ...b, horizontalHandles: !b.horizontalHandles })),
    [patchBlock]
  )

  const updateBlockLayoutMetrics = useCallback(
    (id: string, dimensions: { width: number; height: number }) =>
      patchBlock(id, (b) => ({
        ...b,
        layout: { ...b.layout, measuredWidth: dimensions.width, measuredHeight: dimensions.height },
      })),
    [patchBlock]
  )

  const updateNodeDimensions = useCallback(
    (id: string, dimensions: { width: number; height: number }) =>
      patchBlock(id, (b) => ({
        ...b,
        data: { ...b.data, width: dimensions.width, height: dimensions.height },
      })),
    [patchBlock]
  )

  const updateParentId = useCallback(
    (id: string, parentId: string, extent: 'parent') =>
      patchBlock(id, (b) => {
        if (parentId) {
          return { ...b, data: { ...b.data, parentId, extent } }
        }

        const {
          parentId: _parentId,
          extent: _extent,
          width: _width,
          height: _height,
          ...data
        } = b.data ?? {}
        return { ...b, data }
      }),
    [patchBlock]
  )

  const updateParentIds = useCallback(
    (updates: Array<{ id: string; parentId: string; extent: 'parent' }>) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        for (const { id, parentId, extent } of updates) {
          if (blocks[id]) {
            blocks[id] = {
              ...blocks[id],
              data: parentId
                ? { ...blocks[id].data, parentId, extent }
                : (() => {
                    const {
                      parentId: _parentId,
                      extent: _extent,
                      width: _width,
                      height: _height,
                      ...data
                    } = blocks[id].data ?? {}
                    return data
                  })(),
            }
          }
        }
        wMap.set(YJS_KEYS.BLOCKS, blocks)
      }, YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const setSubBlockValue = useCallback(
    (blockId: string, subBlockId: string, value: any) =>
      transactWorkflow(
        (doc) => setWorkflowSubBlockValues(doc, [{ blockId, subBlockId, value }]),
        YJS_ORIGINS.USER
      ),
    [transactWorkflow]
  )

  /** Batch multiple subblock value updates into a single Yjs transaction */
  const batchSetSubBlockValues = useCallback(
    (updates: Array<{ blockId: string; subBlockId: string; value: any }>) =>
      transactWorkflow((doc) => setWorkflowSubBlockValues(doc, updates), YJS_ORIGINS.USER),
    [transactWorkflow]
  )

  const replaceWorkflowState = useCallback(
    (state: WorkflowState) =>
      transactWorkflow(
        (workflowDoc) =>
          setWorkflowState(workflowDoc, state as unknown as WorkflowSnapshot, YJS_ORIGINS.SYSTEM),
        YJS_ORIGINS.SYSTEM
      ),
    [transactWorkflow]
  )

  const addVariable = useCallback(
    (variable: Omit<Variable, 'id'>, providedId?: string) =>
      transactWorkflow(
        (workflowDoc) => addWorkflowVariable(workflowDoc, variable, providedId, YJS_ORIGINS.USER),
        YJS_ORIGINS.USER
      ) ?? '',
    [transactWorkflow]
  )

  const updateVariable = useCallback(
    (id: string, update: Partial<Omit<Variable, 'id' | 'workflowId'>>) =>
      transactWorkflow(
        (workflowDoc) => updateWorkflowVariable(workflowDoc, id, update, YJS_ORIGINS.USER),
        YJS_ORIGINS.USER
      ) ?? false,
    [transactWorkflow]
  )

  const deleteVariable = useCallback(
    (id: string) =>
      transactWorkflow(
        (workflowDoc) => deleteWorkflowVariable(workflowDoc, id, YJS_ORIGINS.USER),
        YJS_ORIGINS.USER
      ) ?? false,
    [transactWorkflow]
  )

  const duplicateVariable = useCallback(
    (id: string, providedId?: string) =>
      transactWorkflow(
        (workflowDoc) => duplicateWorkflowVariable(workflowDoc, id, providedId, YJS_ORIGINS.USER),
        YJS_ORIGINS.USER
      ) ?? null,
    [transactWorkflow]
  )

  const clear = useCallback(() => {
    transactWorkflow((d) => {
      const wMap = readWorkflowMap(d)
      wMap.set(YJS_KEYS.BLOCKS, {})
      wMap.set(YJS_KEYS.EDGES, [])
      readWorkflowSubBlockFieldsMap(d).clear()
    }, YJS_ORIGINS.SYSTEM)
  }, [transactWorkflow])

  return {
    addBlock,
    removeBlock,
    addEdge,
    removeEdge,
    updateBlockPosition,
    updateBlockPositions,
    updateBlockName,
    toggleBlockEnabled,
    toggleBlockLocked,
    setBlockAdvancedMode,
    setBlockTriggerMode,
    toggleBlockWide,
    toggleBlockHandles,
    updateBlockLayoutMetrics,
    updateNodeDimensions,
    updateParentId,
    updateParentIds,
    setSubBlockValue,
    batchSetSubBlockValues,
    replaceWorkflowState,
    addVariable,
    updateVariable,
    deleteVariable,
    duplicateVariable,
    clear,
  }
}

// ---------------------------------------------------------------------------
// Convenience: combined read+write hook
// ---------------------------------------------------------------------------

export function useWorkflowDoc() {
  const blocks = useWorkflowBlocks()
  const edges = useWorkflowEdges()
  const loops = useMemo(() => generateLoopBlocks(blocks), [blocks])
  const parallels = useMemo(() => generateParallelBlocks(blocks), [blocks])
  const mutations = useWorkflowMutations()
  const session = useOptionalWorkflowSession()

  return {
    // State (reactive)
    blocks,
    edges,
    loops,
    parallels,
    lastSaved: useYjsMapValue(
      session?.doc ?? null,
      YJS_KEYS.WORKFLOW,
      YJS_KEYS.LAST_SAVED,
      undefined
    ),

    // Mutations
    ...mutations,

    updateLastSaved: () =>
      session?.transactWorkflow(
        (workflowDoc) => readWorkflowMap(workflowDoc).set(YJS_KEYS.LAST_SAVED, Date.now()),
        YJS_ORIGINS.SYSTEM
      ),
  }
}
