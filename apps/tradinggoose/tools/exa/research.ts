import { createLogger } from '@/lib/logs/console/logger'
import type { ExaResearchParams, ExaResearchResponse } from '@/tools/exa/types'
import { dispatchToolRemote, waitForToolDelay } from '@/tools/runtime'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ExaResearchTool')

const POLL_INTERVAL_MS = 5000 // 5 seconds between polls
const MAX_POLL_TIME_MS = 300000 // 5 minutes maximum polling time

export const researchTool: ToolConfig<ExaResearchParams, ExaResearchResponse> = {
  id: 'exa_research',
  name: 'Exa Research',
  description:
    'Perform comprehensive research using AI to generate detailed reports with citations',
  version: '1.0.0',
  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Research query or topic',
    },
    includeText: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include full text content in results',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
  },

  request: {
    url: 'https://api.exa.ai/research/v0/tasks',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: any = {
        instructions: params.query,
        model: 'exa-research',
        output: {
          schema: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    url: { type: 'string' },
                    summary: { type: 'string' },
                    text: { type: 'string' },
                    publishedDate: { type: 'string' },
                    author: { type: 'string' },
                    score: { type: 'number' },
                  },
                },
              },
            },
            required: ['results'],
          },
        },
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        taskId: data.id,
        research: [],
      },
    }
  },
  postProcess: async (result, params, _executeTool, runtime) => {
    if (!result.success) {
      return result
    }

    const taskId = result.output.taskId
    if (!taskId) return { ...result, success: false, error: 'Missing Exa task ID' }
    await runtime?.publishOperationIdentity?.({
      adapterKind: 'exa_research',
      capability: 'uncancelable',
      remoteOperationId: taskId,
    })
    logger.info(`Exa research task ${taskId} created, polling for completion...`)

    let elapsedTime = 0

    while (true) {
      try {
        const statusResponse = await dispatchToolRemote(runtime, () =>
          fetch(`https://api.exa.ai/research/v0/tasks/${taskId}`, {
            method: 'GET',
            signal: runtime?.signal,
            headers: { 'x-api-key': params.apiKey },
          })
        )

        if (!statusResponse.ok) {
          throw new Error(`Failed to get task status: ${statusResponse.statusText}`)
        }

        const taskData = await statusResponse.json()
        logger.info(`Exa research task ${taskId} status: ${taskData.status}`)

        if (taskData.status === 'completed') {
          result.output = {
            research: taskData.data?.results || [
              {
                title: 'Research Complete',
                url: '',
                summary: taskData.data || 'Research completed successfully',
                text: undefined,
                publishedDate: undefined,
                author: undefined,
                score: 1.0,
              },
            ],
          }
          await runtime?.recordTerminalObservation?.('completed', {
            providerStatus: taskData.status,
          })
          return result
        }

        if (taskData.status === 'failed') {
          const failure = {
            ...result,
            success: false,
            error: `Research task failed: ${taskData.error || 'Unknown error'}`,
          }
          await runtime?.recordTerminalObservation?.('failed', {
            providerStatus: taskData.status,
          })
          return failure
        }

        await waitForToolDelay(POLL_INTERVAL_MS, runtime?.signal)
        elapsedTime += POLL_INTERVAL_MS
      } catch (error: any) {
        runtime?.signal?.throwIfAborted()
        logger.error('Error polling for research task status:', {
          message: error.message || 'Unknown error',
          taskId,
        })

        await waitForToolDelay(POLL_INTERVAL_MS, runtime?.signal)
      }
    }
  },

  outputs: {
    research: {
      type: 'array',
      description: 'Comprehensive research findings with citations and summaries',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          summary: { type: 'string' },
          text: { type: 'string' },
          publishedDate: { type: 'string' },
          author: { type: 'string' },
          score: { type: 'number' },
        },
      },
    },
  },
}
