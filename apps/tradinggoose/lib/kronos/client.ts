import { createLogger } from '@/lib/logs/console/logger'
import {
  ForecastRequest,
  ForecastResponse,
  ForecastResponseSchema,
  KronosError,
  KronosErrorCode,
} from './types'

const logger = createLogger('KronosClient')

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_HORIZON = 32

export interface KronosCallOptions {
  signal?: AbortSignal
}

function readEnv(variable: string): string | undefined {
  return process.env[variable]?.trim() || undefined
}

function getBoolean(variable: string): boolean {
  const value = readEnv(variable)
  return value?.toLowerCase() === 'true' || value === '1'
}

function getNumber(variable: string): number | undefined {
  const value = readEnv(variable)
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function callKronosForecast(
  request: ForecastRequest,
  options: KronosCallOptions = {}
): Promise<ForecastResponse> {
  const enabled = getBoolean('KRONOS_ENABLED')
  const url = readEnv('KRONOS_INTERNAL_URL')
  const token = readEnv('KRONOS_INTERNAL_TOKEN')
  const timeoutMs = getNumber('KRONOS_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS
  const maxHorizon = getNumber('KRONOS_MAX_HORIZON') ?? DEFAULT_MAX_HORIZON

  if (!enabled) {
    throw new KronosError(KronosErrorCode.DISABLED, 'Kronos forecasting is not enabled')
  }
  if (!url) {
    throw new KronosError(
      KronosErrorCode.UNAVAILABLE,
      'Kronos service URL is not configured'
    )
  }
  if (!token) {
    throw new KronosError(
      KronosErrorCode.UNAVAILABLE,
      'Kronos service token is not configured'
    )
  }
  if (request.futureTimestamps.length > maxHorizon) {
    throw new KronosError(
      KronosErrorCode.HORIZON_EXCEEDED,
      `Forecast horizon ${request.futureTimestamps.length} exceeds the configured maximum of ${maxHorizon}`
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${url}/v1/forecast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
      signal: options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 503) {
        throw new KronosError(
          KronosErrorCode.UNAVAILABLE,
          'Kronos service is not ready'
        )
      }
      if (response.status === 429) {
        throw new KronosError(
          KronosErrorCode.UNAVAILABLE,
          'Kronos service is overloaded'
        )
      }
      throw new KronosError(
        KronosErrorCode.INVALID_RESPONSE,
        `Kronos request failed with status ${response.status}: ${detail.slice(0, 200)}`
      )
    }

    const raw = await response.json()
    const parsed = ForecastResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error('Kronos response failed validation', {
        requestId: request.requestId,
        issues: parsed.error.issues,
      })
      throw new KronosError(
        KronosErrorCode.INVALID_RESPONSE,
        'Kronos returned an invalid forecast response'
      )
    }
    return parsed.data
  } catch (error) {
    if (error instanceof KronosError) {
      throw error
    }
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new KronosError(
          KronosErrorCode.TIMEOUT,
          'Kronos request timed out'
        )
      }
      throw new KronosError(
        KronosErrorCode.UNAVAILABLE,
        `Kronos request failed: ${error.message}`
      )
    }
    throw new KronosError(KronosErrorCode.UNAVAILABLE, 'Kronos request failed')
  } finally {
    clearTimeout(timeout)
  }
}

export function isKronosEnabled(): boolean {
  return getBoolean('KRONOS_ENABLED')
    && Boolean(readEnv('KRONOS_INTERNAL_URL'))
    && Boolean(readEnv('KRONOS_INTERNAL_TOKEN'))
}

export function getMaxHorizon(): number {
  return getNumber('KRONOS_MAX_HORIZON') ?? DEFAULT_MAX_HORIZON
}
