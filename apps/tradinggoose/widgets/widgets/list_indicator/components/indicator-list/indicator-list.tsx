'use client'

import { useCallback, useMemo, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import {
  useCustomIndicators,
  useDeleteCustomIndicator,
  useUpdateCustomIndicator,
} from '@/hooks/queries/custom-indicators'
import { useCustomIndicatorsStore } from '@/stores/custom-indicators/store'
import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitIndicatorSelectionChange,
  useIndicatorSelectionPersistence,
} from '@/widgets/utils/indicator-selection'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
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
  widget,
  panelId,
  pairColor = 'gray',
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { data: indicators = [], isLoading, error } = useCustomIndicators(workspaceId ?? '')
  const deleteMutation = useDeleteCustomIndicator()
  const updateMutation = useUpdateCustomIndicator()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  useIndicatorSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    params,
    pairColor: resolvedPairColor,
    onIndicatorSelect: (indicatorId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.indicatorId === indicatorId) return
      setPairContext(resolvedPairColor, { indicatorId })
    },
  })

  const storedIndicators = useCustomIndicatorsStore((state) =>
    state.getAllIndicators(workspaceId ?? undefined)
  )

  const listIndicators = indicators.length > 0 ? indicators : storedIndicators

  const selectedIndicatorId = useMemo(() => {
    if (isLinkedToColorPair) {
      return pairContext?.indicatorId ?? null
    }
    if (!params || typeof params !== 'object') return null
    const value = (params as Record<string, unknown>).indicatorId
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }, [isLinkedToColorPair, pairContext?.indicatorId, params])

  const handleSelect = useCallback(
    (indicatorId: string | null) => {
      if (isLinkedToColorPair) {
        if (pairContext?.indicatorId !== indicatorId) {
          setPairContext(resolvedPairColor, { indicatorId })
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
      })
    },
    [
      isLinkedToColorPair,
      pairContext?.indicatorId,
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
    return <IndicatorListMessage message={errorMessage} />
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {listIndicators.length === 0 ? (
        <IndicatorListMessage message='No indicators yet.' />
      ) : (
        <div className='h-full space-y-1 overflow-auto'>
          {listIndicators.map((indicator: CustomIndicatorDefinition) => (
            <IndicatorListItem
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
