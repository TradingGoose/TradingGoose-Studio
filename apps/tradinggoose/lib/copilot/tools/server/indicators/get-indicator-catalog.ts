import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { listIndicatorCatalog } from '@/lib/copilot/tools/server/indicators/indicator-reference'
import {
  GetIndicatorCatalogInput,
  GetIndicatorCatalogResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

export const getIndicatorCatalogServerTool: BaseServerTool<
  ReturnType<typeof GetIndicatorCatalogInput.parse>,
  ReturnType<typeof GetIndicatorCatalogResult.parse>
> = {
  name: 'get_indicator_catalog',
  async execute(input) {
    const logger = createLogger('GetIndicatorCatalogServerTool')
    const args = GetIndicatorCatalogInput.parse(input ?? {})
    logger.debug('Executing get_indicator_catalog', {
      sections: args.sections,
      query: args.query,
      includeItems: args.includeItems,
    })

    return GetIndicatorCatalogResult.parse(listIndicatorCatalog(args))
  },
}
