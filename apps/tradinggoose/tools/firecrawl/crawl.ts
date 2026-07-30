import { createLogger } from '@/lib/logs/console/logger'
import type { FirecrawlCrawlParams, FirecrawlCrawlResponse } from '@/tools/firecrawl/types'
import { dispatchToolRemote, waitForToolDelay } from '@/tools/runtime'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FirecrawlCrawlTool')

const POLL_INTERVAL_MS = 5000 // 5 seconds between polls
const MAX_POLL_TIME_MS = 300000 // 5 minutes maximum polling time

export const crawlTool: ToolConfig<FirecrawlCrawlParams, FirecrawlCrawlResponse> = {
  id: 'firecrawl_crawl',
  name: 'Firecrawl Crawl',
  description: 'Crawl entire websites and extract structured content from all accessible pages',
  version: '1.0.0',
  durableCredentialParam: 'apiKey',
  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The website URL to crawl',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of pages to crawl (default: 100)',
    },
    onlyMainContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Extract only main content from pages',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API Key',
    },
  },
  request: {
    url: 'https://api.firecrawl.dev/v1/crawl',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      url: params.url,
      limit: Number(params.limit) || 100,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: params.onlyMainContent || false,
      },
    }),
  },
  transformResponse: async (response: Response, _params, runtime) => {
    const data = await response.json()
    const jobId = data.jobId || data.id
    await runtime?.publishOperationIdentity?.({
      adapterKind: 'firecrawl_crawl',
      capability: 'native_cancel_status',
      remoteOperationId: jobId,
    })

    return {
      success: true,
      output: {
        jobId,
        pages: [],
        total: 0,
        creditsUsed: 0,
      },
    }
  },
  postProcess: async (result, params, _executeTool, runtime) => {
    if (!result.success) {
      return result
    }

    const jobId = result.output.jobId
    if (!jobId) return { ...result, success: false, error: 'Missing Firecrawl job ID' }
    await runtime?.publishOperationIdentity?.({
      adapterKind: 'firecrawl_crawl',
      capability: 'native_cancel_status',
      remoteOperationId: jobId,
    })
    logger.info(`Firecrawl crawl job ${jobId} created, polling for completion...`)

    let elapsedTime = 0

    while (true) {
      try {
        const statusResponse = await dispatchToolRemote(runtime, () =>
          fetch(`/api/tools/firecrawl/crawl/${jobId}`, {
            method: 'GET',
            signal: runtime?.signal,
            headers: { Authorization: `Bearer ${params.apiKey}` },
          })
        )

        if (!statusResponse.ok) {
          throw new Error(`Failed to get crawl status: ${statusResponse.statusText}`)
        }

        const crawlData = await statusResponse.json()
        logger.info(`Firecrawl crawl job ${jobId} status: ${crawlData.status}`)

        if (crawlData.status === 'completed') {
          result.output = {
            pages: crawlData.data || [],
            total: crawlData.total || 0,
            creditsUsed: crawlData.creditsUsed || 0,
          }
          await runtime?.recordTerminalObservation?.('completed', {
            providerStatus: crawlData.status,
          })
          return result
        }

        if (crawlData.status === 'failed') {
          const failure = {
            ...result,
            success: false,
            error: `Crawl job failed: ${crawlData.error || 'Unknown error'}`,
          }
          await runtime?.recordTerminalObservation?.('failed', {
            providerStatus: crawlData.status,
          })
          return failure
        }

        await waitForToolDelay(POLL_INTERVAL_MS, runtime?.signal)
        elapsedTime += POLL_INTERVAL_MS
      } catch (error: any) {
        runtime?.signal?.throwIfAborted()
        logger.error('Error polling for crawl job status:', {
          message: error.message || 'Unknown error',
          jobId,
        })

        await waitForToolDelay(POLL_INTERVAL_MS, runtime?.signal)
      }
    }
  },

  outputs: {
    pages: {
      type: 'array',
      description: 'Array of crawled pages with their content and metadata',
      items: {
        type: 'object',
        properties: {
          markdown: { type: 'string', description: 'Page content in markdown format' },
          html: { type: 'string', description: 'Page HTML content' },
          metadata: {
            type: 'object',
            description: 'Page metadata',
            properties: {
              title: { type: 'string', description: 'Page title' },
              description: { type: 'string', description: 'Page description' },
              language: { type: 'string', description: 'Page language' },
              sourceURL: { type: 'string', description: 'Source URL of the page' },
              statusCode: { type: 'number', description: 'HTTP status code' },
            },
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of pages found during crawl' },
    creditsUsed: {
      type: 'number',
      description: 'Number of credits consumed by the crawl operation',
    },
  },
}
