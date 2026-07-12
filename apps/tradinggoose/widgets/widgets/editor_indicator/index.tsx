'use client'

import { SquareFunction } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import {
  IndicatorEditorExportButton,
  IndicatorEditorSaveButton,
  IndicatorEditorSelector,
  IndicatorEditorVerifyButton,
} from '@/widgets/widgets/editor_indicator/components/indicator-editor-header'
import { indicatorEditorWidgetContract } from '@/widgets/widgets/editor_indicator/contract'
import { EditorIndicatorWidgetBody } from '@/widgets/widgets/editor_indicator/editor-indicator-body'
import { getIndicatorIdFromParams } from '@/widgets/widgets/editor_indicator/utils'

export const editorIndicatorWidget: DashboardWidgetDefinition = {
  contract: indicatorEditorWidgetContract,
  icon: SquareFunction,
  component: (props) => <EditorIndicatorWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const params =
      widget?.params && typeof widget.params === 'object'
        ? (widget.params as Record<string, unknown>)
        : null
    const indicatorId = getIndicatorIdFromParams(params)

    return {
      center: (
        <IndicatorEditorSelector workspaceId={context?.workspaceId} indicatorId={indicatorId} />
      ),
      right: (
        <div className='flex items-center gap-1'>
          <IndicatorEditorVerifyButton
            workspaceId={context?.workspaceId}
            indicatorId={indicatorId}
            panelId={panelId}
            widgetKey={widget?.key}
          />
          <IndicatorEditorExportButton
            workspaceId={context?.workspaceId}
            indicatorId={indicatorId}
            panelId={panelId}
            widgetKey={widget?.key}
          />
          <IndicatorEditorSaveButton
            workspaceId={context?.workspaceId}
            indicatorId={indicatorId}
            panelId={panelId}
            widgetKey={widget?.key}
            canEditEntity={context?.canWrite !== false}
          />
        </div>
      ),
    }
  },
}
