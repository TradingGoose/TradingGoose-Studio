export const WORKFLOW_VARIABLES_ADD_EVENT = 'workflow-variables:add-variable'

export const WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT = 'workflow-widgets:select-workflow'

export type WorkflowWidgetSelectEventDetail = {
  workflowId: string
  panelId?: string
  widgetKey?: string
}
