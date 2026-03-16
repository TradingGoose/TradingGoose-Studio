export const WORKFLOW_VARIABLES_ADD_EVENT = 'workflow-variables:add-variable'

export const WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT = 'workflow-widgets:select-workflow'
export const DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT = 'data-chart-widgets:update-params'
export const INDICATOR_WIDGET_SELECT_EVENT = 'indicator-widgets:select-indicator'
export const INDICATOR_EDITOR_ACTION_EVENT = 'indicator-editor:action'
export const WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT = 'watchlist-widgets:update-params'
export const WATCHLIST_WIDGET_ADD_DRAFT_SYMBOL_EVENT = 'watchlist-widgets:add-draft-symbol'

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

export type WatchlistWidgetUpdateEventDetail = {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}

export type WatchlistWidgetAddDraftSymbolEventDetail = {
  panelId?: string
  widgetKey?: string
}

export type IndicatorWidgetSelectEventDetail = {
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
}

export type IndicatorEditorActionEventDetail = {
  action: 'save' | 'verify'
  panelId?: string
  widgetKey?: string
}
