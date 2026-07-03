'use client'

import { useCallback, useMemo, useState } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { getEntityFields } from '@/lib/yjs/entity-session'
import { bootstrapYjsProvider } from '@/lib/yjs/provider'
import { saveSavedEntityField, useEntityList } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCreateIndicator, useDeleteIndicator } from '@/hooks/queries/indicators'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { IndicatorDefinition } from '@/stores/indicators/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  resolveEntityIdFromList,
  usePersistResolvedEntityId,
} from '@/widgets/utils/entity-selection'
import {
  useIndicatorSelectionPersistence,
} from '@/widgets/utils/indicator-selection'
import { usePendingEntitySelection } from '@/widgets/utils/use-pending-entity-selection'
import { getIndicatorIdFromParams } from '@/widgets/widgets/editor_indicator/utils'
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
  const copy = useMessages().workspace.widgets.indicatorList
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [copyingIds, setCopyingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { members, isLoading, error } = useEntityList('indicator', workspaceId)
  const createMutation = useCreateIndicator()
  const deleteMutation = useDeleteIndicator()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  useIndicatorSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    scopeKey: 'list_indicator',
    onIndicatorSelect: (indicatorId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.indicatorId === indicatorId) return
      setPairContext(resolvedPairColor, { indicatorId })
    },
  })

  const listIndicators = useMemo<IndicatorDefinition[]>(
    () =>
      workspaceId
        ? members.map((member) => ({
            id: member.entityId,
            workspaceId,
            userId: null,
            name: member.entityName,
            color: member.color,
            pineCode: '',
          }))
        : [],
    [members, workspaceId]
  )

  const requestedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? null)
    : getIndicatorIdFromParams(params)
  const selectedIndicatorId = resolveEntityIdFromList({
    requestedEntityId: requestedIndicatorId,
    entityIds: listIndicators.map((indicator) => indicator.id),
    useDefaultEntity: !isLinkedToColorPair,
  })

  usePersistResolvedEntityId({
    entityId: selectedIndicatorId,
    entityIdKey: 'indicatorId',
    onWidgetParamsChange,
    pairColor: resolvedPairColor,
    params,
  })

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

  const selectIndicatorWhenListed = usePendingEntitySelection(members, handleSelect)

  const handleDelete = useCallback(
    async (indicatorId: string) => {
      if (!workspaceId || !permissions.canEdit) return
      if (!indicatorId) return

      setDeletingIds((prev) => new Set(prev).add(indicatorId))

      try {
        await deleteMutation.mutateAsync({ workspaceId, indicatorId })
        if (selectedIndicatorId === indicatorId) handleSelect(null)
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
      await saveSavedEntityField('indicator', indicatorId, workspaceId, 'name', name)
    },
    [permissions.canEdit, workspaceId]
  )

  const handleCopy = useCallback(
    async (indicator: IndicatorDefinition) => {
      if (!workspaceId || !permissions.canEdit) return
      if (!indicator.id) return

      setCopyingIds((prev) => new Set(prev).add(indicator.id))

      try {
        const copiedName = `${indicator.name || copy.listItem.untitledIndicator} (Copy)`
        const sourceSession = await bootstrapYjsProvider(
          buildSavedEntityDescriptor('indicator', indicator.id, workspaceId),
          undefined,
          'read'
        )
        let pineCode = ''
        try {
          pineCode = getEntityFields(sourceSession.doc, 'indicator').pineCode ?? ''
        } finally {
          sourceSession.provider.disconnect()
          sourceSession.provider.destroy()
          sourceSession.doc.destroy()
        }

        const createdIndicators = await createMutation.mutateAsync({
          workspaceId,
          indicator: {
            name: copiedName,
            pineCode,
          },
        })
        const copiedIndicatorId =
          createdIndicators[0] && typeof createdIndicators[0].id === 'string'
            ? createdIndicators[0].id
            : null

        if (!copiedIndicatorId) {
          throw new Error('Created indicator copy is missing an id')
        }

        selectIndicatorWhenListed(copiedIndicatorId)
      } finally {
        setCopyingIds((prev) => {
          const next = new Set(prev)
          next.delete(indicator.id)
          return next
        })
      }
    },
    [
      copy.listItem.untitledIndicator,
      createMutation,
      selectIndicatorWhenListed,
      permissions.canEdit,
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

  if (error) {
    return <IndicatorListMessage message={error} />
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {listIndicators.length === 0 ? (
        <IndicatorListMessage message={copy.body.noIndicatorsYet} />
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
