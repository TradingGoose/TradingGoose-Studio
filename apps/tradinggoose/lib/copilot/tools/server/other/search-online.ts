import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
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
  requestedType?: string
  totalResults: number
  source: 'exa' | 'serper' | 'duckduckgo'
  warnings?: string[]
}

const SERPER_SUPPORTED_TYPES = new Set(['search', 'news', 'places', 'images'])

const normalizeSearchType = (value: string | undefined): string =>
  typeof value === 'string' && SERPER_SUPPORTED_TYPES.has(value) ? value : 'search'

const stripHtml = (value: string | undefined): string =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const deriveTitleFromText = (text: string, link: string): string => {
  const normalizedText = stripHtml(text)
  const titleFromText = normalizedText.split(' - ')[0]?.trim()
  if (titleFromText) return titleFromText

  try {
    const hostname = new URL(link).hostname.replace(/^www\./, '')
    if (hostname) return hostname
  } catch {}

  return 'DuckDuckGo result'
}

const buildDuckDuckGoFallbackResults = (output: any, limit: number): SearchOnlineResultItem[] => {
  const results: SearchOnlineResultItem[] = []
  const seenLinks = new Set<string>()

  const pushResult = (item: SearchOnlineResultItem | null) => {
    if (!item) return
    const dedupeKey = item.link || `${item.title}:${item.snippet}`
    if (seenLinks.has(dedupeKey)) return
    seenLinks.add(dedupeKey)
    results.push({
      ...item,
      position: results.length + 1,
    })
  }

  const abstractURL = String(output?.abstractURL || '').trim()
  const abstractText = stripHtml(output?.abstractText || output?.abstract)
  const heading = String(output?.heading || '').trim()
  if (abstractURL && abstractText) {
    pushResult({
      title: heading || deriveTitleFromText(abstractText, abstractURL),
      link: abstractURL,
      snippet: abstractText,
      position: 0,
    })
  }

  const candidateItems = [
    ...(Array.isArray(output?.results) ? output.results : []),
    ...(Array.isArray(output?.relatedTopics) ? output.relatedTopics : []),
  ]

  for (const candidate of candidateItems) {
    const link = String(candidate?.FirstURL || '').trim()
    const snippet = stripHtml(candidate?.Text || candidate?.Result)
    if (!link || !snippet) continue

    pushResult({
      title: deriveTitleFromText(snippet, link),
      link,
      snippet,
      position: 0,
    })

    if (results.length >= limit) break
  }

  return results.slice(0, limit)
}

const executeDuckDuckGoFallback = async (input: {
  query: string
  num: number
  type: string
  logger: ReturnType<typeof createLogger>
  fallbackReason: string
}): Promise<SearchOnlineResult> => {
  const { query, num, type, logger, fallbackReason } = input

  logger.info('Falling back to duckduckgo_search', {
    queryLength: query.length,
    requestedType: type,
    num,
  })

  const result = await executeTool('duckduckgo_search', {
    query,
    noHtml: true,
    skipDisambig: false,
  })

  if (!result.success) {
    throw new Error(result.error || 'DuckDuckGo search failed')
  }

  const transformedResults = buildDuckDuckGoFallbackResults((result as any)?.output || {}, num)
  const warnings = [fallbackReason]

  if (type !== 'search') {
    warnings.push(
      `DuckDuckGo fallback only supports web search. Requested "${type}" and returned "search" results instead.`
    )
  }

  return {
    results: transformedResults,
    query,
    requestedType: type,
    type: 'search',
    totalResults: transformedResults.length,
    source: 'duckduckgo',
    warnings,
  }
}

export const searchOnlineServerTool: BaseServerTool<OnlineSearchParams, SearchOnlineResult> = {
  name: 'search_online',
  async execute(params: OnlineSearchParams): Promise<SearchOnlineResult> {
    const logger = createLogger('SearchOnlineServerTool')
    const { query, num = 10, gl, hl } = params
    const type = normalizeSearchType(params.type)
    if (!query || typeof query !== 'string') throw new Error('query is required')

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

    // Prefer Serper for the generic web/news/places/images surface because
    // it supports the full `search_online` type contract directly.
    if (hasSerperApiKey) {
      try {
        logger.debug('Calling serper_search tool', { type, num, gl, hl })
        const result = await executeTool('serper_search', {
          query,
          num,
          type,
          gl,
          hl,
          apiKey: serperApiKey,
        })
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

        if (count > 0 || type !== 'search') {
          return {
            results,
            query,
            type,
            totalResults: count,
            source: 'serper',
          }
        }

        logger.warn('serper_search returned no results for web search, trying Exa fallback', {
          queryLength: query.length,
        })
      } catch (e: any) {
        logger.error('serper_search failed', { message: e?.message })
      }
    }

    // Exa is only used for plain web search fallback. It does not implement the
    // typed `news` / `places` / `images` contract that `search_online` exposes.
    if (type === 'search' && hasExaApiKey) {
      try {
        logger.debug('Attempting exa_search fallback', { num })
        const exaResult = await executeTool('exa_search', {
          query,
          numResults: num,
          type: 'auto',
          apiKey: exaApiKey,
        })

        const exaResults = (exaResult as any)?.output?.results || []
        const count = Array.isArray(exaResults) ? exaResults.length : 0
        const firstTitle = count > 0 ? String(exaResults[0]?.title || '') : undefined

        logger.info('exa_search completed', {
          success: exaResult.success,
          resultsCount: count,
          firstTitlePreview: firstTitle?.slice(0, 120),
        })

        if (exaResult.success && count > 0) {
          const transformedResults: SearchOnlineResultItem[] = exaResults.map((result: any) => ({
            title: result.title || '',
            link: result.url || '',
            snippet: result.text || result.summary || '',
            date: result.publishedDate,
            position: exaResults.indexOf(result) + 1,
          }))

          return {
            results: transformedResults,
            query,
            type,
            totalResults: count,
            source: 'exa',
          }
        }

        logger.warn('exa_search returned no results', {
          queryLength: query.length,
        })
      } catch (exaError: any) {
        logger.warn('exa_search fallback failed', {
          error: exaError?.message,
        })
      }
    }

    const fallbackReason =
      !hasExaApiKey && !hasSerperApiKey
        ? 'No Serper or Exa service credentials are configured, so the search used DuckDuckGo fallback results.'
        : 'Primary online search providers were unavailable, so the search used DuckDuckGo fallback results.'

    try {
      return {
        ...(await executeDuckDuckGoFallback({
          query,
          num,
          type,
          logger,
          fallbackReason,
        })),
      }
    } catch (e: any) {
      logger.error('search_online execution error', { message: e?.message })
      throw e
    }
  },
}
