import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeTool = vi.fn()
const resolveExaServiceConfig = vi.fn()
const resolveSerperServiceConfig = vi.fn()

vi.mock('@/lib/system-services/runtime', () => ({
  resolveExaServiceConfig,
  resolveSerperServiceConfig,
}))

vi.mock('@/tools', () => ({
  executeTool,
}))

describe('searchOnlineServerTool', () => {
  beforeEach(() => {
    executeTool.mockReset()
    resolveExaServiceConfig.mockReset()
    resolveSerperServiceConfig.mockReset()
    resolveExaServiceConfig.mockResolvedValue({ apiKey: null })
    resolveSerperServiceConfig.mockResolvedValue({ apiKey: null })
  })

  it('falls back to DuckDuckGo when premium search keys are unavailable', async () => {
    const { searchOnlineServerTool } = await import('./search-online')

    executeTool.mockImplementation(async (toolName: string) => {
      if (toolName !== 'duckduckgo_search') {
        throw new Error(`Unexpected tool call: ${toolName}`)
      }

      return {
        success: true,
        output: {
          heading: 'TradingAgents',
          abstractText: 'TradingAgents is an open-source multi-agent trading research project.',
          abstractURL: 'https://github.com/TauricResearch/TradingAgents',
          results: [
            {
              FirstURL: 'https://github.com/TauricResearch/TradingAgents',
              Text: 'TradingAgents - GitHub repository',
            },
          ],
          relatedTopics: [
            {
              FirstURL: 'https://tauric.ai/',
              Text: 'Tauric Research - company website',
            },
          ],
        },
      }
    })

    const result = await searchOnlineServerTool.execute({
      query: 'TradingAgents Tauric Research',
      num: 2,
      type: 'news',
    })

    expect(executeTool).toHaveBeenCalledWith('duckduckgo_search', {
      query: 'TradingAgents Tauric Research',
      noHtml: true,
      skipDisambig: false,
    })
    expect(result.source).toBe('duckduckgo')
    expect(result.type).toBe('search')
    expect(result.requestedType).toBe('news')
    expect(result.totalResults).toBe(2)
    expect(result.results).toEqual([
      expect.objectContaining({
        title: 'TradingAgents',
        link: 'https://github.com/TauricResearch/TradingAgents',
      }),
      expect.objectContaining({
        title: 'Tauric Research',
        link: 'https://tauric.ai/',
      }),
    ])
    expect(result.warnings?.[0]).toContain('DuckDuckGo fallback')
    expect(result.warnings?.[1]).toContain('Requested "news"')
  })

  it('returns Exa results when Exa search succeeds', async () => {
    const { searchOnlineServerTool } = await import('./search-online')
    resolveExaServiceConfig.mockResolvedValue({ apiKey: 'exa-key' })
    resolveSerperServiceConfig.mockResolvedValue({ apiKey: null })

    executeTool.mockResolvedValue({
      success: true,
      output: {
        results: [
          {
            title: 'TradingAgents',
            url: 'https://github.com/TauricResearch/TradingAgents',
            text: 'Repository for multi-agent trading research.',
            publishedDate: '2026-04-10',
          },
        ],
      },
    })

    const result = await searchOnlineServerTool.execute({
      query: 'TradingAgents Tauric Research',
      num: 3,
    })

    expect(executeTool).toHaveBeenCalledWith('exa_search', {
      query: 'TradingAgents Tauric Research',
      numResults: 3,
      type: 'auto',
      apiKey: 'exa-key',
    })
    expect(result).toEqual({
      results: [
        {
          title: 'TradingAgents',
          link: 'https://github.com/TauricResearch/TradingAgents',
          snippet: 'Repository for multi-agent trading research.',
          date: '2026-04-10',
          position: 1,
        },
      ],
      query: 'TradingAgents Tauric Research',
      type: 'search',
      totalResults: 1,
      source: 'exa',
    })
  })

  it('prefers Serper for typed searches even when Exa is configured', async () => {
    const { searchOnlineServerTool } = await import('./search-online')
    resolveExaServiceConfig.mockResolvedValue({ apiKey: 'exa-key' })
    resolveSerperServiceConfig.mockResolvedValue({ apiKey: 'serper-key' })

    executeTool.mockImplementation(async (toolName: string) => {
      if (toolName === 'serper_search') {
        return {
          success: true,
          output: {
            searchResults: [
              {
                title: 'TradingAgents launch coverage',
                link: 'https://example.com/news/tradingagents',
                snippet: 'News coverage of TradingAgents.',
                position: 1,
                date: '2026-04-10',
              },
            ],
          },
        }
      }

      throw new Error(`Unexpected tool call: ${toolName}`)
    })

    const result = await searchOnlineServerTool.execute({
      query: 'TradingAgents Tauric Research',
      num: 3,
      type: 'news',
    })

    expect(executeTool).toHaveBeenCalledWith('serper_search', {
      query: 'TradingAgents Tauric Research',
      num: 3,
      type: 'news',
      gl: undefined,
      hl: undefined,
      apiKey: 'serper-key',
    })
    expect(executeTool).not.toHaveBeenCalledWith(
      'exa_search',
      expect.anything()
    )
    expect(result).toEqual({
      results: [
        {
          title: 'TradingAgents launch coverage',
          link: 'https://example.com/news/tradingagents',
          snippet: 'News coverage of TradingAgents.',
          position: 1,
          date: '2026-04-10',
        },
      ],
      query: 'TradingAgents Tauric Research',
      type: 'news',
      totalResults: 1,
      source: 'serper',
    })
  })
})
