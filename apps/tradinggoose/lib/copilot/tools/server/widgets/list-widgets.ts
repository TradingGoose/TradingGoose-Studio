import { CopilotTool } from '@/lib/copilot/registry'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { listWidgetCatalogItems } from '@/widgets/widget-contracts'

export type ListWidgetsArgs = { category?: 'editor' | 'list' | 'utility' | 'trading' }

export const listWidgetsServerTool: BaseServerTool<ListWidgetsArgs, any> = {
  name: CopilotTool.list_widgets,
  async execute(args) {
    const widgets = listWidgetCatalogItems({ category: args.category })
    return {
      widgets,
      count: widgets.length,
    }
  },
}
