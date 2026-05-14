import { CopilotTool } from '@/lib/copilot/registry'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { listWorkflowBlockCatalogItems } from '@/lib/copilot/tools/server/blocks/block-mermaid-catalog'
import {
  type BlockMermaidCatalogItemType,
  GetAvailableBlocksInput,
  GetAvailableBlocksResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

type RankedBlock = {
  block: BlockMermaidCatalogItemType
  score: number
}

const QUERY_TERM_ALIASES: Record<string, string[]> = {
  ohlcv: ['open', 'high', 'low', 'close', 'volume'],
}

export const getAvailableBlocksServerTool: BaseServerTool<
  ReturnType<typeof GetAvailableBlocksInput.parse>,
  ReturnType<typeof GetAvailableBlocksResult.parse>
> = {
  name: CopilotTool.get_available_blocks,
  async execute(input) {
    const logger = createLogger('GetAvailableBlocksServerTool')
    const { query, category } = GetAvailableBlocksInput.parse(input ?? {})
    logger.debug('Executing get_available_blocks', { query, category })

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
        if (category && block.category !== category) {
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
      .sort(
        (left, right) =>
          right.score - left.score || left.block.blockType.localeCompare(right.block.blockType)
      )
      .map(({ block }) => block)

    return GetAvailableBlocksResult.parse({ blocks })
  },
}
