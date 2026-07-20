export const WORKFLOW_VARIABLES_ADD_EVENT = 'workflow-variables:add-variable'

export const INDICATOR_EDITOR_ACTION_EVENT = 'indicator-editor:action'
export const CUSTOM_TOOL_EDITOR_ACTION_EVENT = 'custom-tool-editor:action'
export const SKILL_EDITOR_ACTION_EVENT = 'skill-editor:action'
export const MCP_EDITOR_ACTION_EVENT = 'mcp-editor:action'

export type IndicatorEditorActionEventDetail = {
  action: 'export' | 'save' | 'verify'
  entityId: string
  panelId?: string
  widgetKey?: string
}

export type CustomToolEditorActionEventDetail = {
  action: 'export' | 'save' | 'set-section'
  entityId: string
  section?: 'schema' | 'code'
  panelId?: string
  widgetKey?: string
}

export type SkillEditorActionEventDetail = {
  action: 'export' | 'save'
  entityId: string
  panelId?: string
  widgetKey?: string
}

export type McpEditorActionEventDetail = {
  action: 'save' | 'refresh' | 'close' | 'reset' | 'test'
  panelId?: string
  widgetKey?: string
}
