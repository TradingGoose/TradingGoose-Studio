'use client'

import { useCallback } from 'react'
import { ListChecks } from 'lucide-react'
import { parseImportedIndicatorsFile } from '@/lib/indicators/import-export'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCreateIndicator, useImportIndicators } from '@/hooks/queries/indicators'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useIndicatorsStore } from '@/stores/indicators/store'
import type { IndicatorDefinition } from '@/stores/indicators/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitIndicatorSelectionChange } from '@/widgets/utils/indicator-selection'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { buildPersistedPairContext } from '@/widgets/widgets/editor_indicator/utils'
import { IndicatorCreateMenu } from '@/widgets/widgets/list_indicator/components/indicator-create-menu'
import {
  IndicatorList,
  IndicatorListMessage,
} from '@/widgets/widgets/list_indicator/components/indicator-list/indicator-list'

const DEFAULT_INDICATOR_NAME = 'New indicator'

const buildNewIndicator = (indicators: IndicatorDefinition[]) => {
  const existingNames = new Set(
    indicators.map((indicator) => indicator.name.trim()).filter((name) => name.length > 0)
  )

  let nextName = DEFAULT_INDICATOR_NAME
  let suffix = 2

  while (existingNames.has(nextName)) {
    nextName = `${DEFAULT_INDICATOR_NAME} ${suffix}`
    suffix += 1
  }

  return {
    name: nextName,
    color: '',
    pineCode: '',
    inputMeta: undefined,
  }
}

const IndicatorListHeaderRight = ({
  workspaceId,
  panelId,
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) => {
  const permissions = useUserPermissionsContext()
  const createIndicatorMutation = useCreateIndicator()
  const importMutation = useImportIndicators()
  const storedIndicators = useIndicatorsStore((state) =>
    workspaceId ? state.getAllIndicators(workspaceId) : []
  )
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const handleCreateIndicator = useCallback(() => {
    if (!workspaceId || !permissions.canEdit) return

    void createIndicatorMutation
      .mutateAsync({
        workspaceId,
        indicator: buildNewIndicator(storedIndicators),
      })
      .then((createdIndicators) => {
        const createdIndicator = createdIndicators[0]
        const createdIndicatorId =
          createdIndicator && typeof createdIndicator.id === 'string' ? createdIndicator.id : null

        if (!createdIndicatorId) {
          throw new Error('Created indicator is missing an id')
        }

        if (isLinkedToColorPair) {
          setPairContext(
            resolvedPairColor,
            buildPersistedPairContext({
              existing: pairContext,
              legacyIdKey: 'indicatorId',
              descriptor: null,
              legacyEntityId: createdIndicatorId,
            })
          )
          return
        }

        emitIndicatorSelectionChange({
          indicatorId: createdIndicatorId,
          panelId,
          widgetKey: 'list_indicator',
        })
        emitIndicatorSelectionChange({
          indicatorId: createdIndicatorId,
          panelId,
          widgetKey: 'editor_indicator',
        })
      })
      .catch((error) => {
        console.error('Failed to create indicator from list widget', error)
      })
  }, [
    createIndicatorMutation,
    isLinkedToColorPair,
    pairContext,
    panelId,
    permissions.canEdit,
    resolvedPairColor,
    setPairContext,
    storedIndicators,
    workspaceId,
  ])

  const handleImportIndicator = useCallback(
    async (content: string) => {
      if (!workspaceId || importMutation.isPending || !permissions.canEdit) return

      try {
        const parsedFile = parseImportedIndicatorsFile(JSON.parse(content) as unknown)
        await importMutation.mutateAsync({
          workspaceId,
          file: parsedFile,
        })
      } catch (error) {
        console.error('Failed to import indicator', error)
      }
    },
    [importMutation, permissions.canEdit, workspaceId]
  )

  return (
    <IndicatorCreateMenu
      disabled={!workspaceId || !permissions.canEdit || createIndicatorMutation.isPending}
      canCreate={!createIndicatorMutation.isPending && permissions.canEdit}
      canImport={Boolean(workspaceId && permissions.canEdit)}
      isImporting={importMutation.isPending}
      onCreateIndicator={handleCreateIndicator}
      onImportIndicator={handleImportIndicator}
    />
  )
}

const ListIndicatorHeaderRight = ({
  workspaceId,
  panelId,
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) => {
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>Explorer</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <div className={widgetHeaderButtonGroupClassName()}>
        <IndicatorListHeaderRight
          workspaceId={workspaceId}
          panelId={panelId}
          pairColor={pairColor}
        />
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
  renderHeader: ({ widget, context, panelId }) => {
    return {
      right: (
        <ListIndicatorHeaderRight
          workspaceId={context?.workspaceId}
          panelId={panelId}
          pairColor={widget?.pairColor}
        />
      ),
    }
  },
}
