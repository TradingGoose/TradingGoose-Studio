import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { MARKET_API_URL_DEFAULT } from '@/lib/market/client/constants'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('MarketClient')

export interface MarketClientResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  status?: number
}

class MarketClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = env.MARKET_API_URL || MARKET_API_URL_DEFAULT
  }

  async makeRequest<T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST'
      headers?: Record<string, string>
      apiKey?: string
      body?: unknown
    } = {}
  ): Promise<MarketClientResponse<T>> {
    const requestId = generateRequestId()
    const { method = 'GET', headers = {}, apiKey, body } = options

    try {
      const url = `${this.baseUrl}${endpoint}`

      const requestHeaders: Record<string, string> = {
        ...headers,
      }

      if (!requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json'
      }

      const key = apiKey ?? env.MARKET_API_KEY
      if (key) {
        requestHeaders['x-api-key'] = key
      }

      logger.info(`[${requestId}] Making request to market service`, {
        url,
        method,
      })

      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
      }
      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body)
      }

      const response = await fetch(url, fetchOptions)
      const responseStatus = response.status

      let responseData: any
      try {
        const responseText = await response.text()
        responseData = responseText ? JSON.parse(responseText) : null
      } catch (parseError) {
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
      logger.error(`[${requestId}] Request failed`, fetchError)
      return {
        success: false,
        error: `Connection failed: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`,
        status: 0,
      }
    }
  }

  getConfig() {
    return {
      baseUrl: this.baseUrl,
      environment: process.env.NODE_ENV,
    }
  }
}

export const marketClient = new MarketClient()

export { MarketClient }
