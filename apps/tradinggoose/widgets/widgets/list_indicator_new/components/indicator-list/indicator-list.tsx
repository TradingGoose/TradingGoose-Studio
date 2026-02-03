'use client'

import { useCallback, useMemo, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useDeleteNewIndicator,
  useNewIndicators,
  useUpdateNewIndicator,
} from '@/hooks/queries/new-indicators'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useNewIndicatorsStore } from '@/stores/new-indicators/store'
import type { NewIndicatorDefinition } from '@/stores/new-indicators/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitNewIndicatorSelectionChange,
  useNewIndicatorSelectionPersistence,
} from '@/widgets/utils/new-indicator-selection'
import { NewIndicatorListItem } from './components/indicator-list-item'

export const NewIndicatorListMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

export function NewIndicatorList({
  context,
  params,
  onWidgetParamsChange,
  panelId,
  pairColor = 'gray',
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { data: indicators = [], isLoading, error } = useNewIndicators(workspaceId ?? '')
  const deleteMutation = useDeleteNewIndicator()
  const updateMutation = useUpdateNewIndicator()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  useNewIndicatorSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    onIndicatorSelect: (indicatorId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.pineIndicatorId === indicatorId) return
      setPairContext(resolvedPairColor, { pineIndicatorId: indicatorId })
    },
  })

  const storedIndicators = useNewIndicatorsStore((state) =>
    state.getAllIndicators(workspaceId ?? undefined)
  )

  const listIndicators = indicators.length > 0 ? indicators : storedIndicators

  const selectedIndicatorId = useMemo(() => {
    if (isLinkedToColorPair) {
      return pairContext?.pineIndicatorId ?? null
    }
    if (!params || typeof params !== 'object') return null
    const value = (params as Record<string, unknown>).pineIndicatorId
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }, [isLinkedToColorPair, pairContext?.pineIndicatorId, params])

  const handleSelect = useCallback(
    (indicatorId: string | null) => {
      if (isLinkedToColorPair) {
        if (pairContext?.pineIndicatorId !== indicatorId) {
          setPairContext(resolvedPairColor, { pineIndicatorId: indicatorId })
        }
        return
      }

      if (onWidgetParamsChange) {
        const currentParams =
          params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
        onWidgetParamsChange({
          ...currentParams,
          pineIndicatorId: indicatorId,
        })
      }

      emitNewIndicatorSelectionChange({
        indicatorId,
        panelId,
        widgetKey: 'new_editor_indicator',
      })
    },
    [
      isLinkedToColorPair,
      pairContext?.pineIndicatorId,
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
    return <NewIndicatorListMessage message={errorMessage} />
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {listIndicators.length === 0 ? (
        <NewIndicatorListMessage message='No indicators yet.' />
      ) : (
        <div className='h-full space-y-1 overflow-auto'>
          {listIndicators.map((indicator: NewIndicatorDefinition) => (
            <NewIndicatorListItem
              key={indicator.id}
              indicator={indicator}
              isSelected={indicator.id === selectedIndicatorId}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onRename={handleRename}
              canEdit={permissions.canEdit}
              isDeleting={deletingIds.has(indicator.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
