import { createLogger } from '@/lib/logs/console/logger'
import { COPILOT_API_URL_DEFAULT, COPILOT_API_VERSION } from '@/lib/copilot/agent/constants'
import { resolveCopilotApiServiceConfig } from '@/lib/system-services/runtime'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('SimAgentClient')

export interface SimAgentRequest {
  workflowId: string
  userId?: string
  data?: Record<string, any>
}

export interface SimAgentResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  status?: number
}

class SimAgentClient {
  private async getBaseUrl() {
    const config = await resolveCopilotApiServiceConfig()
    return config.baseUrl || COPILOT_API_URL_DEFAULT
  }

  /**
   * Make a request to the copilot service
   */
  async makeRequest<T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      body?: Record<string, any>
      headers?: Record<string, string>
    } = {}
  ): Promise<SimAgentResponse<T>> {
    const requestId = generateRequestId()
    const { method = 'POST', body, headers = {} } = options

    try {
      const url = `${await this.getBaseUrl()}${endpoint}`

      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      }

      logger.info(`[${requestId}] Making request to copilot`, {
        url,
        method,
        hasBody: !!body,
      })

      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
      }

      if (body && (method === 'POST' || method === 'PUT')) {
        let payload = body
        if (
          endpoint.startsWith('/api/') &&
          typeof payload === 'object' &&
          payload !== null &&
          !Array.isArray(payload)
        ) {
          const version =
            typeof payload.version === 'string' && payload.version.trim().length > 0
              ? payload.version
              : COPILOT_API_VERSION
          payload = { ...payload, version }
        }
        fetchOptions.body = JSON.stringify(payload)
      }

      const response = await fetch(url, fetchOptions)
      const responseStatus = response.status

      let responseData
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

  /**
   * Generic method for custom API calls
   */
  async call<T = any>(
    endpoint: string,
    request: SimAgentRequest,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST'
  ): Promise<SimAgentResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      method,
      body: {
        workflowId: request.workflowId,
        userId: request.userId,
        ...request.data,
      },
    })
  }
}

// Export singleton instance
export const simAgentClient = new SimAgentClient()

// Export types and class for advanced usage
export { SimAgentClient }
