import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getIndicatorMetadataByIds } from '@/lib/copilot/tools/server/indicators/indicator-reference'
import {
  GetIndicatorMetadataInput,
  GetIndicatorMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

export const getIndicatorMetadataServerTool: BaseServerTool<
  ReturnType<typeof GetIndicatorMetadataInput.parse>,
  ReturnType<typeof GetIndicatorMetadataResult.parse>
> = {
  name: 'get_indicator_metadata',
  async execute(input) {
    const logger = createLogger('GetIndicatorMetadataServerTool')
    const args = GetIndicatorMetadataInput.parse(input ?? {})
    logger.debug('Executing get_indicator_metadata', { targetIds: args.targetIds })

    return GetIndicatorMetadataResult.parse(getIndicatorMetadataByIds(args.targetIds))
  },
}
