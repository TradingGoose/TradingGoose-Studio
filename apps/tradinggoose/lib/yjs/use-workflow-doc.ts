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
  createWorkflowTextFieldKey,
  ensureWorkflowTextField,
  getVariablesMap,
  materializeWorkflowBlockTextFields,
  materializeWorkflowTextFields,
  parseWorkflowTextFieldKey,
  readWorkflowMap,
  readWorkflowSnapshot,
  readWorkflowTextField,
  readWorkflowTextFieldFromMap,
  readWorkflowTextFieldsMap,
  readWorkflowTextFieldValue,
  replaceWorkflowTextField,
  setWorkflowState,
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
// Helpers shared across mutations (no hook state captured)
// ---------------------------------------------------------------------------

export function setWorkflowSubBlockValues(
  doc: Y.Doc,
  updates: Array<{ blockId: string; subBlockId: string; value: any }>
): void {
  const wMap = readWorkflowMap(doc)
  const textFields = readWorkflowTextFieldsMap(doc)
  const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
  let changed = false
  for (const { blockId, subBlockId, value } of updates) {
    const block = blocks[blockId]
    if (!block) continue
    const sharedText = readWorkflowTextFieldFromMap(textFields, blockId, subBlockId)
    if (sharedText) {
      replaceWorkflowTextField(doc, blockId, subBlockId, stringifySubBlockValue(value))
    }

    const subBlocks = sharedText
      ? block.subBlocks
      : {
          ...block.subBlocks,
          [subBlockId]: { ...(block.subBlocks?.[subBlockId] ?? { id: subBlockId }), value },
        }
    if (!getBlock(block.type)) {
      if (sharedText) continue
      blocks[blockId] = { ...block, subBlocks }
    } else {
      const outputSubBlocks = materializeWorkflowBlockTextFields(
        blockId,
        { ...block, subBlocks },
        textFields
      )!.subBlocks
      blocks[blockId] = {
        ...block,
        subBlocks,
        outputs: resolveOutputType(
          readBlockOutputs(block.type, outputSubBlocks, block.triggerMode === true)
        ),
      }
    }
    changed = true
  }
  if (changed) {
    wMap.set(YJS_KEYS.BLOCKS, blocks)
  }
}

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

export function bindWorkflowTextObserver(
  textFields: Y.Map<any>,
  blockId: string,
  subBlockId: string,
  cb: () => void
): {
  rebind: () => void
  cleanup: () => void
} {
  let observedText: Y.Text | null = null
  const textHandler = () => cb()

  const cleanup = () => {
    if (!observedText) {
      return
    }

    observedText.unobserve(textHandler)
    observedText = null
  }

  const rebind = () => {
    const nextText = readWorkflowTextFieldFromMap(textFields, blockId, subBlockId)
    if (nextText === observedText) {
      return
    }

    cleanup()
    if (!nextText) {
      return
    }

    nextText.observe(textHandler)
    observedText = nextText
  }

  return { rebind, cleanup }
}

/** Subscribe to the full blocks record from the Yjs workflow doc */
export function useWorkflowBlocks(): Record<string, BlockState> {
  const session = useOptionalWorkflowSession()
  const doc = session?.doc ?? null

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}

    const workflowMap = readWorkflowMap(doc)
    const textFields = readWorkflowTextFieldsMap(doc)

    return (cb: () => void) => {
      let textObserversCleanup = () => {}

      const bindTextObservers = () => {
        textObserversCleanup()

        const blocks =
          (workflowMap.get(YJS_KEYS.BLOCKS) as Record<string, BlockState> | undefined) ??
          EMPTY_BLOCKS
        const observers: Array<() => void> = []

        for (const [blockId, block] of Object.entries(blocks)) {
          if (!block?.subBlocks) {
            continue
          }

          for (const subBlockId of Object.keys(block.subBlocks)) {
            const sharedText = readWorkflowTextFieldFromMap(textFields, blockId, subBlockId)
            if (!sharedText) {
              continue
            }

            const handler = () => cb()
            sharedText.observe(handler)
            observers.push(() => sharedText.unobserve(handler))
          }
        }

        textObserversCleanup = () => {
          for (const cleanup of observers) {
            cleanup()
          }
        }
      }

      const workflowHandler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(YJS_KEYS.BLOCKS)) return
        bindTextObservers()
        cb()
      }

      const textFieldsHandler = (event: Y.YMapEvent<any>) => {
        for (const key of event.keysChanged) {
          if (!parseWorkflowTextFieldKey(key)) {
            continue
          }

          bindTextObservers()
          cb()
          return
        }
      }

      bindTextObservers()
      workflowMap.observe(workflowHandler)
      // Rebind on structure changes; live Y.Text edits are observed directly
      // from the current shared text instances.
      textFields.observe(textFieldsHandler)

      return () => {
        textObserversCleanup()
        workflowMap.unobserve(workflowHandler)
        textFields.unobserve(textFieldsHandler)
      }
    }
  }, [doc])

  const extract = useCallback(() => {
    if (!doc) return EMPTY_BLOCKS

    return materializeWorkflowTextFields(
      readWorkflowMap(doc).get(YJS_KEYS.BLOCKS) ?? EMPTY_BLOCKS,
      readWorkflowTextFieldsMap(doc)
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
  const doc = session?.doc ?? null

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const workflowMap = readWorkflowMap(doc)
    const textFields = readWorkflowTextFieldsMap(doc)

    return (cb: () => void) => {
      let textObserversCleanup = () => {}

      const bindTextObservers = () => {
        textObserversCleanup()
        const block =
          (workflowMap.get(YJS_KEYS.BLOCKS) as Record<string, BlockState> | undefined)?.[blockId] ??
          null
        if (!block?.subBlocks) {
          textObserversCleanup = () => {}
          return
        }

        const observers: Array<() => void> = []
        for (const subBlockId of Object.keys(block.subBlocks)) {
          const sharedText = readWorkflowTextFieldFromMap(textFields, blockId, subBlockId)
          if (!sharedText) continue
          const handler = () => cb()
          sharedText.observe(handler)
          observers.push(() => sharedText.unobserve(handler))
        }
        textObserversCleanup = () => {
          for (const cleanup of observers) cleanup()
        }
      }

      const workflowHandler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(YJS_KEYS.BLOCKS)) return
        bindTextObservers()
        cb()
      }

      const textFieldsHandler = (event: Y.YMapEvent<any>) => {
        for (const key of event.keysChanged) {
          const parsed = parseWorkflowTextFieldKey(key)
          if (parsed?.blockId !== blockId) {
            continue
          }
          bindTextObservers()
          cb()
          return
        }
      }

      bindTextObservers()
      workflowMap.observe(workflowHandler)
      textFields.observe(textFieldsHandler)

      return () => {
        textObserversCleanup()
        workflowMap.unobserve(workflowHandler)
        textFields.unobserve(textFieldsHandler)
      }
    }
  }, [blockId, doc])

  const extract = useCallback(() => {
    if (!doc) return null
    const blocks = readWorkflowMap(doc).get(YJS_KEYS.BLOCKS) as
      | Record<string, BlockState>
      | undefined
    const block = blocks?.[blockId] ?? null
    return materializeWorkflowBlockTextFields(blockId, block, readWorkflowTextFieldsMap(doc))
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

/** Subscribe to a specific subblock value (fine-grained: only re-renders when value changes) */
export function useSubBlockValue(blockId: string, subBlockId: string, enabled = true): any {
  const session = useOptionalWorkflowSession()
  const doc = enabled ? (session?.doc ?? null) : null
  const textFieldKey = createWorkflowTextFieldKey(blockId, subBlockId)

  // Cache the previous raw value reference AND its serialized form.
  // On observer fire we first check reference equality (O(1)) to skip
  // JSON.stringify entirely when the value object hasn't been replaced.
  // This is the common case for mutations to other blocks.
  //
  // NOTE: These are mutable caches written from inside event handlers, not
  // "latest render value" refs, so useLatestRef is not applicable here.
  const prevRawRef = useRef<any>(undefined)
  const serializedRef = useRef<string | null>(null)

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const ymap = doc.getMap(YJS_KEYS.WORKFLOW)
    const textFields = readWorkflowTextFieldsMap(doc)
    return (cb: () => void) => {
      const textObserver = bindWorkflowTextObserver(textFields, blockId, subBlockId, cb)

      // Perf: use shallow observe and filter to the 'blocks' key so that
      // edge/loop/parallel changes don't trigger comparisons for every
      // mounted subblock instance.
      const handler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(YJS_KEYS.BLOCKS)) return
        const newValue =
          readWorkflowTextFieldValue(doc, blockId, subBlockId) ??
          (ymap.get(YJS_KEYS.BLOCKS) as Record<string, any> | undefined)?.[blockId]?.subBlocks?.[
            subBlockId
          ]?.value ??
          null

        // Fast path: if the raw reference is identical, the value hasn't
        // changed — skip JSON.stringify entirely.
        if (newValue === prevRawRef.current) return
        prevRawRef.current = newValue

        // Only stringify the new value; compare against cached serialized form
        const newSerialized = JSON.stringify(newValue)
        if (newSerialized === serializedRef.current) return
        serializedRef.current = newSerialized
        cb()
      }

      const textFieldsHandler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(textFieldKey)) return
        textObserver.rebind()
        cb()
      }

      textObserver.rebind()
      ymap.observe(handler)
      textFields.observe(textFieldsHandler)
      return () => {
        textObserver.cleanup()
        ymap.unobserve(handler)
        textFields.unobserve(textFieldsHandler)
      }
    }
  }, [doc, blockId, subBlockId, textFieldKey])

  const extract = useCallback(() => {
    if (!doc) return null
    const blocks = doc.getMap(YJS_KEYS.WORKFLOW).get(YJS_KEYS.BLOCKS) as
      | Record<string, any>
      | undefined
    const value =
      readWorkflowTextFieldValue(doc, blockId, subBlockId) ??
      blocks?.[blockId]?.subBlocks?.[subBlockId]?.value ??
      null
    prevRawRef.current = value
    serializedRef.current = JSON.stringify(value)
    return value
  }, [doc, blockId, subBlockId])

  return useYjsSubscription(subscribe, extract, null)
}

export function useWorkflowTextField(
  blockId: string,
  subBlockId: string,
  fallback = '',
  options: {
    enabled?: boolean
    autoCreate?: boolean
    mirrorDelayMs?: number | null
  } = {}
): {
  value: string
  yText: Y.Text | null
  setValue: (value: string) => void
} {
  const session = useOptionalWorkflowSession()
  const transactWorkflow = session?.transactWorkflow
  const enabled = options.enabled ?? true
  const autoCreate = options.autoCreate ?? enabled
  const mirrorDelayMs = options.mirrorDelayMs ?? null
  const doc = enabled ? (session?.doc ?? null) : null
  const textFieldKey = createWorkflowTextFieldKey(blockId, subBlockId)

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}

    const workflowMap = readWorkflowMap(doc)
    const textFields = readWorkflowTextFieldsMap(doc)

    return (cb: () => void) => {
      const textObserver = bindWorkflowTextObserver(textFields, blockId, subBlockId, cb)

      const workflowHandler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(YJS_KEYS.BLOCKS)) return
        cb()
      }

      const textFieldsHandler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(textFieldKey)) return
        textObserver.rebind()
        cb()
      }

      textObserver.rebind()
      workflowMap.observe(workflowHandler)
      textFields.observe(textFieldsHandler)

      return () => {
        textObserver.cleanup()
        workflowMap.unobserve(workflowHandler)
        textFields.unobserve(textFieldsHandler)
      }
    }
  }, [blockId, doc, subBlockId, textFieldKey])

  const extract = useCallback(() => {
    if (!doc) return fallback

    const textValue = readWorkflowTextFieldValue(doc, blockId, subBlockId)
    if (textValue !== null) {
      return textValue
    }

    const blocks = readWorkflowMap(doc).get(YJS_KEYS.BLOCKS) as Record<string, any> | undefined
    const rawValue = blocks?.[blockId]?.subBlocks?.[subBlockId]?.value
    if (rawValue === null || rawValue === undefined) {
      return fallback
    }
    return stringifySubBlockValue(rawValue)
  }, [blockId, doc, fallback, subBlockId])

  const value = useYjsSubscription(subscribe, extract, fallback)

  const yText = useMemo(() => {
    if (!doc) return null
    return readWorkflowTextField(doc, blockId, subBlockId)
  }, [blockId, doc, subBlockId, value])

  const setValue = useCallback(
    (nextValue: string) =>
      transactWorkflow?.((workflowDoc) => {
        replaceWorkflowTextField(workflowDoc, blockId, subBlockId, nextValue, YJS_ORIGINS.USER)
      }, YJS_ORIGINS.USER),
    [blockId, subBlockId, transactWorkflow]
  )

  useEffect(() => {
    if (
      !doc ||
      !autoCreate ||
      !transactWorkflow ||
      readWorkflowTextField(doc, blockId, subBlockId)
    ) {
      return
    }

    transactWorkflow((workflowDoc) => {
      if (!readWorkflowTextField(workflowDoc, blockId, subBlockId)) {
        ensureWorkflowTextField(workflowDoc, blockId, subBlockId, extract())
      }
    }, YJS_ORIGINS.SYSTEM)
  }, [autoCreate, blockId, doc, extract, subBlockId, transactWorkflow])

  useEffect(() => {
    if (!doc || !transactWorkflow || mirrorDelayMs === null) {
      return
    }

    const timeoutId = setTimeout(() => {
      transactWorkflow((workflowDoc) => {
        const wMap = readWorkflowMap(workflowDoc)
        const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        const block = blocks[blockId]
        if (!block?.subBlocks?.[subBlockId]) return
        if (block.subBlocks[subBlockId]?.value === value) return

        blocks[blockId] = {
          ...block,
          subBlocks: {
            ...block.subBlocks,
            [subBlockId]: { ...block.subBlocks[subBlockId], value },
          },
        }
        wMap.set(YJS_KEYS.BLOCKS, blocks)
      }, YJS_ORIGINS.SYSTEM)
    }, mirrorDelayMs)

    return () => clearTimeout(timeoutId)
  }, [blockId, doc, mirrorDelayMs, subBlockId, transactWorkflow, value])

  return {
    value,
    yText,
    setValue,
  }
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
      }, YJS_ORIGINS.USER)
    },
    [transactWorkflow]
  )

  const removeBlock = useCallback(
    (id: string) => {
      transactWorkflow((d) => {
        const wMap = readWorkflowMap(d)
        const textFields = readWorkflowTextFieldsMap(d)
        const blocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        const edges: Edge[] = [...(wMap.get(YJS_KEYS.EDGES) ?? [])]

        // Find all descendants (for container nodes)
        const descendants = findAllDescendantNodes(id, blocks)
        const allIdsToRemove = new Set([id, ...descendants])

        // Remove blocks
        for (const blockId of allIdsToRemove) {
          delete blocks[blockId]
        }

        for (const key of Array.from(textFields.keys())) {
          const parsed = parseWorkflowTextFieldKey(key)
          if (!parsed || allIdsToRemove.has(parsed.blockId)) {
            textFields.delete(key)
          }
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
          outputs: resolveOutputType(readBlockOutputs(block.type, block.subBlocks, triggerMode)),
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
