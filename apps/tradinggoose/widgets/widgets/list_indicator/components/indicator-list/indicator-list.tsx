'use client'

import { useCallback } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import { type EntityListMember, getEntityFields } from '@/lib/yjs/entity-session'
import { bootstrapYjsProvider } from '@/lib/yjs/provider'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createIndicator, deleteIndicator } from '@/hooks/queries/indicators'
import type { WidgetComponentProps } from '@/widgets/types'
import { usePendingEntitySelection } from '@/widgets/utils/use-pending-entity-selection'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { getIndicatorIdFromParams } from '@/widgets/widgets/editor_indicator/utils'
import { useIndicatorWriteStore } from '@/hooks/queries/indicators'
import { IndicatorListItem } from './components/indicator-list-item'

export const IndicatorListMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

export function IndicatorList({
  channelId,
  panelId,
  context,
  params,
  onWidgetLinkedParamsPatch,
}: WidgetComponentProps) {
  const copy = useMessages().workspace.widgets.indicatorList
  const workspaceId = context?.workspaceId ?? null
  const ownerId = panelId ?? channelId
  const permissions = useUserPermissionsContext()
  const { members, isLoading, error } = useEntityList('indicator', workspaceId)
  const activeWrite = useIndicatorWriteStore((state) => state.activeWrite)
  const failedWrite = useIndicatorWriteStore((state) => state.failedWrite)
  const runWrite = useIndicatorWriteStore((state) => state.runWrite)

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
      if (!workspaceId || !permissions.canEdit || !indicatorId) return false
      return runWrite({ kind: 'delete', workspaceId, ownerId, indicatorId }, async () => {
        await deleteIndicator({ workspaceId, indicatorId })
        if (selectedIndicatorId === indicatorId) handleSelect(null)
      })
    },
    [handleSelect, ownerId, permissions.canEdit, runWrite, selectedIndicatorId, workspaceId]
  )

  const handleRename = useCallback(
    async (indicatorId: string, name: string) => {
      if (!workspaceId || !permissions.canEdit) return false
      return runWrite({ kind: 'rename', workspaceId, ownerId, indicatorId }, async () => {
        await renameSavedEntityAction({
          entityKind: 'indicator',
          entityId: indicatorId,
          workspaceId,
          name,
        })
      })
    },
    [ownerId, permissions.canEdit, runWrite, workspaceId]
  )

  const handleCopy = useCallback(
    async (indicator: EntityListMember) => {
      if (!workspaceId || !permissions.canEdit || !indicator.entityId) return false
      return runWrite(
        { kind: 'copy', workspaceId, ownerId, indicatorId: indicator.entityId },
        async () => {
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
            sourceSession.dispose()
          }

          const createdIndicators = await createIndicator({
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
        }
      )
    },
    [
      copy.listItem.untitledIndicator,
      ownerId,
      selectIndicatorWhenListed,
      permissions.canEdit,
      runWrite,
      workspaceId,
    ]
  )

  const writeMatchesOwner = (write: typeof activeWrite) =>
    write?.workspaceId === workspaceId && write.ownerId === ownerId
  const ownedActiveWrite = writeMatchesOwner(activeWrite) ? activeWrite : null
  const ownedFailedWrite = writeMatchesOwner(failedWrite) ? failedWrite : null
  const content = isLoading ? (
    <div className='flex h-full w-full items-center justify-center'>
      <LoadingAgent size='md' />
    </div>
  ) : error ? (
    <IndicatorListMessage message={error} />
  ) : (
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
              canDelete={members.length > 1}
              writesDisabled={Boolean(activeWrite)}
              isDeleting={
                ownedActiveWrite?.kind === 'delete' &&
                ownedActiveWrite.indicatorId === indicator.entityId
              }
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {ownedActiveWrite ? (
        <div className='px-2 pt-2 text-muted-foreground text-xs' role='status'>
          {copy.body.writePending}
        </div>
      ) : ownedFailedWrite ? (
        <div className='px-2 pt-2 text-destructive text-xs' role='alert'>
          {copy.body.writeFailed}
        </div>
      ) : null}
      <div className='min-h-0 flex-1'>{content}</div>
    </div>
  )
}
