export const WORKFLOW_VARIABLES_ADD_EVENT = 'workflow-variables:add-variable'

export const WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT = 'workflow-widgets:select-workflow'
export const DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT = 'data-chart-widgets:update-params'
export const INDICATOR_WIDGET_SELECT_EVENT = 'indicator-widgets:select-indicator'
export const INDICATOR_EDITOR_ACTION_EVENT = 'indicator-editor:action'

export type WorkflowWidgetSelectEventDetail = {
  workflowId: string
  panelId?: string
  widgetKey?: string
}

export type DataChartWidgetUpdateEventDetail = {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}

export type IndicatorWidgetSelectEventDetail = {
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
}

export type IndicatorEditorActionEventDetail = {
  action: 'save' | 'set-tab'
  tab?: 'info' | 'code'
  panelId?: string
  widgetKey?: string
}
