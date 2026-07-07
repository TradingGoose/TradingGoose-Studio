import { CopilotTool } from '@/lib/copilot/registry'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { readWidgetMetadataProfiles } from '@/widgets/widget-contracts'
import { createWidgetConfigValidationError } from '@/widgets/widget-mutations'

export type GetWidgetsMetadataArgs = { widgetKeys: string[] }

export const getWidgetsMetadataServerTool: BaseServerTool<GetWidgetsMetadataArgs, any> = {
  name: CopilotTool.get_widgets_metadata,
  async execute(args) {
    let widgets
    try {
      widgets = readWidgetMetadataProfiles(args.widgetKeys)
    } catch (error) {
      throw createWidgetConfigValidationError(
        'widgetKeys',
        error instanceof Error ? error.message : 'Invalid widget metadata request'
      )
    }
    return {
      metadata: Object.fromEntries(widgets.map((widget) => [widget.widgetKey, widget])),
    }
  },
}
