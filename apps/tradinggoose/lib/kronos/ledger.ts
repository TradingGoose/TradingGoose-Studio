import { createLogger } from '@/lib/logs/console/logger'
import { ForecastRequest, ForecastResponse } from '@/lib/kronos/types'

const logger = createLogger('KronosLedger')

export interface ForecastLedgerEntry {
  requestId: string
  workflowId?: string
  executionId?: string
  blockId?: string
  workspaceId?: string
  userId?: string
  listingId: string
  listingType: string
  interval: string
  timezone: string
  normalizationMode: string
  barCount: number
  horizonBars: number
  lastCompletedBarTimestamp?: string
  modelName: string
  modelRevision: string
  tokenizerRevision: string
  sourceRevision: string
  device: string
  parameters: {
    temperature: number
    topP: number
    sampleCount: number
  }
  diagnostics: {
    volumeImputed: boolean
    amountImputed: boolean
    candleReconciliationCount: number
    warnings: string[]
  }
  timingMs: {
    queue: number
    inference: number
    total: number
  }
  inputDataFreshnessMs?: number
  createdAt: string
}

export interface ForecastRealizationEntry {
  requestId: string
  listingId: string
  interval: string
  timezone: string
  realizedAt: string
  horizonBars: number
  realizedPrices?: Array<{
    timestamp: string
    open: number
    high: number
    low: number
    close: number
  }>
}

function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 200) return `${trimmed.slice(0, 200)}...`
    return trimmed
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeForLog)
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = sanitizeForLog(val)
      }
    }
    return result
  }
  return String(value)
}

export function logForecastRequest(
  request: ForecastRequest,
  response: ForecastResponse,
  context: {
    workflowId?: string
    executionId?: string
    blockId?: string
    workspaceId?: string
    userId?: string
    createdAt?: string
  }
): ForecastLedgerEntry {
  const entry: ForecastLedgerEntry = {
    requestId: request.requestId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    blockId: context.blockId,
    workspaceId: context.workspaceId,
    userId: context.userId,
    listingId: request.listing.listingId,
    listingType: request.listing.listingType,
    interval: request.interval,
    timezone: request.timezone,
    normalizationMode: request.normalizationMode,
    barCount: request.history.length,
    horizonBars: request.futureTimestamps.length,
    lastCompletedBarTimestamp: request.history.at(-1)?.timestamp,
    modelName: response.model.name,
    modelRevision: response.model.modelRevision,
    tokenizerRevision: response.model.tokenizerRevision,
    sourceRevision: response.model.sourceRevision,
    device: response.model.device,
    parameters: {
      temperature: request.parameters.temperature,
      topP: request.parameters.topP,
      sampleCount: request.parameters.sampleCount,
    },
    diagnostics: {
      volumeImputed: response.diagnostics.volumeImputed,
      amountImputed: response.diagnostics.amountImputed,
      candleReconciliationCount: response.diagnostics.candleReconciliationCount,
      warnings: response.diagnostics.warnings,
    },
    timingMs: {
      queue: Math.round(response.timingMs.queue),
      inference: Math.round(response.timingMs.inference),
      total: Math.round(response.timingMs.total),
    },
    createdAt: context.createdAt ?? new Date().toISOString(),
  }

  logger.info('Kronos forecast generated', sanitizeForLog(entry))

  return entry
}

export function logForecastRealization(
  entry: ForecastRealizationEntry
): void {
  logger.info('Kronos forecast realization recorded', sanitizeForLog(entry))
}

export function logForecastError(
  requestId: string,
  error: unknown,
  context: {
    workflowId?: string
    executionId?: string
    blockId?: string
    workspaceId?: string
    userId?: string
    listingId?: string
  }
): void {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error instanceof Error && 'code' in error
      ? (error as { code: string }).code
      : 'UNKNOWN'

  logger.error('Kronos forecast failed', sanitizeToLog({
    requestId,
    errorCode: code,
    errorMessage: message,
    ...context,
  }))
}
