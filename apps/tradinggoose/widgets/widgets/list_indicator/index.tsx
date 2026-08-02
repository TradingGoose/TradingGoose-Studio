'use client'

import { useCallback } from 'react'
import { ListChecks } from 'lucide-react'
import { useMessages } from 'next-intl'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { parseImportedIndicatorsFile } from '@/lib/indicators/import-export'
import { generateAvailableName } from '@/lib/naming'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createIndicator, importIndicators } from '@/hooks/queries/indicators'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { usePendingEntitySelection } from '@/widgets/utils/use-pending-entity-selection'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { IndicatorCreateMenu } from '@/widgets/widgets/list_indicator/components/indicator-create-menu'
import {
  IndicatorList,
  IndicatorListMessage,
} from '@/widgets/widgets/list_indicator/components/indicator-list/indicator-list'
import { indicatorListWidgetContract } from '@/widgets/widgets/list_indicator/contract'
import { useIndicatorWriteStore } from '@/hooks/queries/indicators'

const buildNewIndicator = (defaults: { name: string }) => {
  return {
    name: defaults.name,
    pineCode: '',
  }
}

const IndicatorListHeaderRight = ({
  workspaceId,
  ownerId,
}: {
  workspaceId: string
  ownerId: string
}) => {
  const copy = useMessages().workspace.widgets
  const permissions = useUserPermissionsContext()
  const activeWrite = useIndicatorWriteStore((state) => state.activeWrite)
  const runWrite = useIndicatorWriteStore((state) => state.runWrite)
  const actions = useWidgetConfigRuntimeActions()
  const { members } = useEntityList('indicator', workspaceId)

  const selectIndicator = useCallback(
    (createdIndicatorId: string) => {
      actions.patchWidgetLinkedParams?.({ indicatorId: createdIndicatorId })
    },
    [actions]
  )
  const selectIndicatorWhenListed = usePendingEntitySelection(members, selectIndicator)

  const handleCreateIndicator = useCallback(() => {
    if (!permissions.canEdit) return
    const indicator = buildNewIndicator({
      name: generateAvailableName(
        members.map((member) => member.entityName),
        copy.indicatorList.createMenu.newIndicator
      ),
    })
    void runWrite({ kind: 'create', workspaceId, ownerId }, async () => {
      const createdIndicators = await createIndicator({ workspaceId, indicator })
      const createdIndicator = createdIndicators[0]
      const createdIndicatorId =
        createdIndicator && typeof createdIndicator.id === 'string' ? createdIndicator.id : null

      if (!createdIndicatorId) throw new Error('Created indicator is missing an id')
      selectIndicatorWhenListed(createdIndicatorId)
    })
  }, [
    copy.indicatorList.createMenu.newIndicator,
    members,
    ownerId,
    permissions.canEdit,
    runWrite,
    selectIndicatorWhenListed,
    workspaceId,
  ])

  const handleImportIndicator = useCallback(
    async (file: File) => {
      if (!permissions.canEdit) return
      await runWrite({ kind: 'import', workspaceId, ownerId }, async () => {
        const content = await file.text()
        const parsedFile = parseImportedIndicatorsFile(JSON.parse(content) as unknown)
        await importIndicators({ workspaceId, file: parsedFile })
      })
    },
    [ownerId, permissions.canEdit, runWrite, workspaceId]
  )

  return (
    <IndicatorCreateMenu
      disabled={!permissions.canEdit || Boolean(activeWrite)}
      onCreateIndicator={handleCreateIndicator}
      onImportIndicator={handleImportIndicator}
    />
  )
}

const ListIndicatorHeaderRight = ({
  workspaceId,
  ownerId,
}: {
  workspaceId?: string | null
  ownerId: string
}) => {
  const copy = useMessages().workspace.widgets.indicatorList
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <div className={widgetHeaderButtonGroupClassName()}>
        <IndicatorListHeaderRight workspaceId={workspaceId} ownerId={ownerId} />
      </div>
    </WorkspacePermissionsProvider>
  )
}

const ListIndicatorWidgetBody = (props: WidgetComponentProps) => {
  const copy = useMessages().workspace.widgets.indicatorList
  const workspaceId = props.context?.workspaceId ?? null
  if (!workspaceId) {
    return <IndicatorListMessage message={copy.body.selectWorkspace} />
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <IndicatorList {...props} />
    </WorkspacePermissionsProvider>
  )
}

export const listIndicatorWidget: DashboardWidgetDefinition = {
  contract: indicatorListWidgetContract,
  icon: ListChecks,
  component: (props) => <ListIndicatorWidgetBody {...props} />,
  renderHeader: ({ context, panelId, channelId }) => {
    return {
      right: (
        <ListIndicatorHeaderRight
          workspaceId={context?.workspaceId}
          ownerId={panelId ?? channelId}
        />
      ),
    }
  },
}
