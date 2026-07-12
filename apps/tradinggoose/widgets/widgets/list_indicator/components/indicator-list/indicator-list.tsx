'use client'

import { useCallback, useState } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import { type EntityListMember, getEntityFields } from '@/lib/yjs/entity-session'
import { bootstrapYjsProvider, disposeYjsProvider } from '@/lib/yjs/provider'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCreateIndicator, useDeleteIndicator } from '@/hooks/queries/indicators'
import type { WidgetComponentProps } from '@/widgets/types'
import { usePendingEntitySelection } from '@/widgets/utils/use-pending-entity-selection'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
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
  onWidgetLinkedParamsPatch,
}: WidgetComponentProps) {
  const copy = useMessages().workspace.widgets.indicatorList
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [copyingIds, setCopyingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { members, isLoading, error } = useEntityList('indicator', workspaceId)
  const createMutation = useCreateIndicator()
  const deleteMutation = useDeleteIndicator()

  const requestedIndicatorId = getIndicatorIdFromParams(params)
  const selectedIndicatorId = resolveEntityIdFromList({
    requestedEntityId: requestedIndicatorId,
    entityIds: members.map((member) => member.entityId),
    useDefaultEntity: false,
  })
  const handleSelect = useCallback(
    (indicatorId: string | null) => {
      onWidgetLinkedParamsPatch?.({ indicatorId })
    },
    [onWidgetLinkedParamsPatch]
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
      await renameSavedEntityAction({
        entityKind: 'indicator',
        entityId: indicatorId,
        workspaceId,
        name,
      })
    },
    [permissions.canEdit, workspaceId]
  )

  const handleCopy = useCallback(
    async (indicator: EntityListMember) => {
      if (!workspaceId || !permissions.canEdit) return
      if (!indicator.entityId) return

      setCopyingIds((prev) => new Set(prev).add(indicator.entityId))

      try {
        const copiedName = `${indicator.entityName || copy.listItem.untitledIndicator} (Copy)`
        const sourceSession = await bootstrapYjsProvider(
          buildSavedEntityDescriptor('indicator', indicator.entityId, workspaceId),
          undefined,
          'read'
        )
        let pineCode = ''
        try {
          pineCode = getEntityFields(sourceSession.doc, 'indicator').pineCode ?? ''
        } finally {
          disposeYjsProvider(sourceSession)
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
          next.delete(indicator.entityId)
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
      {members.length === 0 ? (
        <IndicatorListMessage message={copy.body.noIndicatorsYet} />
      ) : (
        <div className='h-full space-y-1 overflow-auto'>
          {members.map((indicator) => (
            <IndicatorListItem
              key={indicator.entityId}
              indicator={indicator}
              isSelected={indicator.entityId === selectedIndicatorId}
              onSelect={handleSelect}
              onCopy={handleCopy}
              onDelete={handleDelete}
              onRename={handleRename}
              canEdit={permissions.canEdit}
              isCopying={copyingIds.has(indicator.entityId)}
              isDeleting={deletingIds.has(indicator.entityId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
