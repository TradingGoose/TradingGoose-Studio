'use client'

import { useCallback } from 'react'
import { ListChecks } from 'lucide-react'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useLocale } from 'next-intl'
import { parseImportedIndicatorsFile } from '@/lib/indicators/import-export'
import {
  useUserPermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCreateIndicator, useImportIndicators } from '@/hooks/queries/indicators'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useIndicatorsStore } from '@/stores/indicators/store'
import type { IndicatorDefinition } from '@/stores/indicators/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitIndicatorSelectionChange } from '@/widgets/utils/indicator-selection'
import { useMessages } from 'next-intl'
import { IndicatorCreateMenu } from '@/widgets/widgets/list_indicator/components/indicator-create-menu'
import {
  IndicatorList,
  IndicatorListMessage,
} from '@/widgets/widgets/list_indicator/components/indicator-list/indicator-list'

const buildNewIndicator = (
  indicators: IndicatorDefinition[],
  defaults: { name: string }
) => {
  const existingNames = new Set(
    indicators.map((indicator) => indicator.name.trim()).filter((name) => name.length > 0)
  )

  let nextName = defaults.name
  let suffix = 2

  while (existingNames.has(nextName)) {
    nextName = `${defaults.name} ${suffix}`
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
  const locale = useLocale()
  const copy = useMessages().workspace.widgets
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
        indicator: buildNewIndicator(storedIndicators, {
          name: copy.indicatorList.createMenu.newIndicator,
        }),
      })
      .then((createdIndicators) => {
        const createdIndicator = createdIndicators[0]
        const createdIndicatorId =
          createdIndicator && typeof createdIndicator.id === 'string' ? createdIndicator.id : null

        if (!createdIndicatorId) {
          throw new Error('Created indicator is missing an id')
        }

        if (isLinkedToColorPair) {
          setPairContext(resolvedPairColor, { indicatorId: createdIndicatorId })
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
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.indicatorList
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <IndicatorListHeaderRight workspaceId={workspaceId} panelId={panelId} pairColor={pairColor} />
    </div>
  )
}

const ListIndicatorWidgetBody = (props: WidgetComponentProps) => {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.indicatorList
  const workspaceId = props.context?.workspaceId ?? null
  if (!workspaceId) {
    return <IndicatorListMessage message={copy.body.selectWorkspace} />
  }

  return <IndicatorList {...props} />
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
