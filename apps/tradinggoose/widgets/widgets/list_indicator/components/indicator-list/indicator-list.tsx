'use client'

import { useCallback, useMemo, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useDeleteIndicator,
  useIndicators,
  useUpdateIndicator,
} from '@/hooks/queries/indicators'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useIndicatorsStore } from '@/stores/indicators/store'
import type { IndicatorDefinition } from '@/stores/indicators/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { getCurrentTabId, writeSeed } from '@/widgets/utils/draft-bootstrap-seeds'
import {
  emitIndicatorSelectionChange,
  useIndicatorSelectionPersistence,
} from '@/widgets/utils/indicator-selection'
import {
  buildPersistedPairContext,
  getIndicatorIdFromParams,
} from '@/widgets/widgets/editor_indicator/utils'
import { IndicatorListItem } from './components/indicator-list-item'

export const IndicatorListMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

export function IndicatorList({
  context,
  params,
  onWidgetParamsChange,
  panelId,
  pairColor = 'gray',
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [copyingIds, setCopyingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { data: indicators = [], isLoading, error } = useIndicators(workspaceId ?? '')
  const deleteMutation = useDeleteIndicator()
  const updateMutation = useUpdateIndicator()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  useIndicatorSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    onIndicatorSelect: (indicatorId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.indicatorId === indicatorId) return
      setPairContext(
        resolvedPairColor,
        buildPersistedPairContext({
          existing: pairContext,
          legacyIdKey: 'indicatorId',
          descriptor: null,
          legacyEntityId: indicatorId,
        })
      )
    },
  })

  const storedIndicators = useIndicatorsStore((state) =>
    state.getAllIndicators(workspaceId ?? undefined)
  )

  const listIndicators = indicators.length > 0 ? indicators : storedIndicators

  const selectedIndicatorId = useMemo(() => {
    if (isLinkedToColorPair) {
      return pairContext?.indicatorId ?? null
    }
    return getIndicatorIdFromParams(params)
  }, [isLinkedToColorPair, pairContext?.indicatorId, params])

  const handleSelect = useCallback(
    (indicatorId: string | null) => {
      if (isLinkedToColorPair) {
        if (pairContext?.indicatorId !== indicatorId) {
          setPairContext(
            resolvedPairColor,
            buildPersistedPairContext({
              existing: pairContext,
              legacyIdKey: 'indicatorId',
              descriptor: null,
              legacyEntityId: indicatorId,
            })
          )
        }
        return
      }

      if (onWidgetParamsChange) {
        const currentParams =
          params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
        onWidgetParamsChange({
          ...currentParams,
          indicatorId,
        })
      }

      emitIndicatorSelectionChange({
        indicatorId,
        panelId,
        widgetKey: 'editor_indicator',
      })
    },
    [
      isLinkedToColorPair,
      pairContext?.indicatorId,
      pairContext,
      resolvedPairColor,
      setPairContext,
      onWidgetParamsChange,
      params,
      panelId,
    ]
  )

  const handleDelete = useCallback(
    async (indicatorId: string) => {
      if (!workspaceId || !permissions.canEdit) return
      if (!indicatorId) return

      setDeletingIds((prev) => new Set(prev).add(indicatorId))

      try {
        await deleteMutation.mutateAsync({ workspaceId, indicatorId })
        if (selectedIndicatorId === indicatorId) {
          handleSelect(null)
        }
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev)
          next.delete(indicatorId)
          return next
        })
      }
    },
    [deleteMutation, handleSelect, permissions.canEdit, selectedIndicatorId, workspaceId]
  )

  const handleRename = useCallback(
    async (indicatorId: string, name: string) => {
      if (!workspaceId || !permissions.canEdit) return
      await updateMutation.mutateAsync({
        workspaceId,
        indicatorId,
        updates: { name },
      })
    },
    [permissions.canEdit, updateMutation, workspaceId]
  )

  const handleCopy = useCallback(
    async (indicator: IndicatorDefinition) => {
      if (!workspaceId || !permissions.canEdit) return
      if (!indicator.id) return

      setCopyingIds((prev) => new Set(prev).add(indicator.id))

      try {
        const copiedName = `${indicator.name || 'Untitled indicator'} (Copy)`
        const draftSessionId = crypto.randomUUID()

        writeSeed({
          draftSessionId,
          entityKind: 'indicator',
          payload: {
            name: copiedName,
            color: indicator.color ?? '',
            pineCode: indicator.pineCode ?? '',
            inputMeta:
              indicator.inputMeta && typeof indicator.inputMeta === 'object'
                ? indicator.inputMeta
                : null,
          },
          ownerTabId: getCurrentTabId(),
          createdAt: Date.now(),
        })

        if (isLinkedToColorPair) {
          setPairContext(resolvedPairColor, {
            indicatorId: null,
            reviewTarget: {
              reviewSessionId: null,
              reviewEntityKind: 'indicator',
              reviewEntityId: null,
              reviewDraftSessionId: draftSessionId,
              reviewModel: null,
            },
          })
        } else if (onWidgetParamsChange) {
          const currentParams =
            params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
          onWidgetParamsChange({
            ...currentParams,
            indicatorId: null,
            reviewSessionId: null,
            reviewEntityKind: 'indicator',
            reviewEntityId: null,
            reviewDraftSessionId: draftSessionId,
          })
        }

        emitIndicatorSelectionChange({
          indicatorId: null,
          panelId,
          widgetKey: 'editor_indicator',
          reviewEntityKind: 'indicator',
          reviewDraftSessionId: draftSessionId,
        })
      } finally {
        setCopyingIds((prev) => {
          const next = new Set(prev)
          next.delete(indicator.id)
          return next
        })
      }
    },
    [
      isLinkedToColorPair,
      onWidgetParamsChange,
      panelId,
      params,
      permissions.canEdit,
      resolvedPairColor,
      setPairContext,
      workspaceId,
    ]
  )

  if (isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  const errorMessage =
    error instanceof Error ? error.message : error ? 'Failed to load indicators.' : null

  if (errorMessage) {
    return <IndicatorListMessage message={errorMessage} />
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {listIndicators.length === 0 ? (
        <IndicatorListMessage message='No indicators yet.' />
      ) : (
        <div className='h-full space-y-1 overflow-auto'>
          {listIndicators.map((indicator: IndicatorDefinition) => (
            <IndicatorListItem
              key={indicator.id}
              indicator={indicator}
              isSelected={indicator.id === selectedIndicatorId}
              onSelect={handleSelect}
              onCopy={handleCopy}
              onDelete={handleDelete}
              onRename={handleRename}
              canEdit={permissions.canEdit}
              isCopying={copyingIds.has(indicator.id)}
              isDeleting={deletingIds.has(indicator.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
