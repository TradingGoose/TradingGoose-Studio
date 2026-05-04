import { createLogger } from '@/lib/logs/console/logger'
import { requestTradingGooseMarket } from '@/lib/market/request-gate'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('MarketClient')

export interface MarketClientResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  status?: number
}

class MarketClient {
  async makeRequest<T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST'
      headers?: Record<string, string>
      apiKey?: string
      body?: unknown
      timeoutMs?: number
    } = {}
  ): Promise<MarketClientResponse<T>> {
    const requestId = generateRequestId()
    const { method = 'GET', headers = {}, apiKey, body, timeoutMs } = options
    const controller = timeoutMs ? new AbortController() : null
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null

    const buildTimeoutResponse = (): MarketClientResponse<T> => {
      logger.warn(`[${requestId}] Market request timed out`, {
        endpoint,
        timeoutMs,
      })

      return {
        success: false,
        error: `Request timed out after ${timeoutMs}ms`,
        status: 408,
      }
    }

    try {
      const requestHeaders: Record<string, string> = {
        ...headers,
      }

      if (!requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json'
      }

      logger.info(`[${requestId}] Making request to market service`, {
        endpoint,
        method,
      })

      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller?.signal,
      }
      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body)
      }

      const response = await requestTradingGooseMarket(endpoint, {
        ...fetchOptions,
        apiKey,
      })
      const responseStatus = response.status

      let responseData: any
      try {
        const responseText = await response.text()
        responseData = responseText ? JSON.parse(responseText) : null
      } catch (parseError) {
        if (parseError instanceof Error && parseError.name === 'AbortError') {
          return buildTimeoutResponse()
        }

        logger.error(`[${requestId}] Failed to parse response`, parseError)
        return {
          success: false,
          error: `Failed to parse response: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`,
          status: responseStatus,
        }
      }

      logger.info(`[${requestId}] Response received`, {
        status: responseStatus,
        success: response.ok,
        hasData: !!responseData,
      })

      return {
        success: response.ok,
        data: responseData,
        error: response.ok ? undefined : responseData?.error || `HTTP ${responseStatus}`,
        status: responseStatus,
      }
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return buildTimeoutResponse()
      }

      logger.error(`[${requestId}] Request failed`, fetchError)
      return {
        success: false,
        error: `Connection failed: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`,
        status: 0,
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }
}

export const marketClient = new MarketClient()

export { MarketClient }
