export const WORKFLOW_VARIABLES_ADD_EVENT = 'workflow-variables:add-variable'

export const WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT = 'workflow-widgets:select-workflow'
export const DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT = 'data-chart-widgets:update-params'
export const INDICATOR_WIDGET_SELECT_EVENT = 'indicator-widgets:select-indicator'
export const INDICATOR_EDITOR_ACTION_EVENT = 'indicator-editor:action'
export const CUSTOM_TOOL_WIDGET_SELECT_EVENT = 'custom-tool-widgets:select-tool'
export const CUSTOM_TOOL_EDITOR_ACTION_EVENT = 'custom-tool-editor:action'
export const SKILL_WIDGET_SELECT_EVENT = 'skill-widgets:select-skill'
export const SKILL_EDITOR_ACTION_EVENT = 'skill-editor:action'
export const MCP_WIDGET_SELECT_SERVER_EVENT = 'mcp-widgets:select-server'
export const MCP_EDITOR_ACTION_EVENT = 'mcp-editor:action'
export const WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT = 'watchlist-widgets:update-params'

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

export type CustomToolWidgetSelectEventDetail = {
  customToolId?: string | null
  panelId?: string
  widgetKey?: string
}

export type CustomToolEditorActionEventDetail = {
  action: 'save' | 'set-section'
  section?: 'schema' | 'code'
  panelId?: string
  widgetKey?: string
}

export type SkillWidgetSelectEventDetail = {
  skillId?: string | null
  panelId?: string
  widgetKey?: string
}

export type SkillEditorActionEventDetail = {
  action: 'save'
  panelId?: string
  widgetKey?: string
}

export type McpWidgetSelectEventDetail = {
  serverId?: string | null
  panelId?: string
  widgetKey?: string
}

export type McpEditorActionEventDetail = {
  action: 'save' | 'refresh' | 'close' | 'reset' | 'test'
  panelId?: string
  widgetKey?: string
}
