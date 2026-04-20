import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type BlockMermaidCatalogItemType,
  GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { listWorkflowBlockCatalogItems } from '@/lib/copilot/tools/server/blocks/block-mermaid-catalog'

type RankedBlock = {
  block: BlockMermaidCatalogItemType
  score: number
}

const QUERY_TERM_ALIASES: Record<string, string[]> = {
  ohlcv: ['open', 'high', 'low', 'close', 'volume'],
}

export const getBlocksAndToolsServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksAndToolsInput.parse>,
  ReturnType<typeof GetBlocksAndToolsResult.parse>
> = {
  name: 'get_blocks_and_tools',
  async execute(input) {
    const logger = createLogger('GetBlocksAndToolsServerTool')
    const { query, triggerAllowed } = GetBlocksAndToolsInput.parse(input ?? {})
    logger.debug('Executing get_blocks_and_tools', { query, triggerAllowed })

    const normalizedQuery = query?.trim().toLowerCase()
    const queryTerms = normalizedQuery
      ? Array.from(
          new Set(
            normalizedQuery
              .split(/\s+/)
              .filter(Boolean)
              .flatMap((term) => [term, ...(QUERY_TERM_ALIASES[term] ?? [])])
          )
        )
      : []
    const blocks = (await listWorkflowBlockCatalogItems())
      .map((block) => {
        if (
          typeof triggerAllowed === 'boolean' &&
          Boolean(block.triggerAllowed) !== triggerAllowed
        ) {
          return null
        }

        if (queryTerms.length === 0) {
          return { block, score: 0 }
        }

        const searchableText = [
          block.blockType,
          block.blockName,
          block.blockDescription,
          ...(block.operationIds ?? []),
        ]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join(' ')
          .toLowerCase()
        const matchedTermCount = queryTerms.filter((term) => searchableText.includes(term)).length

        if (matchedTermCount === 0) {
          return null
        }

        return {
          block,
          score:
            matchedTermCount +
            (normalizedQuery && searchableText.includes(normalizedQuery) ? queryTerms.length : 0),
        }
      })
      .filter((entry): entry is RankedBlock => entry !== null)
      .sort((left, right) => right.score - left.score || left.block.blockType.localeCompare(right.block.blockType))
      .map(({ block }) => block)

    return GetBlocksAndToolsResult.parse({ blocks })
  },
}
