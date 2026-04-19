import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlocksMetadataInput,
  GetBlocksMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { getWorkflowBlockProfile } from '@/lib/copilot/tools/server/blocks/block-mermaid-catalog'

export const getBlocksMetadataServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksMetadataInput.parse>,
  ReturnType<typeof GetBlocksMetadataResult.parse>
> = {
  name: 'get_blocks_metadata',
  async execute({
    blockIds,
  }: ReturnType<typeof GetBlocksMetadataInput.parse>): Promise<
    ReturnType<typeof GetBlocksMetadataResult.parse>
  > {
    const logger = createLogger('GetBlocksMetadataServerTool')
    logger.debug('Executing get_blocks_metadata', { count: blockIds?.length })

    const entries = await Promise.all(
      Array.from(new Set(blockIds || []))
        .filter(Boolean)
        .map(async (blockType) => {
          try {
            return [blockType, await getWorkflowBlockProfile(blockType)] as const
          } catch (error) {
            logger.debug('Skipping unknown block in get_blocks_metadata', { blockType, error })
            return null
          }
        })
    )

    const metadata = Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, Awaited<ReturnType<typeof getWorkflowBlockProfile>>] =>
          entry !== null
      )
    )

    return GetBlocksMetadataResult.parse({ metadata })
  },
}
