'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react'
import { DEFAULT_INDICATOR_RUNTIME_ENTRIES } from '@/lib/indicators/default/runtime'
import { getListingIdentityKey } from '@/lib/listing/identity'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
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

type PairColorRuntimeState = {
  context: WidgetRuntimeContext
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
  contexts: Record<PairColor, PairColorContext>
  applyWidgetPatch: (panelId: string, patch: WidgetConfigMutationPatch) => void
}

const buildContexts = (colorPairs: PersistedColorPairsState): Record<PairColor, PairColorContext> =>
  PAIR_COLORS.reduce<Record<PairColor, PairColorContext>>(
    (acc, color) => {
      acc[color] = readPairColorContext(colorPairs, color)
      return acc
    },
    {} as Record<PairColor, PairColorContext>
  )

const PairColorContextValue = createContext<PairColorRuntimeState | null>(null)

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
      layout: LayoutNode
      colorPairs: PersistedColorPairsState
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
  useEffect(() => {
    useWorkflowRegistry.getState().syncLinkedWorkflowChannelsFromColorPairs(normalizedColorPairs)
  }, [normalizedColorPairs])
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
        return { layout: next.layout, colorPairs: next.colorPairs }
      })
    },
    [authorizedReferences, canWrite, context, onDocumentMutation]
  )
  const value = useMemo<PairColorRuntimeState>(
    () => ({
      context,
      layout: normalizedLayout,
      colorPairs: normalizedColorPairs,
      contexts: buildContexts(normalizedColorPairs),
      applyWidgetPatch,
    }),
    [applyWidgetPatch, context, normalizedColorPairs, normalizedLayout]
  )

  return <PairColorContextValue.Provider value={value}>{children}</PairColorContextValue.Provider>
}

function usePairRuntimeState(): PairColorRuntimeState {
  const state = useContext(PairColorContextValue)
  if (!state) {
    throw new Error('Widget config runtime hooks must be used inside WidgetConfigRuntimeProvider')
  }
  return state
}

export const useWidgetPairContext = (color: PairColor) => {
  const state = usePairRuntimeState()
  return state.contexts[color]
}

export const useWidgetConfigRuntimeActions = () => {
  const state = usePairRuntimeState()
  return useMemo(
    () => ({
      changeWidgetPairColor: (panelId: string, pairColor: PairColor) => {
        const widget = findLayoutPanelWidget(state.layout, panelId)
        if (!widget || !isWidgetKey(widget.key)) return
        state.applyWidgetPatch(panelId, { pairColor })
      },
      changeWidgetKey: (panelId: string, widgetKey: string) =>
        state.applyWidgetPatch(panelId, { widgetKey }),
      patchWidgetParams: (panelId: string, widgetKey: string, params: Record<string, unknown>) =>
        state.applyWidgetPatch(panelId, {
          widgetKey,
          params,
          paramsMode: 'patch',
        }),
    }),
    [state]
  )
}

/**
 * Safe variant of `useWidgetConfigRuntimeActions` for components that can render
 * outside `WidgetConfigRuntimeProvider` (e.g. standalone previews or copy tests).
 * Returns `null` when no provider is mounted; callers must no-op persistence.
 */
export const useWidgetConfigRuntimeActionsOptional = () => {
  const state = useContext(PairColorContextValue)
  const applyWidgetPatch = state?.applyWidgetPatch ?? null
  return useMemo(() => {
    if (!applyWidgetPatch) return null
    return {
      patchWidgetParams: (panelId: string, widgetKey: string, params: Record<string, unknown>) =>
        applyWidgetPatch(panelId, {
          widgetKey,
          params,
          paramsMode: 'patch',
        }),
    }
  }, [applyWidgetPatch])
}

export const useWidgetLocalParams = (panelId: string, widgetKey: WidgetKey) => {
  const state = usePairRuntimeState()
  const widget = findLayoutPanelWidget(state.layout, panelId)
  return widget?.key === widgetKey ? (widget.params ?? null) : null
}

export const useDashboardWidgetRenderConfig = (
  widget: WidgetInstance,
  panelId?: string
): WidgetInstance => {
  const state = useContext(PairColorContextValue)
  if (!state || !panelId || !widget || !isWidgetKey(widget.key)) {
    return widget
  }

  const current = findLayoutPanelWidget(state.layout, panelId)
  if (!current || current.key !== widget.key || !isWidgetKey(current.key)) {
    return widget
  }

  return {
    ...current,
    params: resolveEffectiveWidgetParams(current, state.colorPairs),
  }
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
