'use client'

import { SquareFunction } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { EditorIndicatorWidgetBody } from '@/widgets/widgets/editor_indicator/editor-indicator-body'
import {
  IndicatorEditorSaveButton,
  IndicatorEditorSelector,
  IndicatorEditorVerifyButton,
} from '@/widgets/widgets/editor_indicator/components/indicator-editor-header'
import { getIndicatorIdFromParams } from '@/widgets/widgets/editor_indicator/utils'

export const editorIndicatorWidget: DashboardWidgetDefinition = {
  key: 'editor_indicator',
  title: 'Indicator Editor',
  icon: SquareFunction,
  category: 'editor',
  description: 'Edit custom indicator scripts in one workspace.',
  component: (props) => <EditorIndicatorWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const indicatorId = getIndicatorIdFromParams(
      widget?.params && typeof widget.params === 'object'
        ? (widget.params as Record<string, unknown>)
        : null
    )

    return {
      center: (
        <IndicatorEditorSelector
          workspaceId={context?.workspaceId}
          panelId={panelId}
          indicatorId={indicatorId}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
        />
      ),
      right: (
        <div className='flex items-center gap-2'>
          <IndicatorEditorVerifyButton
            workspaceId={context?.workspaceId}
            indicatorId={indicatorId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
          />
          <IndicatorEditorSaveButton
            workspaceId={context?.workspaceId}
            indicatorId={indicatorId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
          />
        </div>
      ),
    }
  },
}
