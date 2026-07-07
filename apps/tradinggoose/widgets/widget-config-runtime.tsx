'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { DEFAULT_INDICATOR_RUNTIME_ENTRIES } from '@/lib/indicators/default/runtime'
import { getListingIdentityKey } from '@/lib/listing/identity'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import {
  normalizeColorPairsState,
  normalizeListingIdentity,
  type PairColorContext,
  type PersistedColorPairsState,
  readPairColorContext,
} from '@/widgets/color-pairs'
import type { WidgetInstance } from '@/widgets/layout'
import { type LayoutNode, normalizeDashboardLayout } from '@/widgets/layout'
import { PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import type { WidgetRuntimeContext } from '@/widgets/types'
import {
  assertWidgetKey,
  isWidgetKey,
  resolveEffectiveWidgetParams,
  type WidgetKey,
  type WidgetReferenceParamField,
} from '@/widgets/widget-contracts'
import {
  applyWidgetConfigMutation,
  findLayoutPanelWidget,
  planWidgetConfigMutation,
  type WidgetConfigMutationPatch,
} from '@/widgets/widget-mutations'

type WidgetConfigRuntimeSnapshot = {
  context: WidgetRuntimeContext
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
  contexts: Record<PairColor, PairColorContext>
  applyWidgetPatch: (panelId: string, patch: WidgetConfigMutationPatch) => void
}

type PanelRuntimeState = {
  localWidget: WidgetInstance
  renderWidget: WidgetInstance
}

type WidgetConfigRuntimeStore = {
  setSnapshotForRender: (next: WidgetConfigRuntimeSnapshot) => void
  flushPendingSnapshot: () => void
  getSnapshot: () => WidgetConfigRuntimeSnapshot
  subscribeColor: (color: PairColor, listener: () => void) => () => void
  subscribePanel: (panelId: string, listener: () => void) => () => void
  getPairContext: (color: PairColor) => PairColorContext
  getPanelWidget: (panelId: string) => WidgetInstance
  getPanelRenderConfig: (panelId: string, fallback: WidgetInstance) => WidgetInstance
  getWidgetLocalParams: (panelId: string, widgetKey: WidgetKey) => Record<string, unknown> | null
  applyWidgetPatch: (panelId: string, patch: WidgetConfigMutationPatch) => void
}

const EMPTY_PAIR_CONTEXT: PairColorContext = {}

const buildContexts = (colorPairs: PersistedColorPairsState): Record<PairColor, PairColorContext> =>
  PAIR_COLORS.reduce<Record<PairColor, PairColorContext>>(
    (acc, color) => {
      acc[color] = readPairColorContext(colorPairs, color)
      return acc
    },
    {} as Record<PairColor, PairColorContext>
  )

const PairColorContextValue = createContext<WidgetConfigRuntimeStore | null>(null)

export function WidgetConfigRuntimeProvider({
  children,
  context,
  layout,
  colorPairs,
  canWrite,
  onDocumentMutation,
}: {
  children: ReactNode
  context: WidgetRuntimeContext
  layout: LayoutNode | unknown
  colorPairs: PersistedColorPairsState | unknown
  canWrite: boolean
  onDocumentMutation: (
    compute: (current: { layout: LayoutNode; colorPairs: PersistedColorPairsState }) => {
      layout?: LayoutNode
      colorPairs?: PersistedColorPairsState
    } | null
  ) => void
}) {
  const normalizedLayout = useMemo(() => normalizeDashboardLayout(layout), [layout])
  const normalizedColorPairs = useMemo(() => normalizeColorPairsState(colorPairs), [colorPairs])
  const workspaceId = context.workspaceId ?? null
  const workflowList = useEntityList('workflow', workspaceId)
  const indicatorList = useEntityList('indicator', workspaceId)
  const mcpServerList = useEntityList('mcp_server', workspaceId)
  const customToolList = useEntityList('custom_tool', workspaceId)
  const skillList = useEntityList('skill', workspaceId)
  const watchlistList = useEntityList('watchlist', workspaceId)
  const listingSelectorInstances = useListingSelectorStore((state) => state.instances)
  const authorizedReferences = useMemo(
    () =>
      collectRuntimeReferenceValues({
        workflowIds: workflowList.members.map((member) => member.entityId),
        watchlistIds: watchlistList.members.map((member) => member.entityId),
        indicatorIds: [
          ...DEFAULT_INDICATOR_RUNTIME_ENTRIES.map((entry) => entry.id),
          ...indicatorList.members.map((member) => member.entityId),
        ],
        mcpServerIds: mcpServerList.members.map((member) => member.entityId),
        customToolIds: customToolList.members.map((member) => member.entityId),
        skillIds: skillList.members.map((member) => member.entityId),
        listingSelectorInstances,
      }),
    [
      customToolList.members,
      indicatorList.members,
      listingSelectorInstances,
      mcpServerList.members,
      skillList.members,
      watchlistList.members,
      workflowList.members,
    ]
  )
  const applyWidgetPatch = useCallback(
    (panelId: string, patch: WidgetConfigMutationPatch) => {
      if (!canWrite) return
      onDocumentMutation((current) => {
        const plan = planWidgetConfigMutation({
          layout: current.layout,
          colorPairs: current.colorPairs,
          panelId,
          patch,
        })
        if (plan.references.length > 0) {
          assertReferencesAuthorizedForRuntimeMutation(plan.references, authorizedReferences)
        }
        const referenceValidation =
          plan.references.length > 0 ? buildRuntimeReferenceValidation(plan, context) : undefined
        const referenceValidationScope = referenceValidation
          ? {
              workspaceId: referenceValidation.workspaceId,
              ownerUserId: referenceValidation.ownerUserId,
            }
          : undefined
        const next = applyWidgetConfigMutation({
          layout: current.layout,
          colorPairs: current.colorPairs,
          panelId,
          patch,
          referenceValidationScope,
          referenceValidation,
        })
        const mutation: { layout?: LayoutNode; colorPairs?: PersistedColorPairsState } = {}
        if (!areJsonValuesEqual(current.layout, next.layout)) {
          mutation.layout = next.layout
        }
        if (!areJsonValuesEqual(current.colorPairs, next.colorPairs)) {
          mutation.colorPairs = next.colorPairs
        }
        return Object.keys(mutation).length > 0 ? mutation : null
      })
    },
    [authorizedReferences, canWrite, context, onDocumentMutation]
  )
  const snapshot = useMemo<WidgetConfigRuntimeSnapshot>(
    () => ({
      context,
      layout: normalizedLayout,
      colorPairs: normalizedColorPairs,
      contexts: buildContexts(normalizedColorPairs),
      applyWidgetPatch,
    }),
    [applyWidgetPatch, context, normalizedColorPairs, normalizedLayout]
  )
  const storeRef = useRef<WidgetConfigRuntimeStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createWidgetConfigRuntimeStore(snapshot)
  } else {
    storeRef.current.setSnapshotForRender(snapshot)
  }

  useEffect(() => {
    storeRef.current?.flushPendingSnapshot()
  }, [snapshot])

  return (
    <PairColorContextValue.Provider value={storeRef.current}>
      {children}
    </PairColorContextValue.Provider>
  )
}

function createWidgetConfigRuntimeStore(
  initial: WidgetConfigRuntimeSnapshot
): WidgetConfigRuntimeStore {
  let snapshot = initial
  let pendingPrevious: WidgetConfigRuntimeSnapshot | null = null
  let pendingNext: WidgetConfigRuntimeSnapshot | null = null
  const colorListeners = new Map<PairColor, Set<() => void>>()
  const panelListeners = new Map<string, Set<() => void>>()

  const subscribeColor = (color: PairColor, listener: () => void) => {
    const listeners = colorListeners.get(color) ?? new Set<() => void>()
    listeners.add(listener)
    colorListeners.set(color, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) colorListeners.delete(color)
    }
  }

  const subscribePanel = (panelId: string, listener: () => void) => {
    const listeners = panelListeners.get(panelId) ?? new Set<() => void>()
    listeners.add(listener)
    panelListeners.set(panelId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) panelListeners.delete(panelId)
    }
  }

  const emit = (listeners: Set<() => void> | undefined) => {
    if (!listeners) return
    for (const listener of listeners) listener()
  }

  const flushPendingSnapshot = () => {
    if (!pendingPrevious || !pendingNext) return
    const previous = pendingPrevious
    const next = pendingNext
    pendingPrevious = null
    pendingNext = null

    for (const color of colorListeners.keys()) {
      if (!areJsonValuesEqual(previous.contexts[color], next.contexts[color])) {
        emit(colorListeners.get(color))
      }
    }

    for (const panelId of panelListeners.keys()) {
      const before = readPanelRuntimeState(previous, panelId)
      const after = readPanelRuntimeState(next, panelId)
      if (!arePanelRuntimeStatesEqual(before, after)) {
        emit(panelListeners.get(panelId))
      }
    }
  }

  return {
    setSnapshotForRender: (next) => {
      if (!pendingPrevious) pendingPrevious = snapshot
      pendingNext = next
      snapshot = next
    },
    flushPendingSnapshot,
    getSnapshot: () => snapshot,
    subscribeColor,
    subscribePanel,
    getPairContext: (color) => snapshot.contexts[color] ?? EMPTY_PAIR_CONTEXT,
    getPanelWidget: (panelId) => findLayoutPanelWidget(snapshot.layout, panelId),
    getPanelRenderConfig: (panelId, fallback) => readPanelRenderWidget(snapshot, panelId, fallback),
    getWidgetLocalParams: (panelId, widgetKey) => {
      const widget = findLayoutPanelWidget(snapshot.layout, panelId)
      return widget?.key === widgetKey ? (widget.params ?? null) : null
    },
    applyWidgetPatch: (panelId, patch) => snapshot.applyWidgetPatch(panelId, patch),
  }
}

function readPanelRuntimeState(
  snapshot: WidgetConfigRuntimeSnapshot,
  panelId: string
): PanelRuntimeState {
  return {
    localWidget: findLayoutPanelWidget(snapshot.layout, panelId),
    renderWidget: readPanelRenderWidget(snapshot, panelId, null),
  }
}

function readPanelRenderWidget(
  snapshot: WidgetConfigRuntimeSnapshot,
  panelId: string,
  fallback: WidgetInstance
): WidgetInstance {
  const current = findLayoutPanelWidget(snapshot.layout, panelId) ?? fallback
  if (!current || !isWidgetKey(current.key)) return current
  return {
    ...current,
    params: resolveEffectiveWidgetParams(current, snapshot.colorPairs),
  }
}

function arePanelRuntimeStatesEqual(left: PanelRuntimeState, right: PanelRuntimeState): boolean {
  return (
    areWidgetInstancesEqual(left.localWidget, right.localWidget) &&
    areWidgetInstancesEqual(left.renderWidget, right.renderWidget)
  )
}

function areWidgetInstancesEqual(left: WidgetInstance, right: WidgetInstance): boolean {
  if (left === right) return true
  if (!left || !right) return left === right
  return (
    left.key === right.key &&
    left.pairColor === right.pairColor &&
    areJsonValuesEqual(left.params ?? null, right.params ?? null)
  )
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function usePairRuntimeStore(): WidgetConfigRuntimeStore {
  const store = useContext(PairColorContextValue)
  if (!store) {
    throw new Error('Widget config runtime hooks must be used inside WidgetConfigRuntimeProvider')
  }
  return store
}

export const useWidgetPairContext = (color: PairColor) => {
  const store = usePairRuntimeStore()
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeColor(color, listener),
    [color, store]
  )
  const extract = useCallback(() => store.getPairContext(color), [color, store])
  return useYjsSubscription(subscribe, extract, EMPTY_PAIR_CONTEXT, areJsonValuesEqual)
}

export const useWidgetConfigRuntimeActions = () => {
  const store = usePairRuntimeStore()
  return useMemo(
    () => ({
      changeWidgetPairColor: (panelId: string, pairColor: PairColor) => {
        const widget = store.getPanelWidget(panelId)
        if (!widget || !isWidgetKey(widget.key)) return
        store.applyWidgetPatch(panelId, { pairColor })
      },
      changeWidgetKey: (panelId: string, widgetKey: string) =>
        store.applyWidgetPatch(panelId, { widgetKey }),
      patchWidgetParams: (panelId: string, widgetKey: string, params: Record<string, unknown>) =>
        store.applyWidgetPatch(panelId, {
          widgetKey,
          params,
          paramsMode: 'patch',
        }),
    }),
    [store]
  )
}

/**
 * Safe variant of `useWidgetConfigRuntimeActions` for components that can render
 * outside `WidgetConfigRuntimeProvider` (e.g. standalone previews or copy tests).
 * Returns `null` when no provider is mounted; callers must no-op persistence.
 */
export const useWidgetConfigRuntimeActionsOptional = () => {
  const store = useContext(PairColorContextValue)
  return useMemo(() => {
    if (!store) return null
    return {
      patchWidgetParams: (panelId: string, widgetKey: string, params: Record<string, unknown>) =>
        store.applyWidgetPatch(panelId, {
          widgetKey,
          params,
          paramsMode: 'patch',
        }),
    }
  }, [store])
}

export const useWidgetLocalParams = (panelId: string, widgetKey: WidgetKey) => {
  const store = usePairRuntimeStore()
  const subscribe = useCallback(
    (listener: () => void) => store.subscribePanel(panelId, listener),
    [panelId, store]
  )
  const extract = useCallback(
    () => store.getWidgetLocalParams(panelId, widgetKey),
    [panelId, store, widgetKey]
  )
  return useYjsSubscription(subscribe, extract, null, areJsonValuesEqual)
}

export const useDashboardWidgetRenderConfig = (
  widget: WidgetInstance,
  panelId?: string
): WidgetInstance => {
  const store = useContext(PairColorContextValue)
  const subscribe = useCallback(
    (listener: () => void) =>
      store && panelId ? store.subscribePanel(panelId, listener) : () => {},
    [panelId, store]
  )
  const extract = useCallback(() => {
    if (!store || !panelId || !widget || !isWidgetKey(widget.key)) return widget
    return store.getPanelRenderConfig(panelId, widget)
  }, [panelId, store, widget])
  return useYjsSubscription(subscribe, extract, widget, areWidgetInstancesEqual)
}

function assertReferencesAuthorizedForRuntimeMutation(
  candidates: Array<{
    field: WidgetReferenceParamField
    value: string
    path: string
  }>,
  authorizedReferences: Set<string>
) {
  const missing = candidates.filter(
    (candidate) => !authorizedReferences.has(`${candidate.field}:${candidate.value}`)
  )
  if (missing.length > 0) {
    throw new Error(
      'Widget reference edits must come from an authorized selector or server validation'
    )
  }
}

function buildRuntimeReferenceValidation(
  plan: ReturnType<typeof planWidgetConfigMutation>,
  context: WidgetRuntimeContext
) {
  const workspaceId = context.workspaceId?.trim()
  const ownerUserId = context.dashboardLayoutOwnerUserId?.trim()
  if (!workspaceId || !ownerUserId) {
    throw new Error('Dashboard runtime reference validation requires workspace and owner identity')
  }
  if (!plan.afterWidget?.key) {
    throw new Error('Dashboard runtime reference validation requires a widget key')
  }
  const widgetKey = assertWidgetKey(plan.afterWidget.key)

  return {
    workspaceId,
    ownerUserId,
    panelId: plan.panelId,
    widgetKey,
    candidates: plan.references,
  }
}

function collectRuntimeReferenceValues(loaded: {
  workflowIds: readonly string[]
  watchlistIds: readonly string[]
  indicatorIds: readonly string[]
  mcpServerIds: readonly string[]
  customToolIds: readonly string[]
  skillIds: readonly string[]
  listingSelectorInstances: Record<
    string,
    {
      results?: unknown[]
      selectedListingValue?: unknown
      selectedListing?: unknown
    }
  >
}): Set<string> {
  const values = new Set<string>()
  addEntityListReferenceValues(values, 'workflowId', loaded.workflowIds)
  addEntityListReferenceValues(values, 'watchlistId', loaded.watchlistIds)
  addEntityListReferenceValues(values, 'indicatorId', loaded.indicatorIds)
  addEntityListReferenceValues(values, 'mcpServerId', loaded.mcpServerIds)
  addEntityListReferenceValues(values, 'customToolId', loaded.customToolIds)
  addEntityListReferenceValues(values, 'skillId', loaded.skillIds)
  for (const instance of Object.values(loaded.listingSelectorInstances)) {
    addListingReferenceValue(values, instance.selectedListingValue)
    addListingReferenceValue(values, instance.selectedListing)
    for (const result of instance.results ?? []) {
      addListingReferenceValue(values, result)
    }
  }
  return values
}

function addEntityListReferenceValues(
  values: Set<string>,
  field: WidgetReferenceParamField,
  ids: readonly string[]
) {
  for (const id of ids) {
    if (id) values.add(`${field}:${id}`)
  }
}

function addListingReferenceValue(values: Set<string>, value: unknown) {
  const listing = normalizeListingIdentity(value)
  if (listing) values.add(`listing:${getListingIdentityKey(listing)}`)
}
