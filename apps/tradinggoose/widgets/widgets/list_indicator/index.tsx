'use client'

import { useCallback } from 'react'
import { ListChecks } from 'lucide-react'
import { getRandomVibrantColor } from '@/lib/colors'
import { useCreateIndicator } from '@/hooks/queries/indicators'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitIndicatorSelectionChange } from '@/widgets/utils/indicator-selection'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { IndicatorCreateMenu } from '@/widgets/widgets/list_indicator/components/indicator-create-menu'
import {
  IndicatorList,
  IndicatorListMessage,
} from '@/widgets/widgets/list_indicator/components/indicator-list/indicator-list'
import {
  WorkspacePermissionsProvider,
  useUserPermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

const DEFAULT_INDICATOR = {
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
  const createMutation = useCreateIndicator()
  const permissions = useUserPermissionsContext()

  const handleCreateIndicator = useCallback(async () => {
    if (!workspaceId || createMutation.isPending || !permissions.canEdit) return

    try {
      const response = await createMutation.mutateAsync({
        workspaceId,
        indicator: {
          ...DEFAULT_INDICATOR,
          color: getRandomVibrantColor(),
        },
      })
      const created = Array.isArray(response) ? response[0] : null
      if (!created?.id) return

      emitIndicatorSelectionChange({
        indicatorId: created.id,
        panelId,
        widgetKey: 'editor_indicator',
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
      <div className={widgetHeaderButtonGroupClassName()}>
        <IndicatorListHeaderRight workspaceId={workspaceId} panelId={panelId} />
      </div>
    </WorkspacePermissionsProvider>
  )
}

const ListIndicatorWidgetBody = (props: WidgetComponentProps) => {
  const workspaceId = props.context?.workspaceId ?? null
  if (!workspaceId) {
    return <IndicatorListMessage message='Select a workspace to browse its indicators.' />
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <IndicatorList {...props} />
    </WorkspacePermissionsProvider>
  )
}

export const listIndicatorWidget: DashboardWidgetDefinition = {
  key: 'list_indicator',
  title: 'Indicator List',
  icon: ListChecks,
  category: 'list',
  description: 'Browse and manage custom indicators for the workspace.',
  component: (props) => <ListIndicatorWidgetBody {...props} />,
  renderHeader: ({ context, panelId }) => {
    return {
      right: <ListIndicatorHeaderRight workspaceId={context?.workspaceId} panelId={panelId} />,
    }
  },
}
