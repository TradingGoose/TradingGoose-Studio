'use client'

import { useCallback } from 'react'
import { ListChecks } from 'lucide-react'
import { getRandomVibrantColor } from '@/lib/colors'
import { useCreateNewIndicator } from '@/hooks/queries/new-indicators'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitNewIndicatorSelectionChange } from '@/widgets/utils/new-indicator-selection'
import { IndicatorCreateMenu } from '@/widgets/widgets/list_indicator_new/components/indicator-create-menu'
import {
  NewIndicatorList,
  NewIndicatorListMessage,
} from '@/widgets/widgets/list_indicator_new/components/indicator-list/indicator-list'
import {
  WorkspacePermissionsProvider,
  useUserPermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

const DEFAULT_NEW_INDICATOR = {
  name: 'New Indicator',
  pineCode: '',
}

const IndicatorListHeaderRight = ({
  workspaceId,
  panelId,
}: {
  workspaceId?: string | null
  panelId?: string
}) => {
  const createMutation = useCreateNewIndicator()
  const permissions = useUserPermissionsContext()

  const handleCreateIndicator = useCallback(async () => {
    if (!workspaceId || createMutation.isPending || !permissions.canEdit) return

    try {
      const response = await createMutation.mutateAsync({
        workspaceId,
        indicator: {
          ...DEFAULT_NEW_INDICATOR,
          color: getRandomVibrantColor(),
        },
      })
      const created = Array.isArray(response) ? response[0] : null
      if (!created?.id) return

      emitNewIndicatorSelectionChange({
        indicatorId: created.id,
        panelId,
        widgetKey: 'new_editor_indicator',
      })
    } catch (error) {
      console.error('Failed to create indicator', error)
    }
  }, [createMutation, panelId, permissions.canEdit, workspaceId])

  return (
    <IndicatorCreateMenu
      disabled={!workspaceId || createMutation.isPending || !permissions.canEdit}
      onCreateIndicator={handleCreateIndicator}
    />
  )
}

const ListIndicatorHeaderRight = ({
  workspaceId,
  panelId,
}: {
  workspaceId?: string | null
  panelId?: string
}) => {
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>Explorer</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <div className='flex items-center gap-2'>
        <IndicatorListHeaderRight workspaceId={workspaceId} panelId={panelId} />
      </div>
    </WorkspacePermissionsProvider>
  )
}

const ListIndicatorWidgetBody = (props: WidgetComponentProps) => {
  const workspaceId = props.context?.workspaceId ?? null
  if (!workspaceId) {
    return <NewIndicatorListMessage message='Select a workspace to browse its indicators.' />
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <NewIndicatorList {...props} />
    </WorkspacePermissionsProvider>
  )
}

export const listIndicatorNewWidget: DashboardWidgetDefinition = {
  key: 'list_indicator_new',
  title: 'Pine Indicator List',
  icon: ListChecks,
  category: 'list',
  description: 'Browse and manage PineTS indicators for the workspace.',
  component: (props) => <ListIndicatorWidgetBody {...props} />,
  renderHeader: ({ context, panelId }) => {
    return {
      right: <ListIndicatorHeaderRight workspaceId={context?.workspaceId} panelId={panelId} />,
    }
  },
}
