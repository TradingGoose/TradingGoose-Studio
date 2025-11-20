import type {
  DashboardWidgetDefinition,
  WidgetCategoryDefinition,
  WidgetCategoryGroup,
} from '@/widgets/types'
import { emptyWidget } from '@/widgets/widgets/empty'
import { workflowEditorWidget } from '@/widgets/widgets/editor_workflow'
import { chatWidget } from '@/widgets/widgets/workflow_chat'
import { workflowConsoleWidget } from '@/widgets/widgets/workflow_console'
import { workflowCopilotWidget } from '@/widgets/widgets/workflow_copilot'
import { workflowListWidget } from '@/widgets/widgets/workflow_list'

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
  editor_workflow: workflowEditorWidget,
  workflow_chat: chatWidget,
  workflow_console: workflowConsoleWidget,
  workflow_copilot: workflowCopilotWidget,
  workflow_list: workflowListWidget,
}

export const getWidgetDefinition = (key: string): DashboardWidgetDefinition | undefined => widgetRegistry[key]

export const getAllWidgets = (): DashboardWidgetDefinition[] => Object.values(widgetRegistry)

export const getWidgetCategories = (): WidgetCategoryGroup[] => {
  const categoryMap = widgetCategoryConfig.reduce<Record<string, WidgetCategoryGroup>>((acc, category) => {
    acc[category.key] = { ...category, widgets: [] }
    return acc
  }, {})

  for (const widget of Object.values(widgetRegistry)) {
    const category = categoryMap[widget.category]
    if (category) {
      category.widgets.push(widget)
    }
  }

  return widgetCategoryConfig.map((category) => categoryMap[category.key])
}

export const isValidWidgetKey = (key: string): key is keyof typeof widgetRegistry => key in widgetRegistry
