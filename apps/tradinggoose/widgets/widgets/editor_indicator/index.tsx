'use client'

import { SquareFunction } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { EditorIndicatorWidgetBody } from '@/widgets/widgets/editor_indicator/editor-indicator-body'
import {
  IndicatorEditorHeaderActions,
  IndicatorEditorSelector,
} from '@/widgets/widgets/editor_indicator/components/indicator-editor-header'
import { getIndicatorIdFromParams } from '@/widgets/widgets/editor_indicator/utils'

export const editorIndicatorWidget: DashboardWidgetDefinition = {
  key: 'editor_indicator',
  title: 'Indicator Editor',
  icon: SquareFunction,
  category: 'editor',
  description: 'Edit PineTS indicators in one workspace.',
  component: (props) => <EditorIndicatorWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const params =
      widget?.params && typeof widget.params === 'object'
        ? (widget.params as Record<string, unknown>)
        : null
    const indicatorId = getIndicatorIdFromParams(
      params
    )

    return {
      center: (
        <IndicatorEditorSelector
          workspaceId={context?.workspaceId}
          panelId={panelId}
          indicatorId={indicatorId}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
          params={params}
        />
      ),
      right: (
        <IndicatorEditorHeaderActions
          workspaceId={context?.workspaceId}
          indicatorId={indicatorId}
          panelId={panelId}
          widgetKey={widget?.key}
          pairColor={widget?.pairColor}
          params={params}
        />
      ),
    }
  },
}
