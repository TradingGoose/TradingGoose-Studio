import { ForecastRequest, ForecastResponse } from './types'
import { logForecastRequest, logForecastRealization, logForecastError } from './ledger'

export interface KronosCallContext {
  workflowId?: string
  executionId?: string
  blockId?: string
  workspaceId?: string
  userId?: string
}

export async function callKronosForecast(
  request: ForecastRequest,
  context: KronosCallContext = {},
  options: { signal?: AbortSignal } = {}
): Promise<ForecastResponse> {
  const { callKronosForecast: rawCall } = await import('./client')
  try {
    const response = await rawCall(request, options)
    logForecastRequest(request, response, context)
    return response
  } catch (error) {
    logForecastError(request.requestId, error, context)
    throw error
  }
}

export { logForecastRequest, logForecastRealization, logForecastError }
export { isKronosEnabled } from './client'
export * from './types'
