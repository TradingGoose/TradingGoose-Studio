'use client'

import { SquareFunction } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { NewEditorIndicatorWidgetBody } from '@/widgets/widgets/new_editor_indicator/editor-indicator-body'
import {
  PineIndicatorEditorSaveButton,
  PineIndicatorEditorSelector,
  PineIndicatorEditorVerifyButton,
} from '@/widgets/widgets/new_editor_indicator/components/indicator-editor-header'
import { getPineIndicatorIdFromParams } from '@/widgets/widgets/new_editor_indicator/utils'

export const newEditorIndicatorWidget: DashboardWidgetDefinition = {
  key: 'new_editor_indicator',
  title: 'Pine Indicator Editor',
  icon: SquareFunction,
  category: 'editor',
  description: 'Edit PineTS indicators in one workspace.',
  component: (props) => <NewEditorIndicatorWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const indicatorId = getPineIndicatorIdFromParams(
      widget?.params && typeof widget.params === 'object'
        ? (widget.params as Record<string, unknown>)
        : null
    )

    return {
      center: (
        <PineIndicatorEditorSelector
          workspaceId={context?.workspaceId}
          panelId={panelId}
          indicatorId={indicatorId}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
        />
      ),
      right: (
        <div className='flex items-center gap-2'>
          <PineIndicatorEditorVerifyButton
            workspaceId={context?.workspaceId}
            indicatorId={indicatorId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
          />
          <PineIndicatorEditorSaveButton
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

