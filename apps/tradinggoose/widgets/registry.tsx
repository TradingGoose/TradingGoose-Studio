import type { Messages } from 'next-intl'
import type {
  DashboardWidgetCatalogDefinition,
  DashboardWidgetDefinition,
  DashboardWidgetRegistryDefinition,
  WidgetCategoryDefinition,
  WidgetCategoryGroup,
} from '@/widgets/types'
import { isWidgetKey, type WidgetKey } from '@/widgets/widget-contracts'
import { copilotWidget } from '@/widgets/widgets/copilot'

type WorkspaceWidgetsMessages = Messages['workspace']['widgets']

import { dataChartWidget } from '@/widgets/widgets/data_chart'
import { editorCustomToolWidget } from '@/widgets/widgets/editor_custom_tool/index'
import { editorIndicatorWidget } from '@/widgets/widgets/editor_indicator'
import { editorMcpWidget } from '@/widgets/widgets/editor_mcp'
import { editorSkillWidget } from '@/widgets/widgets/editor_skill'
import { workflowEditorWidget } from '@/widgets/widgets/editor_workflow'
import { emptyWidget } from '@/widgets/widgets/empty'
import { heatmapWidget } from '@/widgets/widgets/heatmap'
import { listCustomToolWidget } from '@/widgets/widgets/list_custom_tool'
import { listIndicatorWidget } from '@/widgets/widgets/list_indicator'
import { listMcpWidget } from '@/widgets/widgets/list_mcp'
import { listSkillWidget } from '@/widgets/widgets/list_skill'
import { workflowListWidget } from '@/widgets/widgets/list_workflow'
import { portfolioSnapshotWidget } from '@/widgets/widgets/portfolio_snapshot'
import { quickOrderWidget } from '@/widgets/widgets/quick_order'
import { watchlistWidget } from '@/widgets/widgets/watchlist'
import { chatWidget } from '@/widgets/widgets/workflow_chat'
import { workflowConsoleWidget } from '@/widgets/widgets/workflow_console'
import { workflowVariablesWidget } from '@/widgets/widgets/workflow_variables'

const widgetCategoryConfig: WidgetCategoryDefinition[] = [
  { key: 'trading', title: 'Trading' },
  { key: 'list', title: 'Lists' },
  { key: 'editor', title: 'Editor' },
  { key: 'utility', title: 'Utils' },
]

const widgetRegistry: Record<string, DashboardWidgetRegistryDefinition> = {
  empty: emptyWidget,
  [dataChartWidget.contract.key]: dataChartWidget,
  [workflowListWidget.contract.key]: workflowListWidget,
  [workflowEditorWidget.contract.key]: workflowEditorWidget,
  [chatWidget.contract.key]: chatWidget,
  [workflowConsoleWidget.contract.key]: workflowConsoleWidget,
  [copilotWidget.contract.key]: copilotWidget,
  [listIndicatorWidget.contract.key]: listIndicatorWidget,
  [listMcpWidget.contract.key]: listMcpWidget,
  [editorIndicatorWidget.contract.key]: editorIndicatorWidget,
  [editorMcpWidget.contract.key]: editorMcpWidget,
  [listCustomToolWidget.contract.key]: listCustomToolWidget,
  [editorCustomToolWidget.contract.key]: editorCustomToolWidget,
  [listSkillWidget.contract.key]: listSkillWidget,
  [editorSkillWidget.contract.key]: editorSkillWidget,
  [workflowVariablesWidget.contract.key]: workflowVariablesWidget,
  [watchlistWidget.contract.key]: watchlistWidget,
  [portfolioSnapshotWidget.contract.key]: portfolioSnapshotWidget,
  [quickOrderWidget.contract.key]: quickOrderWidget,
  [heatmapWidget.contract.key]: heatmapWidget,
}

function getLocalizedWidgetTitle(
  widgetsCopy: WorkspaceWidgetsMessages,
  widget: DashboardWidgetCatalogDefinition
) {
  const widgetTitle = widgetsCopy.titles[widget.key as keyof typeof widgetsCopy.titles]
  return widgetTitle ?? widget.title
}

const isPersistedWidgetDefinition = (
  widget: DashboardWidgetRegistryDefinition
): widget is DashboardWidgetDefinition => 'contract' in widget

const emptyWidgetDefinition: DashboardWidgetCatalogDefinition = {
  ...emptyWidget,
  title: 'Empty',
  category: 'utility',
  description: 'No widget selected.',
}

function withContractMetadata(
  widget: DashboardWidgetRegistryDefinition
): DashboardWidgetCatalogDefinition {
  if (!isPersistedWidgetDefinition(widget)) {
    return emptyWidgetDefinition
  }
  const { contract, ...definition } = widget
  return {
    ...definition,
    key: contract.key,
    title: contract.title,
    category: contract.category,
    description: contract.description,
  }
}

export const getWidgetDefinition = (key: string): DashboardWidgetCatalogDefinition | undefined => {
  const widget = widgetRegistry[key]
  return widget ? withContractMetadata(widget) : undefined
}

export const getAllWidgets = (): DashboardWidgetCatalogDefinition[] =>
  Object.values(widgetRegistry).filter(isPersistedWidgetDefinition).map(withContractMetadata)

export const getWidgetCategories = (
  widgetsCopy: WorkspaceWidgetsMessages
): WidgetCategoryGroup[] => {
  const categoryMap = widgetCategoryConfig.reduce<Record<string, WidgetCategoryGroup>>(
    (acc, category) => {
      acc[category.key] = {
        ...category,
        title: widgetsCopy.selector.categories[category.key],
        widgets: [],
      }
      return acc
    },
    {}
  )

  for (const widget of getAllWidgets()) {
    const category = categoryMap[widget.category]
    if (category) {
      category.widgets.push({
        ...widget,
        title: getLocalizedWidgetTitle(widgetsCopy, widget),
      })
    }
  }

  return widgetCategoryConfig.map((category) => categoryMap[category.key])
}

export const isValidWidgetKey = (key: string): key is WidgetKey => isWidgetKey(key)
