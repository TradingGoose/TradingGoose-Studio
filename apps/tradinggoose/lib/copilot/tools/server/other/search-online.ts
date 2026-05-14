import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveExaServiceConfig, resolveSerperServiceConfig } from '@/lib/system-services/runtime'
import { executeTool } from '@/tools'

interface OnlineSearchParams {
  query: string
  num?: number
  type?: string
  gl?: string
  hl?: string
}

interface SearchOnlineResultItem {
  title: string
  link: string
  snippet: string
  position: number
  date?: string
  imageUrl?: string
  rating?: string
  reviews?: string
  address?: string
}

interface SearchOnlineResult {
  results: SearchOnlineResultItem[]
  query: string
  type: string
  totalResults: number
  source: 'exa' | 'serper'
}

const SERPER_SUPPORTED_TYPES = new Set(['search', 'news', 'places', 'images'])

const normalizeSearchType = (value: string | undefined): string =>
  typeof value === 'string' && SERPER_SUPPORTED_TYPES.has(value) ? value : 'search'

export const searchOnlineServerTool: BaseServerTool<OnlineSearchParams, SearchOnlineResult> = {
  name: 'search_online',
  async execute(
    params: OnlineSearchParams,
    context?: ServerToolExecutionContext
  ): Promise<SearchOnlineResult> {
    const logger = createLogger('SearchOnlineServerTool')
    const { query, num = 10, gl, hl } = params
    const type = normalizeSearchType(params.type)
    if (!query || typeof query !== 'string') throw new Error('query is required')
    throwIfServerToolAborted(context)

    const [exaConfig, serperConfig] = await Promise.all([
      resolveExaServiceConfig(),
      resolveSerperServiceConfig(),
    ])
    const exaApiKey = exaConfig.apiKey || ''
    const serperApiKey = serperConfig.apiKey || ''

    const hasExaApiKey = exaApiKey.length > 0
    const hasSerperApiKey = serperApiKey.length > 0

    logger.info('Performing online search', {
      queryLength: query.length,
      num,
      type,
      gl,
      hl,
      hasExaApiKey,
      hasSerperApiKey,
    })

    if (hasSerperApiKey) {
      logger.debug('Calling serper_search tool', { type, num, gl, hl })
      const result = await executeTool(
        'serper_search',
        {
          query,
          num,
          type,
          gl,
          hl,
          apiKey: serperApiKey,
        },
        false,
        undefined,
        { signal: context?.signal }
      )
      throwIfServerToolAborted(context)
      const results = ((result as any)?.output?.searchResults || []) as SearchOnlineResultItem[]
      const count = Array.isArray(results) ? results.length : 0
      const firstTitle = count > 0 ? String(results[0]?.title || '') : undefined

      logger.info('serper_search completed', {
        success: result.success,
        resultsCount: count,
        firstTitlePreview: firstTitle?.slice(0, 120),
      })

      if (!result.success) {
        logger.error('serper_search failed', { error: (result as any)?.error })
        throw new Error((result as any)?.error || 'Search failed')
      }

      return {
        results,
        query,
        type,
        totalResults: count,
        source: 'serper',
      }
    }

    if (type !== 'search') {
      throw new Error(`Serper service credentials are required for ${type} search`)
    }

    if (!hasExaApiKey) {
      throw new Error('Search service credentials are not configured')
    }

    logger.debug('Calling exa_search tool', { num })
    const exaResult = await executeTool(
      'exa_search',
      {
        query,
        numResults: num,
        type: 'auto',
        apiKey: exaApiKey,
      },
      false,
      undefined,
      { signal: context?.signal }
    )
    throwIfServerToolAborted(context)

    const exaResults = (exaResult as any)?.output?.results || []
    const count = Array.isArray(exaResults) ? exaResults.length : 0
    const firstTitle = count > 0 ? String(exaResults[0]?.title || '') : undefined

    logger.info('exa_search completed', {
      success: exaResult.success,
      resultsCount: count,
      firstTitlePreview: firstTitle?.slice(0, 120),
    })

    if (!exaResult.success) {
      logger.error('exa_search failed', { error: (exaResult as any)?.error })
      throw new Error((exaResult as any)?.error || 'Search failed')
    }

    const transformedResults: SearchOnlineResultItem[] = exaResults.map(
      (result: any, index: number) => ({
        title: result.title || '',
        link: result.url || '',
        snippet: result.text || result.summary || '',
        date: result.publishedDate,
        position: index + 1,
      })
    )

    return {
      results: transformedResults,
      query,
      type,
      totalResults: count,
      source: 'exa',
    }
  },
}
