import { CopilotTool } from '@/lib/copilot/registry'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  readWorkflowBlockCatalogAvailability,
  readWorkflowBlockProfile,
} from '@/lib/copilot/tools/server/blocks/block-mermaid-catalog'
import {
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
  MAX_MODEL_SEARCH_RESULTS,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { getModelRegistry } from '@/lib/mastra/registry'

export const getBlocksMetadataServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksMetadataInput.parse>,
  ReturnType<typeof GetBlocksMetadataResult.parse>
> = {
  name: CopilotTool.get_blocks_metadata,
  async execute(input) {
    const { blockTypes, modelQuery } = GetBlocksMetadataInput.parse(input)
    const logger = createLogger('GetBlocksMetadataServerTool')
    logger.debug('Executing get_blocks_metadata', { count: blockTypes?.length })

    const availability = await readWorkflowBlockCatalogAvailability()
    const entries = await Promise.all(
      Array.from(new Set(blockTypes)).map(async (blockType) => {
        try {
          return [blockType, await readWorkflowBlockProfile(blockType, availability)] as const
        } catch (error) {
          logger.debug('Skipping unknown block in get_blocks_metadata', { blockType, error })
          return null
        }
      })
    )

    const metadata = Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, Awaited<ReturnType<typeof readWorkflowBlockProfile>>] =>
          entry !== null
      )
    )

    let modelSearch
    if (modelQuery) {
      const query = modelQuery.toLowerCase()
      const models = (await getModelRegistry()).providers
        .flatMap(({ models }) => models)
        .filter(({ id }) => id.toLowerCase().includes(query))
        .sort(
          (a, b) =>
            Number(b.id.toLowerCase() === query) - Number(a.id.toLowerCase() === query) ||
            a.id.localeCompare(b.id)
        )
      modelSearch = { models: models.slice(0, MAX_MODEL_SEARCH_RESULTS), total: models.length }
    }
    return GetBlocksMetadataResult.parse({ metadata, modelSearch })
  },
}
