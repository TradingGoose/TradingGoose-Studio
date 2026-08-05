import { dispatchToolRemote, waitForToolDelay } from '@/tools/runtime'
import type { ToolConfig } from '@/tools/types'
import type { RunActorParams, RunActorResult } from './types'

const POLL_INTERVAL_MS = 5000 // 5 seconds between polls
const MAX_POLL_TIME_MS = 300000 // 5 minutes maximum polling time

export const apifyRunActorAsyncTool: ToolConfig<RunActorParams, RunActorResult> = {
  id: 'apify_run_actor_async',
  name: 'APIFY Run Actor (Async)',
  description: 'Run an APIFY actor asynchronously with polling for long-running tasks',
  version: '1.0.0',
  durableCredentialParam: 'apiKey',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'APIFY API token from console.apify.com/account#/integrations',
    },
    actorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Actor ID or username/actor-name (e.g., "janedoe/my-actor" or actor ID)',
    },
    input: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actor input as JSON string',
    },
    waitForFinish: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial wait time in seconds (0-60) before polling starts',
    },
    itemLimit: {
      type: 'number',
      required: false,
      default: 100,
      visibility: 'user-or-llm',
      description: 'Max dataset items to fetch (1-250000, default 100)',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timeout in seconds (default: actor default)',
    },
    build: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actor build to run (e.g., "latest", "beta", or build tag/number)',
    },
  },

  request: {
    url: (params) => {
      const encodedActorId = encodeURIComponent(params.actorId)
      const baseUrl = `https://api.apify.com/v2/acts/${encodedActorId}/runs`
      const queryParams = new URLSearchParams()

      queryParams.set('token', params.apiKey)

      if (params.waitForFinish !== undefined) {
        const waitTime = Math.max(0, Math.min(params.waitForFinish, 60))
        queryParams.set('waitForFinish', waitTime.toString())
      }
      if (params.timeout) {
        queryParams.set('timeout', params.timeout.toString())
      }
      if (params.build) {
        queryParams.set('build', params.build)
      }

      return `${baseUrl}?${queryParams.toString()}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let inputData = {}
      if (params.input) {
        try {
          inputData = JSON.parse(params.input)
        } catch (e) {
          throw new Error('Invalid JSON in input parameter')
        }
      }
      return inputData
    },
  },

  transformResponse: async (response, _params, runtime) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        output: { success: false, runId: '', status: 'ERROR' },
        error: `APIFY API error: ${errorText}`,
      }
    }

    const data = await response.json()
    await runtime?.publishOperationIdentity?.({
      adapterKind: 'apify_run',
      capability: 'native_cancel_status',
      remoteOperationId: data.data.id,
    })
    return {
      success: true,
      output: data.data,
    }
  },

  postProcess: async (result, params, _executeTool, runtime) => {
    if (!result.success) {
      return result
    }

    const runData = result.output as any
    const runId = runData.id
    await runtime?.publishOperationIdentity?.({
      adapterKind: 'apify_run',
      capability: 'native_cancel_status',
      remoteOperationId: runId,
    })

    let elapsedTime = 0
    let terminalRun: any

    while (!terminalRun) {
      try {
        await waitForToolDelay(POLL_INTERVAL_MS, runtime?.signal)
        elapsedTime += POLL_INTERVAL_MS

        const encodedActorId = encodeURIComponent(params.actorId)
        const statusResponse = await dispatchToolRemote(runtime, () =>
          fetch(
            `https://api.apify.com/v2/acts/${encodedActorId}/runs/${runId}?token=${params.apiKey}`,
            {
              headers: { Authorization: `Bearer ${params.apiKey}` },
              signal: runtime?.signal,
            }
          )
        )

        if (!statusResponse.ok) continue

        const statusData = await statusResponse.json()
        const run = statusData.data

        if (
          run.status === 'SUCCEEDED' ||
          run.status === 'FAILED' ||
          run.status === 'ABORTED' ||
          run.status === 'TIMED-OUT'
        ) {
          terminalRun = run
        }
      } catch {
        runtime?.signal?.throwIfAborted()
      }
    }

    const providerStatus = terminalRun.status
    if (providerStatus !== 'SUCCEEDED') {
      const terminalState = providerStatus === 'ABORTED' ? 'canceled' : 'failed'
      const terminalResult = {
        success: false,
        output: {
          success: false,
          runId,
          status: providerStatus,
          datasetId: terminalRun.defaultDatasetId,
        },
        error: `Actor run ${providerStatus}`,
      }
      await runtime?.recordTerminalObservation?.(terminalState, { providerStatus })
      return terminalResult
    }

    try {
      const limit = Math.max(1, Math.min(params.itemLimit || 100, 250000))
      const itemsResponse = await dispatchToolRemote(runtime, () =>
        fetch(
          `https://api.apify.com/v2/datasets/${terminalRun.defaultDatasetId}/items?token=${params.apiKey}&limit=${limit}`,
          {
            headers: { Authorization: `Bearer ${params.apiKey}` },
            signal: runtime?.signal,
          }
        )
      )
      const items = itemsResponse.ok ? await itemsResponse.json() : undefined
      const terminalResult = {
        success: true,
        output: {
          success: true,
          runId,
          status: providerStatus,
          datasetId: terminalRun.defaultDatasetId,
          ...(items === undefined ? {} : { items }),
        },
      }
      await runtime?.recordTerminalObservation?.('completed', { providerStatus })
      return terminalResult
    } catch (error) {
      await runtime?.recordTerminalObservation?.('completed', { providerStatus })
      runtime?.signal?.throwIfAborted()
      throw error
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the actor run succeeded' },
    runId: { type: 'string', description: 'APIFY run ID' },
    status: { type: 'string', description: 'Run status (SUCCEEDED, FAILED, etc.)' },
    datasetId: { type: 'string', description: 'Dataset ID containing results' },
    items: { type: 'array', description: 'Dataset items (if completed)' },
  },
}
