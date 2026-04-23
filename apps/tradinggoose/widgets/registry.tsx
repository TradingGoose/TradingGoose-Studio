import type {
  DashboardWidgetDefinition,
  WidgetCategoryDefinition,
  WidgetCategoryGroup,
} from '@/widgets/types'
import { copilotWidget } from '@/widgets/widgets/copilot'
import { dataChartWidget } from '@/widgets/widgets/data_chart'
import { editorCustomToolWidget } from '@/widgets/widgets/editor_custom_tool/index'
import { editorIndicatorWidget } from '@/widgets/widgets/editor_indicator'
import { editorMcpWidget } from '@/widgets/widgets/editor_mcp'
import { editorSkillWidget } from '@/widgets/widgets/editor_skill'
import { workflowEditorWidget } from '@/widgets/widgets/editor_workflow'
import { emptyWidget } from '@/widgets/widgets/empty'
import { listCustomToolWidget } from '@/widgets/widgets/list_custom_tool'
import { listIndicatorWidget } from '@/widgets/widgets/list_indicator'
import { listMcpWidget } from '@/widgets/widgets/list_mcp'
import { listSkillWidget } from '@/widgets/widgets/list_skill'
import { workflowListWidget } from '@/widgets/widgets/list_workflow'
import { portfolioSnapshotWidget } from '@/widgets/widgets/portfolio_snapshot'
import { watchlistWidget } from '@/widgets/widgets/watchlist'
import { chatWidget } from '@/widgets/widgets/workflow_chat'
import { workflowConsoleWidget } from '@/widgets/widgets/workflow_console'
import { workflowVariablesWidget } from '@/widgets/widgets/workflow_variables'

const widgetCategoryConfig: WidgetCategoryDefinition[] = [
  {
    key: 'list',
    title: 'Lists',
  },
  {
    key: 'editor',
    title: 'Editor',
  },
  {
    key: 'utility',
    title: 'Utility',
  },
]

const widgetRegistry: Record<string, DashboardWidgetDefinition> = {
  empty: emptyWidget,
  data_chart: dataChartWidget,
  workflow_list: workflowListWidget,
  editor_workflow: workflowEditorWidget,
  workflow_chat: chatWidget,
  workflow_console: workflowConsoleWidget,
  copilot: copilotWidget,
  list_indicator: listIndicatorWidget,
  list_mcp: listMcpWidget,
  editor_indicator: editorIndicatorWidget,
  editor_mcp: editorMcpWidget,
  list_custom_tool: listCustomToolWidget,
  editor_custom_tool: editorCustomToolWidget,
  list_skill: listSkillWidget,
  editor_skill: editorSkillWidget,
  workflow_variables: workflowVariablesWidget,
  watchlist: watchlistWidget,
  portfolio_snapshot: portfolioSnapshotWidget,
}

export const getWidgetDefinition = (key: string): DashboardWidgetDefinition | undefined =>
  widgetRegistry[key]

export const getAllWidgets = (): DashboardWidgetDefinition[] => Object.values(widgetRegistry)

export const getWidgetCategories = (): WidgetCategoryGroup[] => {
  const categoryMap = widgetCategoryConfig.reduce<Record<string, WidgetCategoryGroup>>(
    (acc, category) => {
      acc[category.key] = { ...category, widgets: [] }
      return acc
    },
    {}
  )

  for (const widget of Object.values(widgetRegistry)) {
    const category = categoryMap[widget.category]
    if (category) {
      category.widgets.push(widget)
    }
  }

  return widgetCategoryConfig.map((category) => categoryMap[category.key])
}

export const isValidWidgetKey = (key: string): key is keyof typeof widgetRegistry =>
  key in widgetRegistry
